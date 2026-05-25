"use strict";

const { db, serverTimestamp }            = require("../utils/firestore");
const { rebuildManifest }                = require("../utils/manifest");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, INDICATOR_STATUS, REQUEST_STATUS } = require("../utils/constants");

// ============================================================
// REQUESTS HANDLER
//
// createRequest — CB_CM/LANH_DAO/ADMIN tạo request → OPEN
//                 triggers rebuildManifest()
//
// Quota:
//   1 read  — validateToken
//   N reads — db.getAll() batch-fetch N indicator docs (validate chi_so_ids)
//   1 write — request doc
//   1 write — audit log
//   2 reads + 1 write — rebuildManifest
//   ─────────────────────────────────────────────────────────
//   Total: (N+3) reads + 3 writes
// ============================================================

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
    return errorResponse(res, ERROR_CODES.DATA_001,
      "chi_so_ids phải là mảng không rỗng");
  }
  if (!Array.isArray(danh_sach_thon) || danh_sach_thon.length === 0) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "danh_sach_thon phải là mảng không rỗng");
  }
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "deadline phải có định dạng YYYY-MM-DD");
  }

  // ── 3. Batch-fetch indicators to validate + get linh_vuc ──
  // Two purposes:
  //   a) All chi_so_ids must exist and be ACTIVE
  //   b) Get linh_vuc list for CB_CM scope check (R3)
  const uniqueChiSoIds = [...new Set(chi_so_ids)];
  const indRefs  = uniqueChiSoIds.map(id =>
    db.collection(`communes/${xa_code}/indicators`).doc(id)
  );
  const indSnaps = await db.getAll(...indRefs);

  const indicatorMap = {};
  for (const snap of indSnaps) {
    if (snap.exists) indicatorMap[snap.id] = snap.data();
  }

  // Validate each chi_so_id
  for (const id of uniqueChiSoIds) {
    if (!indicatorMap[id]) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Chỉ số ${id} không tồn tại trong xã ${xa_code}`);
    }
    if (indicatorMap[id].status !== INDICATOR_STATUS.ACTIVE) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Chỉ số ${id} chưa được duyệt (status: ${indicatorMap[id].status}). ` +
        `Chỉ được dùng indicators ACTIVE trong request.`);
    }
  }

  // Collect unique linh_vuc from the indicators (for CB_CM scope check)
  const linh_vuc_list = [...new Set(
    uniqueChiSoIds.map(id => indicatorMap[id].linh_vuc).filter(Boolean)
  )];

  // ── 4. Permission check ───────────────────────────────────
  // CB_CM: nhanh match + all linh_vuc must be in linh_vuc_codes
  // LANH_DAO: nhanh match only
  // ADMIN: no restriction
  checkPermission(user, ACTIONS.CREATE_REQUEST, {
    nhanh:        user.nhanh,
    linh_vuc_list,             // CB_CM scope check uses this
  });

  // ── 5. Write request doc ───────────────────────────────────
  // Doc ID = req_id for direct lookup (same pattern as indicators)
  const tempRef = db.collection(`communes/${xa_code}/requests`).doc();
  const req_id  = `REQ_${tempRef.id.substring(0, 8).toUpperCase()}`;
  const newRef  = db.collection(`communes/${xa_code}/requests`).doc(req_id);

  await newRef.set({
    req_id,
    tieu_de:          tieu_de.trim(),
    tao_boi:          user.id,
    nhanh:            user.nhanh,
    danh_sach_thon,
    chi_so_ids:       uniqueChiSoIds,
    linh_vuc_list,    // used by verifyData permission check for CB_CM scope
    deadline,
    ghi_chu:          ghi_chu ? ghi_chu.trim() : null,
    status:           REQUEST_STATUS.OPEN,
    manifest_version: null,    // updated after rebuildManifest below
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
  // New OPEN request must appear in manifest immediately.
  const newVersion = await rebuildManifest(xa_code, yearNum);

  // Update manifest_version on the request doc (best-effort, non-blocking)
  newRef.update({ manifest_version: newVersion }).catch(() => {});

  return successResponse(res, {
    req_id,
    status:           REQUEST_STATUS.OPEN,
    manifest_version: newVersion,
    message:          "Request đã được tạo và manifest đã được cập nhật.",
  });
}

module.exports = { createRequest };