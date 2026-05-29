// handlers/indicators.js
"use strict";

const { db, paths, queryAll, serverTimestamp } = require("../utils/firestore");
const { rebuildManifest }                = require("../utils/manifest");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const {
  ACTIONS, ERROR_CODES, INDICATOR_STATUS,
} = require("../utils/constants");

// ============================================================
// INDICATORS HANDLER  v2
//
// Status flow:
//   createIndicator  : → DRAFT
//   submitIndicator  : DRAFT | REJECTED → PENDING   (CB_CM gửi duyệt)
//   approveIndicator : PENDING → ACTIVE              (LANH_DAO duyệt)
//   rejectIndicator  : PENDING → REJECTED            (LANH_DAO từ chối)
//
// Uniqueness: (ten_chi_so_normalized + don_vi_do_normalized) per xa+year,
//   across DRAFT/PENDING/ACTIVE — prevents duplicates across lĩnh vực.
//   REJECTED + ARCHIVED are excluded (allow re-creation).
// ============================================================

const VALID_KIEU_DU_LIEU = ["so", "text", "boolean", "anh"];

// Normalize string for duplicate check
function _norm(s) {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── CREATE INDICATOR ──────────────────────────────────────────

async function createIndicator(req, res) {
  const user = await validateToken(req);

  const {
    xa_code, year,
    ten_chi_so, kieu_du_lieu, linh_vuc,
    mo_ta, don_vi_do, validation,
  } = req.body;

  const yearNum = Number(year);

  if (!xa_code || !year)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  if (!ten_chi_so?.trim())
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu ten_chi_so");
  if (!kieu_du_lieu || !VALID_KIEU_DU_LIEU.includes(kieu_du_lieu))
    return errorResponse(res, ERROR_CODES.DATA_001, `kieu_du_lieu phải là: ${VALID_KIEU_DU_LIEU.join(", ")}`);
  if (!linh_vuc)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu linh_vuc");
  if (validation && kieu_du_lieu !== "so" && (validation.min !== undefined || validation.max !== undefined))
    return errorResponse(res, ERROR_CODES.DATA_001, "min/max chỉ áp dụng cho kieu_du_lieu = 'so'");

  checkPermission(user, ACTIONS.CREATE_INDICATOR, { linh_vuc, nhanh: user.nhanh });

  // ── Uniqueness check (in-memory, covers all non-archived) ──
  const nameNorm = _norm(ten_chi_so);
  const unitNorm = _norm(don_vi_do || "");

  const existing = await queryAll(
    paths.indicators(xa_code)
      .where("year", "==", yearNum)
      .where("status", "in", [INDICATOR_STATUS.DRAFT, INDICATOR_STATUS.PENDING, INDICATOR_STATUS.ACTIVE])
  );

  const duplicate = existing.find(ind =>
    _norm(ind.ten_chi_so) === nameNorm &&
    _norm(ind.don_vi_do || "") === unitNorm
  );

  if (duplicate) {
    return errorResponse(res, ERROR_CODES.DATA_006,
      `Chỉ số "${ten_chi_so.trim()}"${don_vi_do ? ` (${don_vi_do})` : ""} đã tồn tại ` +
      `(${duplicate.chi_so_id || duplicate.id} — ${duplicate.status}). ` +
      `Nếu lĩnh vực bạn cũng cần chỉ số này, hãy tham chiếu ${duplicate.chi_so_id || duplicate.id} khi tạo request.`
    );
  }

  const tempRef   = db.collection(`communes/${xa_code}/indicators`).doc();
  const chi_so_id = `CS_${tempRef.id.substring(0, 8).toUpperCase()}`;
  const newRef    = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const now       = serverTimestamp();

  await newRef.set({
    chi_so_id,
    ten_chi_so:    ten_chi_so.trim(),
    mo_ta:         mo_ta      ? mo_ta.trim()      : null,
    don_vi_do:     don_vi_do  ? don_vi_do.trim()  : null,
    kieu_du_lieu,
    linh_vuc,
    nhanh:         user.nhanh,
    validation:    _normalizeValidation(validation, kieu_du_lieu),
    created_by:    user.user_id || user.id,
    status:        INDICATOR_STATUS.DRAFT,
    created_at:    now,
    updated_at:    now,
    approved_by:   null,
    approved_at:   null,
    rejected_by:   null,
    rejected_at:   null,
    rejection_reason: null,
    year:          yearNum,
  });

  await logAudit(user, ACTIONS.CREATE_INDICATOR, {
    xa_code, year: yearNum, chi_so_id, linh_vuc, status: INDICATOR_STATUS.DRAFT,
  }, req);

  return successResponse(res, {
    chi_so_id,
    status:  INDICATOR_STATUS.DRAFT,
    message: "Chỉ số đã tạo (DRAFT). Bấm 'Gửi duyệt' khi hoàn chỉnh.",
  });
}

// ── SUBMIT INDICATOR (DRAFT | REJECTED → PENDING) ────────────

async function submitIndicator(req, res) {
  const user = await validateToken(req);
  const { xa_code, year, chi_so_id } = req.body;
  const yearNum = Number(year);

  if (!xa_code || !chi_so_id)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc chi_so_id");

  const indRef  = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const indSnap = await indRef.get();

  if (!indSnap.exists)
    return errorResponse(res, ERROR_CODES.DATA_005, `Chỉ số ${chi_so_id} không tồn tại`);

  const ind = indSnap.data();

  checkPermission(user, ACTIONS.SUBMIT_INDICATOR, {
    created_by: ind.created_by,
  });

  const submittableStatuses = [INDICATOR_STATUS.DRAFT, INDICATOR_STATUS.REJECTED];
  if (!submittableStatuses.includes(ind.status)) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Không thể gửi duyệt ở trạng thái "${ind.status}". Phải là: ${submittableStatuses.join(" | ")}`);
  }

  const now = serverTimestamp();
  await indRef.update({
    status:        INDICATOR_STATUS.PENDING,
    rejection_reason: null,
    rejected_by:   null,
    rejected_at:   null,
    updated_at:    now,
  });

  await logAudit(user, ACTIONS.SUBMIT_INDICATOR, {
    xa_code, year: yearNum, chi_so_id, previous_status: ind.status,
  }, req);

  return successResponse(res, {
    chi_so_id,
    status:  INDICATOR_STATUS.PENDING,
    message: "Đã gửi duyệt. Chờ lãnh đạo xác nhận.",
  });
}

// ── APPROVE INDICATOR (PENDING → ACTIVE) ─────────────────────

async function approveIndicator(req, res) {
  const user = await validateToken(req);
  const { xa_code, year, chi_so_id } = req.body;
  const yearNum = Number(year);

  if (!xa_code || !year)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  if (!chi_so_id)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu chi_so_id");

  const indRef  = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const indSnap = await indRef.get();

  if (!indSnap.exists)
    return errorResponse(res, ERROR_CODES.DATA_005, `Indicator ${chi_so_id} không tồn tại`);

  const indicator = indSnap.data();

  checkPermission(user, ACTIONS.APPROVE_INDICATOR, { nhanh: indicator.nhanh });

  // LANH_DAO only approves PENDING
  if (indicator.status !== INDICATOR_STATUS.PENDING) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Chỉ có thể duyệt indicator ở trạng thái PENDING (hiện tại: ${indicator.status})`);
  }

  const now = serverTimestamp();
  await indRef.update({
    status:      INDICATOR_STATUS.ACTIVE,
    approved_by: user.user_id || user.id,
    approved_at: now,
    updated_at:  now,
  });

  await logAudit(user, ACTIONS.APPROVE_INDICATOR, {
    xa_code, year: yearNum, chi_so_id, previous_status: indicator.status,
  }, req);

  const newVersion = await rebuildManifest(xa_code, yearNum);

  return successResponse(res, {
    chi_so_id,
    status:           INDICATOR_STATUS.ACTIVE,
    manifest_version: newVersion,
    message:          "Chỉ số đã được duyệt và kích hoạt.",
  });
}

