"use strict";

const { db, serverTimestamp }    = require("../utils/firestore");
const { buildManifest }          = require("../utils/manifest");
const { validateToken }          = require("../middleware/validateToken");
const { checkPermission }        = require("../middleware/checkPermission");
const { logAudit }               = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES }   = require("../utils/constants");

// ============================================================
// PUSH DATA
//
// The core offline-first write endpoint.
// CB_THON collects data offline, then pushes all submissions
// in a single batch when connectivity is restored.
//
// Quota analysis (N = number of submissions in the push):
//   1 read  — validateToken (user doc)
//   N reads — db.getAll() batch-fetch N request docs
//   1 read  — manifests/current (version check)
//   1 read  — duplicate check query (submissions by thon+year+req_ids)
//   N writes— batch.set() for N new submission docs
//   1 write — logAudit
//   2 reads — buildManifest (manifest doc + has_submitted query)
//   ─────────────────────────────────────────────────────────
//   Total: (N+5) reads + (N+1) writes  — minimum possible for N subs
// ============================================================

// Firestore "in" query limit (30 as of 2024 Admin SDK).
// A single push_data should never exceed this in practice.
const FIRESTORE_IN_LIMIT = 30;

/**
 * POST /push_data
 *
 * Body: {
 *   token:                 string,
 *   xa_code:               string,
 *   year:                  number,
 *   manifest_version_used: string,
 *   submissions: [
 *     {
 *       req_id:              string,
 *       device_collected_at: ISO string,
 *       values:              { [chi_so_id]: number|string|boolean },
 *       anh_urls:            string[]   // optional
 *     }
 *   ]
 * }
 */
