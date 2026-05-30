// handlers/requests.js
"use strict";

const { db, paths, serverTimestamp }     = require("../utils/firestore");
const { rebuildManifest }                = require("../utils/manifest");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, INDICATOR_STATUS, REQUEST_STATUS, SUBMISSION_STATUS } = require("../utils/constants");

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

// ============================================================
// UPDATE REQUEST STATUS
//
// PATCH /update_request_status
//
// Body: {
//   token, user_id, xa_code,
//   req_id:  string,
//   action:  "complete" | "cancel" | "exclude_thon",
//   -- complete:     (no extra fields)
//   -- cancel:       cancel_reason: string (required)
//   -- exclude_thon: thon_code: string, reason: string (both required)
// }
//
// Rules:
//   complete     → ALL thons (minus excluded) must have VERIFIED submission
//   cancel       → Any status except already COMPLETED/CANCELLED
//   exclude_thon → Remove a thon and record reason — request stays OPEN/IN_PROGRESS
//
// Quota: 3-5 reads + 1-2 writes + rebuildManifest
// ============================================================

async function updateRequestStatus(req, res) {
  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const { xa_code, req_id, action, cancel_reason, thon_code, reason } = req.body;

  if (!xa_code || !req_id || !action) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code, req_id hoặc action");
  }
  if (!["complete", "cancel", "exclude_thon"].includes(action)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "action phải là: complete | cancel | exclude_thon");
  }

  // ── 2. Fetch request ──────────────────────────────────────
  const reqRef  = paths.request(xa_code, req_id);
  const reqSnap = await reqRef.get();

  if (!reqSnap.exists) {
    return errorResponse(res, ERROR_CODES.REQ_001, `Request ${req_id} không tồn tại`);
  }

  const reqData = reqSnap.data();

  // ── 3. Guard: already terminal ────────────────────────────
  if (action !== "exclude_thon" &&
      (reqData.status === REQUEST_STATUS.COMPLETED ||
       reqData.status === REQUEST_STATUS.CANCELLED)) {
    return errorResponse(res, ERROR_CODES.REQ_002,
      `Request đã ở trạng thái ${reqData.status} — không thể thay đổi`);
  }

  // ── 4. Permission check ───────────────────────────────────
  checkPermission(user, ACTIONS.UPDATE_REQUEST_STATUS, { nhanh: reqData.nhanh });

  // ── 5. Branch by action ───────────────────────────────────

  if (action === "cancel") {
    if (!cancel_reason || !cancel_reason.trim()) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "Lý do hủy (cancel_reason) là bắt buộc");
    }

    await reqRef.update({
      status:        REQUEST_STATUS.CANCELLED,
      cancelled_at:  serverTimestamp(),
      cancelled_by:  user.user_id || user.id,
      cancel_reason: cancel_reason.trim(),
    });

    await logAudit(user, ACTIONS.UPDATE_REQUEST_STATUS,
      { xa_code, req_id, action: "cancel", cancel_reason }, req);

    const newVersion = await rebuildManifest(xa_code,
      Number(reqData.year) || new Date().getFullYear());

    return successResponse(res, {
      req_id,
      new_status:       REQUEST_STATUS.CANCELLED,
      manifest_version: newVersion,
      message:          "Request đã được hủy.",
    });
  }

  if (action === "exclude_thon") {
    if (!thon_code || !reason || !reason.trim()) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "thon_code và reason là bắt buộc khi exclude_thon");
    }

    const alreadyExcluded = (reqData.excluded_thon || [])
      .some(e => e.thon_code === thon_code);
    if (alreadyExcluded) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Thôn ${thon_code} đã bị loại trước đó`);
    }

    const newExcluded = [
      ...(reqData.excluded_thon || []),
      {
        thon_code,
        reason:      reason.trim(),
        excluded_by: user.user_id || user.id,
        excluded_at: new Date().toISOString(),
      },
    ];

    await reqRef.update({ excluded_thon: newExcluded });

    await logAudit(user, ACTIONS.UPDATE_REQUEST_STATUS,
      { xa_code, req_id, action: "exclude_thon", thon_code, reason }, req);

    const newVersion = await rebuildManifest(xa_code,
      Number(reqData.year) || new Date().getFullYear());

    return successResponse(res, {
      req_id,
      excluded_thon:    newExcluded,
      manifest_version: newVersion,
      message:          `Thôn ${thon_code} đã được loại khỏi yêu cầu.`,
    });
  }

  // ── action === "complete" ──────────────────────────────────
  const year = Number(reqData.year) || new Date().getFullYear();

  const excludedCodes = new Set(
    (reqData.excluded_thon || []).map(e => e.thon_code)
  );
  const requiredThons = (reqData.danh_sach_thon || [])
    .filter(t => !excludedCodes.has(t));

  if (requiredThons.length === 0) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Không còn thôn nào trong yêu cầu sau khi loại — không thể hoàn thành");
  }

  // Fetch all submissions for this request
  const subsSnap = await paths.submissions(xa_code)
    .where("req_id", "==", req_id)
    .where("year", "==", year)
    .get();

  const verifiedThons = new Set(
    subsSnap.docs
      .map(d => d.data())
      .filter(s => s.status === SUBMISSION_STATUS.VERIFIED ||
                   s.status === "VERIFIED")
      .map(s => s.thon_code)
  );

  const missing = requiredThons.filter(t => !verifiedThons.has(t));

  if (missing.length > 0) {
    return errorResponse(res, ERROR_CODES.REQ_003,
      `Chưa thể hoàn thành — các thôn chưa được duyệt: ${missing.join(", ")}`);
  }

  // All thons verified → mark COMPLETED
  await reqRef.update({
    status:       REQUEST_STATUS.COMPLETED,
    published_at: serverTimestamp(),
    published_by: user.user_id || user.id,
  });

  await logAudit(user, ACTIONS.UPDATE_REQUEST_STATUS,
    { xa_code, req_id, action: "complete", thon_count: requiredThons.length }, req);

  const newVersion = await rebuildManifest(xa_code, year);

  return successResponse(res, {
    req_id,
    new_status:       REQUEST_STATUS.COMPLETED,
    manifest_version: newVersion,
    verified_thons:   [...verifiedThons],
    message:          "Kết quả đã được hoàn thành và công bố.",
  });
}

module.exports = { createRequest, updateRequestStatus };
