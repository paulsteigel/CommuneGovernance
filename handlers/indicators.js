"use strict";

const { db, serverTimestamp }            = require("../utils/firestore");
const { rebuildManifest }                = require("../utils/manifest");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, INDICATOR_STATUS } = require("../utils/constants");

// ============================================================
// INDICATORS HANDLER
//
// createIndicator  — CB_CM/LANH_DAO/ADMIN tạo indicator → DRAFT
// approveIndicator — LANH_DAO/ADMIN duyệt DRAFT|PENDING → ACTIVE
//                    triggers rebuildManifest()
//
// Status flow: DRAFT → PENDING → ACTIVE → ARCHIVED
//   createIndicator  : → DRAFT
//   approveIndicator : DRAFT|PENDING → ACTIVE  (triggers manifest rebuild)
//
// Quota (createIndicator):
//   1 read  — validateToken
//   1 write — indicator doc
//   1 write — audit log
//   Total: 1R + 2W
//
// Quota (approveIndicator):
//   1 read  — validateToken
//   1 read  — indicator doc
//   1 write — update indicator
//   1 write — audit log
//   2 reads + 1 write — rebuildManifest (indicators + requests + manifest write)
//   Total: 4R + 3W
// ============================================================

// Valid kieu_du_lieu values per spec
const VALID_KIEU_DU_LIEU = ["so", "text", "boolean", "anh"];

// ============================================================
// CREATE INDICATOR
// ============================================================

/**
 * POST /create_indicator
 *
 * Body: {
 *   token, user_id, xa_code, year,
 *   ten_chi_so:   string  (required),
 *   kieu_du_lieu: "so"|"text"|"boolean"|"anh"  (required),
 *   linh_vuc:     string  (required),
 *   mo_ta?:       string,
 *   don_vi_do?:   string,
 *   validation?:  { required?, min?, max? }
 * }
 *
 * Creates indicator with status DRAFT.
 * Manifest is NOT rebuilt yet — only rebuilt when indicator reaches ACTIVE.
 */
async function createIndicator(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const {
    xa_code, year,
    ten_chi_so, kieu_du_lieu, linh_vuc,
    mo_ta, don_vi_do, validation,
  } = req.body;

  const yearNum = Number(year);

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  }
  if (!ten_chi_so) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu ten_chi_so");
  }
  if (!kieu_du_lieu) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu kieu_du_lieu");
  }
  if (!VALID_KIEU_DU_LIEU.includes(kieu_du_lieu)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `kieu_du_lieu không hợp lệ — phải là: ${VALID_KIEU_DU_LIEU.join(", ")}`);
  }
  if (!linh_vuc) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu linh_vuc");
  }

  // Validation object rules: min/max only apply to "so"
  if (validation) {
    if (kieu_du_lieu !== "so" && (validation.min !== undefined || validation.max !== undefined)) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "min/max chỉ áp dụng cho kieu_du_lieu = 'so'");
    }
  }

  // ── 3. Permission check ───────────────────────────────────
  // CB_CM: linh_vuc must be in their linh_vuc_codes (R3)
  //        nhanh must match (cannot create for another branch)
  // LANH_DAO: nhanh must match
  // ADMIN: no restriction
  checkPermission(user, ACTIONS.CREATE_INDICATOR, {
    linh_vuc,
    nhanh: user.nhanh,
  });

  // ── 4. Write indicator doc ─────────────────────────────────
  // Use Firestore auto-ID as chi_so_id for uniqueness guarantee.
  // Format: CS_ + first 8 chars of doc ID (uppercase) for readability.
  const tempRef   = db.collection(`communes/${xa_code}/indicators`).doc();
  const chi_so_id = `CS_${tempRef.id.substring(0, 8).toUpperCase()}`;
  const newRef    = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const now       = serverTimestamp();

  await newRef.set({
    chi_so_id,
    ten_chi_so:   ten_chi_so.trim(),
    mo_ta:        mo_ta    ? mo_ta.trim()    : null,
    don_vi_do:    don_vi_do ? don_vi_do.trim() : null,
    kieu_du_lieu,
    linh_vuc,
    nhanh:        user.nhanh,    // stored for approve scope check (no extra user read)
    validation:   _normalizeValidation(validation, kieu_du_lieu),
    created_by:   user.id,
    status:       INDICATOR_STATUS.DRAFT,
    created_at:   now,
    updated_at:   now,
    approved_by:  null,
    approved_at:  null,
    year:         yearNum,
  });

  // ── 5. Audit log ──────────────────────────────────────────
  await logAudit(user, ACTIONS.CREATE_INDICATOR, {
    xa_code, year: yearNum,
    chi_so_id, linh_vuc,
    status: INDICATOR_STATUS.DRAFT,
  }, req);

  // No manifest rebuild — indicator is DRAFT, not visible to CB_THON yet.

  return successResponse(res, {
    chi_so_id,
    status:     INDICATOR_STATUS.DRAFT,
    message:    "Chỉ số đã được tạo ở trạng thái DRAFT. Cần LANH_DAO duyệt để kích hoạt.",
  });
}