// ── REJECT INDICATOR (PENDING → REJECTED) ────────────────────

async function rejectIndicator(req, res) {
  const user = await validateToken(req);
  const { xa_code, year, chi_so_id, rejection_reason } = req.body;
  const yearNum = Number(year);

  if (!xa_code || !chi_so_id)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc chi_so_id");

  const indRef  = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const indSnap = await indRef.get();

  if (!indSnap.exists)
    return errorResponse(res, ERROR_CODES.DATA_005, `Chỉ số ${chi_so_id} không tồn tại`);

  const indicator = indSnap.data();

  checkPermission(user, ACTIONS.REJECT_INDICATOR, { nhanh: indicator.nhanh });

  if (indicator.status !== INDICATOR_STATUS.PENDING) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Chỉ có thể từ chối indicator ở trạng thái PENDING (hiện tại: ${indicator.status})`);
  }

  const now = serverTimestamp();
  await indRef.update({
    status:           INDICATOR_STATUS.REJECTED,
    rejected_by:      user.user_id || user.id,
    rejected_at:      now,
    rejection_reason: rejection_reason ? rejection_reason.trim() : null,
    updated_at:       now,
  });

  await logAudit(user, ACTIONS.REJECT_INDICATOR, {
    xa_code, year: yearNum, chi_so_id,
    rejection_reason: rejection_reason || null,
  }, req);

  return successResponse(res, {
    chi_so_id,
    status:  INDICATOR_STATUS.REJECTED,
    message: "Đã từ chối. CB chuyên môn sẽ chỉnh sửa và gửi lại.",
  });
}

// ── INTERNAL HELPERS ──────────────────────────────────────────

function _normalizeValidation(validation, kieu_du_lieu) {
  if (!validation || typeof validation !== "object") return { required: true };
  const result = { required: validation.required !== false };
  if (kieu_du_lieu === "so") {
    if (validation.min !== undefined) result.min = Number(validation.min);
    if (validation.max !== undefined) result.max = Number(validation.max);
  }
  return result;
}

module.exports = { createIndicator, submitIndicator, approveIndicator, rejectIndicator };
