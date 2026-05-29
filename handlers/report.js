// handlers/report.js
"use strict";

// ============================================================
// REPORT HANDLER
//
// GET /report_data — Aggregate VERIFIED submissions by indicator.
// Supports year comparison (current year vs compare_year).
// All roles can access; CB_THON filtered to own thôn.
//
// Quota:
//   1 read  — validateToken
//   1 read  — VERIFIED submissions (current year)
//   0-1 read — VERIFIED submissions (compare_year, if provided)
//   1 write — audit log
//   Total: 3-4 reads + 1 write
// ============================================================

const { paths, queryAll }                = require("../utils/firestore");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, ROLES, SUBMISSION_STATUS } = require("../utils/constants");

async function getReportData(req, res) {
  const user = await validateToken(req);

  // GET: params come via query string (merged in index.js)
  const { xa_code, year, compare_year } = req.body;
  const yearNum    = Number(year);
  const compareNum = compare_year ? Number(compare_year) : null;

  if (!xa_code || !year)
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  if (isNaN(yearNum))
    return errorResponse(res, ERROR_CODES.DATA_001, "year không hợp lệ");

  checkPermission(user, ACTIONS.GET_REPORT_DATA, {});

  // ── Fetch submissions ─────────────────────────────────────
  // CB_THON: only own thôn. Others: all thôns.
  function buildQuery(yearTarget) {
    let q = paths.submissions(xa_code)
      .where("year",   "==", yearTarget)
      .where("status", "==", SUBMISSION_STATUS.VERIFIED);
    if (user.vai_tro === ROLES.CB_THON) {
      q = q.where("thon_code", "==", user.don_vi);
    }
    return q;
  }

  const [currentSubs, compareSubs] = await Promise.all([
    queryAll(buildQuery(yearNum)),
    compareNum ? queryAll(buildQuery(compareNum)) : Promise.resolve([]),
  ]);

  // ── Aggregate function ────────────────────────────────────
  // For each (chi_so_id, thon_code): keep the value from the
  // most recently verified submission (latest verified_at wins).
  function aggregate(subs) {
    // latest[chi_so_id][thon_code] = { value, verified_at }
    const latest = {};

    for (const sub of subs) {
      const values     = sub.values || {};
      const verifiedAt = sub.verified_at;

      for (const [chi_so_id, value] of Object.entries(values)) {
        if (!latest[chi_so_id]) latest[chi_so_id] = {};
        const existing = latest[chi_so_id][sub.thon_code];

        const isNewer = !existing || (
          verifiedAt &&
          (!existing.verified_at ||
            (verifiedAt.seconds || 0) > (existing.verified_at?.seconds || 0))
        );

        if (isNewer) {
          latest[chi_so_id][sub.thon_code] = { value, verified_at: verifiedAt };
        }
      }
    }

    // Summarize per indicator
    const result = {};
    for (const [chi_so_id, byThon] of Object.entries(latest)) {
      const entries = Object.entries(byThon).map(([thon, d]) => ({
        thon, value: d.value,
      }));

      const numeric  = entries.filter(e => typeof e.value === "number");
      const boolTrue = entries.filter(e => e.value === true).length;

      result[chi_so_id] = {
        by_thon:    Object.fromEntries(entries.map(e => [e.thon, e.value])),
        total:      numeric.length > 0
          ? Math.round(numeric.reduce((s, e) => s + e.value, 0) * 100) / 100
          : null,
        count_true: boolTrue > 0 ? boolTrue : null,
        thon_count: entries.length,
      };
    }
    return result;
  }

  await logAudit(user, ACTIONS.GET_REPORT_DATA, {
    xa_code, year: yearNum,
    compare_year: compareNum || null,
  }, req);

  return successResponse(res, {
    xa_code,
    year:         yearNum,
    compare_year: compareNum,
    data:         aggregate(currentSubs),
    compare:      compareNum ? aggregate(compareSubs) : null,
    generated_at: new Date().toISOString(),
  });
}

module.exports = { getReportData };