async function pushData(req, res) {

  // ── 1. Auth & permission ──────────────────────────────────
  // Only CB_THON may push data (Business Rule R2).
  // checkPermission throws immediately if role or scope fails.
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.PUSH_DATA);

  const { xa_code, year, manifest_version_used, submissions } = req.body;
  const thonCode = user.don_vi;   // CB_THON scope is their village
  const yearNum  = Number(year);

  // ── 2. Top-level input validation ────────────────────────
  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu xa_code hoặc year");
  }
  if (!manifest_version_used) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu manifest_version_used");
  }
  if (!Array.isArray(submissions) || submissions.length === 0) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "submissions phải là mảng không rỗng");
  }
  if (submissions.length > FIRESTORE_IN_LIMIT) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `Không thể push quá ${FIRESTORE_IN_LIMIT} submissions trong một lần`);
  }

  // Validate structure of each submission item
  for (const sub of submissions) {
    if (!sub.req_id) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "Mỗi submission phải có req_id");
    }
    if (!sub.device_collected_at) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Submission req_id=${sub.req_id}: thiếu device_collected_at`);
    }
    if (!sub.values || typeof sub.values !== "object" || Array.isArray(sub.values)) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Submission req_id=${sub.req_id}: values phải là object`);
    }
    if (Object.keys(sub.values).length === 0) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Submission req_id=${sub.req_id}: values không được rỗng`);
    }
  }

  // Guard: no duplicate req_id within the same push payload
  const reqIds   = [...new Set(submissions.map(s => s.req_id))];
  if (reqIds.length !== submissions.length) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Payload chứa req_id trùng nhau — mỗi req_id chỉ được gửi một lần");
  }

  const warnings = [];

  // ── 3. Batch-fetch request documents ─────────────────────
  // One db.getAll() call — never loop doc().get()
  const reqRefs = reqIds.map(id =>
    db.collection(`communes/${xa_code}/requests`).doc(id)
  );
  const reqSnaps = await db.getAll(...reqRefs);

  // Index by doc ID for O(1) lookup below
  const requestMap = {};
  for (const snap of reqSnaps) {
    if (snap.exists) {
      requestMap[snap.id] = { id: snap.id, ...snap.data() };
    }
  }

  // ── 4. Validate each request (existence, status, R5 scope)
  for (const sub of submissions) {
    const request = requestMap[sub.req_id];

    // DATA_002: request must exist
    if (!request) {
      return errorResponse(res, ERROR_CODES.DATA_002,
        `Request ${sub.req_id} không tồn tại trong xã ${xa_code}`);
    }

    // DATA_002: request must be open for submission
    if (request.status !== "OPEN" && request.status !== "IN_PROGRESS") {
      return errorResponse(res, ERROR_CODES.DATA_002,
        `Request ${sub.req_id} đã đóng (status hiện tại: ${request.status})`);
    }

    // R5: village of current user must be in request's target list
    // This prevents a CB_THON from forging data for another village
    const targetThons = request.danh_sach_thon || [];
    if (!targetThons.includes(thonCode)) {
      return errorResponse(res, ERROR_CODES.PERM_002,
        `Thôn ${thonCode} không thuộc danh sách yêu cầu nộp của request ${sub.req_id}`);
    }
  }

  // ── 5. Manifest version check ─────────────────────────────
  // Stale manifest → ACCEPT data, but flag for CB_CM during verify.
  // (spec §9: still accept, only add warning SYNC_001)
  const manifestSnap = await db
    .collection(`communes/${xa_code}/manifests`)
    .doc("current")
    .get();

  if (manifestSnap.exists) {
    const currentVersion = manifestSnap.data().version;
    if (manifest_version_used !== currentVersion) {
      warnings.push("MANIFEST_OUTDATED");
    }
  }
  // If manifest doc doesn't exist yet, skip version check silently

  // ── 6. Duplicate check (R7) ───────────────────────────────
  // One query covers all req_ids for this thon in this year.
  // REJECT the entire push if any duplicate found —
  // client should reconcile before retrying.
  const existingSnap = await db
    .collection(`communes/${xa_code}/submissions`)
    .where("thon_code", "==", thonCode)
    .where("year",       "==", yearNum)
    .where("req_id",     "in", reqIds)
    .get();

  if (!existingSnap.empty) {
    const dupes = existingSnap.docs.map(d => d.data().req_id);
    return errorResponse(res, ERROR_CODES.DATA_004,
      `Submission đã tồn tại cho thôn ${thonCode}: req_id = ${dupes.join(", ")}`);
  }

  // ── 7. Batch write all submissions ───────────────────────
  const batch        = db.batch();
  const submissionIds = [];
  const submittedAt  = serverTimestamp();   // single sentinel, safe to reuse

  for (const sub of submissions) {
    const newRef       = db.collection(`communes/${xa_code}/submissions`).doc();
    const submissionId = newRef.id;
    submissionIds.push(submissionId);

    batch.set(newRef, {
      submission_id:         submissionId,
      req_id:                sub.req_id,
      thon_code:             thonCode,
      submitted_by:          user.id,
      submitted_at:          submittedAt,
      device_collected_at:   sub.device_collected_at,
      values:                sub.values,
      anh_urls:              Array.isArray(sub.anh_urls) ? sub.anh_urls : [],
      manifest_version_used: manifest_version_used,
      status:                "PENDING_VERIFY",
      verified_by:           null,
      verified_at:           null,
      rejection_reason:      null,
      year:                  yearNum,
    });
  }

  await batch.commit();

  // ── 8. Audit log ─────────────────────────────────────────
  await logAudit(user, ACTIONS.PUSH_DATA, {
    xa_code,
    year:                  yearNum,
    thon_code:             thonCode,
    submission_ids:        submissionIds,
    req_ids:               reqIds,
    manifest_version_used,
    warnings,
  }, req);

  // ── 9. Return fresh manifest ──────────────────────────────
  // Fetch an up-to-date manifest so the client can update its cache
  // in a single round-trip (offline-first principle: 1 push = all done).
  const newManifest = await buildManifest(xa_code, yearNum, user, null);

  return successResponse(res, {
    processed:      submissions.length,
    submission_ids: submissionIds,
    warnings,
    new_manifest:   newManifest,
  });
}

module.exports = { pushData };