// ============================================================
// APPROVE INDICATOR
// ============================================================

/**
 * POST /approve_indicator
 *
 * Body: {
 *   token, user_id, xa_code, year,
 *   chi_so_id: string  (required)
 * }
 *
 * Transitions indicator DRAFT|PENDING → ACTIVE.
 * Triggers rebuildManifest() so clients see the new indicator.
 */
async function approveIndicator(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const { xa_code, year, chi_so_id } = req.body;
  const yearNum = Number(year);

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  }
  if (!chi_so_id) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu chi_so_id");
  }

  // ── 3. Read indicator — 1 Firestore read ──────────────────
  const indRef  = db.collection(`communes/${xa_code}/indicators`).doc(chi_so_id);
  const indSnap = await indRef.get();

  if (!indSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Indicator ${chi_so_id} không tồn tại`);
  }

  const indicator = indSnap.data();

  // ── 4. Permission check ───────────────────────────────────
  // R1: only LANH_DAO/ADMIN can approve.
  // LANH_DAO: nhanh must match the indicator's nhanh
  // (indicator stores nhanh at creation — no extra user read needed)
  checkPermission(user, ACTIONS.APPROVE_INDICATOR, {
    nhanh: indicator.nhanh,
  });

  // ── 5. Status check (DATA_005) ────────────────────────────
  const approvableStatuses = [INDICATOR_STATUS.DRAFT, INDICATOR_STATUS.PENDING];
  if (!approvableStatuses.includes(indicator.status)) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Indicator ${chi_so_id} không ở trạng thái hợp lệ để duyệt ` +
      `(status hiện tại: ${indicator.status})`);
  }

  // ── 6. Update indicator → ACTIVE ──────────────────────────
  const now = serverTimestamp();
  await indRef.update({
    status:      INDICATOR_STATUS.ACTIVE,
    approved_by: user.id,
    approved_at: now,
    updated_at:  now,
  });

  // ── 7. Audit log ──────────────────────────────────────────
  await logAudit(user, ACTIONS.APPROVE_INDICATOR, {
    xa_code, year: yearNum,
    chi_so_id,
    previous_status: indicator.status,
    new_status:      INDICATOR_STATUS.ACTIVE,
  }, req);

  // ── 8. Rebuild manifest ───────────────────────────────────
  // Indicator is now ACTIVE — must rebuild so CB_THON can see it.
  const newVersion = await rebuildManifest(xa_code, yearNum);

  return successResponse(res, {
    chi_so_id,
    status:           INDICATOR_STATUS.ACTIVE,
    manifest_version: newVersion,
    message:          "Chỉ số đã được duyệt và manifest đã được cập nhật.",
  });
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Normalize and sanitize the validation object.
 * Removes min/max for non-numeric types.
 */
function _normalizeValidation(validation, kieu_du_lieu) {
  if (!validation || typeof validation !== "object") {
    return { required: true };
  }

  const result = {
    required: validation.required !== false, // default true
  };

  if (kieu_du_lieu === "so") {
    if (validation.min !== undefined) result.min = Number(validation.min);
    if (validation.max !== undefined) result.max = Number(validation.max);
  }

  return result;
}

module.exports = { createIndicator, approveIndicator };