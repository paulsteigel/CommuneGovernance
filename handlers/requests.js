// handlers/requests.js
"use strict";

const { db, serverTimestamp }            = require("../utils/firestore");
const { rebuildManifest }                = require("../utils/manifest");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, INDICATOR_STATUS, REQUEST_STATUS } = require("../utils/constants");

/**
 * POST /create_request
 *
 * Body: {
 *   token, user_id, xa_code, year,
 *   tieu_de:        string    (required),
 *   chi_so_ids:     string[]  (required, must be ACTIVE indicators),
 *   danh_sach_thon: string[]  (required, non-empty),
 *   deadline:       "YYYY-MM-DD" (required),
 *   ghi_chu?:       string
 * }
 */
async function createRequest(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const {
    xa_code, year,
    tieu_de, chi_so_ids, danh_sach_thon, deadline, ghi_chu,
  } = req.body;

  const yearNum = Number(year);

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  }
  if (!tieu_de || !tieu_de.trim()) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu tieu_de");
  }
  if (!Array.isArray(chi_so_ids) || chi_so_ids.length === 0) {
    return errorResponse(res, ERROR_CODES.DATA_001, "chi_so_ids phải là mảng không rỗng");
  }
  if (!Array.isArray(danh_sach_thon) || danh_sach_thon.length === 0) {
    return errorResponse(res, ERROR_CODES.DATA_001, "danh_sach_thon phải là mảng không rỗng");
  }
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return errorResponse(res, ERROR_CODES.DATA_001, "deadline phải có định dạng YYYY-MM-DD");
  }

  // ── 3. Batch-fetch indicators to validate ─────────────────
  const uniqueChiSoIds = [...new Set(chi_so_ids)];
  const indRefs  = uniqueChiSoIds.map(id =>
    db.collection(`communes/${xa_code}/indicators`).doc(id)
  );
  const indSnaps = await db.getAll(...indRefs);

  const indicatorMap = {};
  for (const snap of indSnaps) {
    if (snap.exists) indicatorMap[snap.id] = snap.data();
  }

  for (const id of uniqueChiSoIds) {
    if (!indicatorMap[id]) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Chỉ số ${id} không tồn tại trong xã ${xa_code}`);
    }
    if (indicatorMap[id].status !== INDICATOR_STATUS.ACTIVE) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Chỉ số ${id} chưa được duyệt (status: ${indicatorMap[id].status}). Chỉ dùng indicators ACTIVE.`);
    }
  }

  const linh_vuc_list = [...new Set(
    uniqueChiSoIds.map(id => indicatorMap[id].linh_vuc).filter(Boolean)
  )];

  // ── 4. Permission check ───────────────────────────────────
  checkPermission(user, ACTIONS.CREATE_REQUEST, {
    nhanh: user.nhanh,
    linh_vuc_list,
  });

  // ── 5. Write request doc ──────────────────────────────────
  const tempRef = db.collection(`communes/${xa_code}/requests`).doc();
  const req_id  = `REQ_${tempRef.id.substring(0, 8).toUpperCase()}`;
  const newRef  = db.collection(`communes/${xa_code}/requests`).doc(req_id);

  await newRef.set({
    req_id,
    tieu_de:          tieu_de.trim(),
    // FIX B4: use user.user_id consistently (user.id = Firestore doc ID, same value but explicit)
    tao_boi:          user.user_id || user.id,
    nhanh:            user.nhanh,
    danh_sach_thon,
    chi_so_ids:       uniqueChiSoIds,
    linh_vuc_list,
    deadline,
    ghi_chu:          ghi_chu ? ghi_chu.trim() : null,
    status:           REQUEST_STATUS.OPEN,
    manifest_version: null,
    created_at:       serverTimestamp(),
    year:             yearNum,
  });

  // ── 6. Audit log ──────────────────────────────────────────
  await logAudit(user, ACTIONS.CREATE_REQUEST, {
    xa_code, year: yearNum,
    req_id, tieu_de, chi_so_ids: uniqueChiSoIds,
    danh_sach_thon, deadline,
  }, req);

  // ── 7. Rebuild manifest ───────────────────────────────────
  const newVersion = await rebuildManifest(xa_code, yearNum);
  newRef.update({ manifest_version: newVersion }).catch(() => {});

  return successResponse(res, {
    req_id,
    status:           REQUEST_STATUS.OPEN,
    manifest_version: newVersion,
    message:          "Request đã được tạo và manifest đã được cập nhật.",
  });
}

module.exports = { createRequest };
