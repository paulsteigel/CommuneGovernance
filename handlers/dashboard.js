// handlers/dashboard.js
"use strict";

// ============================================================
// DASHBOARD HANDLER
//
// getDashboard — LANH_DAO / ADMIN xem tổng quan tiến độ
//               nộp số liệu và tình trạng verify theo xã/năm.
//
// Quota (cực kỳ thấp):
//   1 read  — validateToken
//   1 read  — requests query  (communes/{xa}/requests where year==N)
//   1 read  — submissions query (communes/{xa}/submissions where year==N)
//   1 write — audit log
//   ───────────────────────────────
//   Total: 3 reads + 1 write (tất cả join trong memory)
// ============================================================

const { paths }                          = require("../utils/firestore");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, SUBMISSION_STATUS } = require("../utils/constants");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ISO date string → "YYYY-MM-DD" */
function toDateStr(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().split("T")[0];
}

/** Count submissions matching a status */
function countByStatus(subs, status) {
  return subs.filter(s => s.status === status).length;
}

// ─── getDashboard ────────────────────────────────────────────────────────────

/**
 * GET /dashboard
 * (params come via query string, merged into req.body by index.js)
 *
 * Params: { token, user_id, xa_code, year, req_id? }
 *
 * Response:
 * {
 *   xa_code, year, generated_at,
 *   requests: [{
 *     req_id, tieu_de, deadline, req_status,
 *     total_thon,       // danh_sach_thon.length
 *     submitted_thon,   // distinct thons that submitted anything
 *     verified_thon,    // thons with status VERIFIED
 *     status_breakdown: { PENDING_VERIFY, IN_REVIEW, VERIFIED, NEEDS_REVISION },
 *     completion_pct,   // verified_thon / total_thon × 100
 *     overdue,          // deadline passed and not fully verified
 *     needs_attention,  // NEEDS_REVISION + IN_REVIEW count
 *   }],
 *   summary: {
 *     total_requests, total_submissions,
 *     verified, needs_attention, pending_verify,
 *   }
 * }
 */
async function getDashboard(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const { xa_code, year, req_id } = req.body;
  const yearNum = Number(year);

  // ── 2. Validation ─────────────────────────────────────────
  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu xa_code hoặc year");
  }
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "year không hợp lệ");
  }

  // ── 3. Permission check ───────────────────────────────────
  // Only LANH_DAO and ADMIN (enforced in PERMISSION_MATRIX)
  checkPermission(user, ACTIONS.GET_DASHBOARD, {});

  // ── 4. Fetch requests (1 Firestore read) ──────────────────
  // If req_id filter provided, use it; otherwise get all for xa+year
  let requestQuery = paths.requests(xa_code).where("year", "==", yearNum);
  if (req_id) {
    requestQuery = paths.requests(xa_code)
      .where("year", "==", yearNum)
      .where("req_id", "==", req_id);
  }
  const requestsSnap = await requestQuery.get();
  const requestDocs  = requestsSnap.docs.map(d => d.data());

  // ── 5. Fetch submissions (1 Firestore read) ───────────────
  const subsSnap = await paths.submissions(xa_code)
    .where("year", "==", yearNum)
    .get();
  const subDocs = subsSnap.docs.map(d => d.data());

  // ── 6. Join in memory ─────────────────────────────────────
  // Group submissions by req_id
  const subsByReq = {};
  for (const sub of subDocs) {
    if (!subsByReq[sub.req_id]) subsByReq[sub.req_id] = [];
    subsByReq[sub.req_id].push(sub);
  }

  const today = new Date().toISOString().split("T")[0];

  const requestSummaries = requestDocs.map(request => {
    const subs      = subsByReq[request.req_id] || [];
    const totalThon = Array.isArray(request.danh_sach_thon)
      ? request.danh_sach_thon.length
      : 0;

    // Distinct thons that have submitted anything
    const submittedThons = new Set(subs.map(s => s.thon_code));

    const statusBreakdown = {
      [SUBMISSION_STATUS.PENDING_VERIFY]: countByStatus(subs, SUBMISSION_STATUS.PENDING_VERIFY),
      [SUBMISSION_STATUS.IN_REVIEW]:      countByStatus(subs, SUBMISSION_STATUS.IN_REVIEW),
      [SUBMISSION_STATUS.VERIFIED]:       countByStatus(subs, SUBMISSION_STATUS.VERIFIED),
      [SUBMISSION_STATUS.NEEDS_REVISION]: countByStatus(subs, SUBMISSION_STATUS.NEEDS_REVISION),
    };

    const verifiedThon   = statusBreakdown[SUBMISSION_STATUS.VERIFIED];
    const needsAttention = statusBreakdown[SUBMISSION_STATUS.NEEDS_REVISION]
                         + statusBreakdown[SUBMISSION_STATUS.IN_REVIEW];

    const completionPct = totalThon > 0
      ? Math.round((verifiedThon / totalThon) * 100)
      : 0;

    const overdue = request.deadline < today && verifiedThon < totalThon;

    return {
      req_id:          request.req_id,
      tieu_de:         request.tieu_de,
      deadline:        request.deadline,
      req_status:      request.status,
      total_thon:      totalThon,
      submitted_thon:  submittedThons.size,
      verified_thon:   verifiedThon,
      status_breakdown: statusBreakdown,
      completion_pct:  completionPct,
      overdue,
      needs_attention: needsAttention,
      // Which thons haven't submitted yet (useful for follow-up)
      missing_thons: request.danh_sach_thon
        ? request.danh_sach_thon.filter(t => !submittedThons.has(t))
        : [],
    };
  });

  // ── 7. Overall summary ────────────────────────────────────
  const summary = {
    total_requests:   requestDocs.length,
    total_submissions: subDocs.length,
    verified:         countByStatus(subDocs, SUBMISSION_STATUS.VERIFIED),
    needs_attention:  subDocs.filter(s =>
      s.status === SUBMISSION_STATUS.NEEDS_REVISION ||
      s.status === SUBMISSION_STATUS.IN_REVIEW
    ).length,
    pending_verify:   countByStatus(subDocs, SUBMISSION_STATUS.PENDING_VERIFY),
  };

  // ── 8. Audit log ──────────────────────────────────────────
  await logAudit(user, ACTIONS.GET_DASHBOARD, {
    xa_code, year: yearNum,
    req_id_filter: req_id || null,
  }, req);

  return successResponse(res, {
    xa_code,
    year:         yearNum,
    generated_at: new Date().toISOString(),
    requests:     requestSummaries,
    summary,
  });
}

module.exports = { getDashboard };
