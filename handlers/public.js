"use strict";

// ============================================================
// PUBLIC HANDLER — GET /public/xa/:xa_code/results
//
// No authentication required.
// Returns COMPLETED requests with aggregated VERIFIED values.
// Used by: public-facing overview, web kiosk at commune office.
//
// Quota: 2-3 reads (requests + submissions batch)
// Rate-limited by Cloud Run (max 100 req/min per IP in production)
// ============================================================

const { db, paths, queryAll } = require("../utils/firestore");
const { REQUEST_STATUS, SUBMISSION_STATUS } = require("../utils/constants");
const { successResponse, errorResponse } = require("../utils/response");
const ERROR_CODES = { DATA_001: "DATA_001", SYS_001: "SYS_001" };

/**
 * GET /public/xa/:xa_code/results
 * Query params: ?year=2025&nhanh=UBND (both optional)
 *
 * Returns:
 *   { xa_code, xa_name, year, nhanh_filter, results: [ {request, indicators, thon_data} ] }
 */
async function getPublicResults(req, res) {
  const { xa_code }  = req.params;
  const yearParam    = req.query.year  ? Number(req.query.year)  : null;
  const nhanhFilter  = req.query.nhanh || null;

  if (!xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  }

  // ── 1. Get xa info from manifest (1 read) ────────────────
  const manifestSnap = await paths.manifest(xa_code).get();
  const xa_name = manifestSnap.exists
    ? (manifestSnap.data().xa_name || xa_code)
    : xa_code;
  const year = yearParam || (manifestSnap.exists
    ? manifestSnap.data().year
    : new Date().getFullYear());

  // ── 2. Query COMPLETED requests ──────────────────────────
  let reqQuery = paths.requests(xa_code)
    .where("status",       "==", REQUEST_STATUS.COMPLETED)
    .where("year",         "==", year)
    .where("published_at", "!=", null);

  const completedReqs = await queryAll(reqQuery);

  if (completedReqs.length === 0) {
    return successResponse(res, {
      xa_code, xa_name, year,
      nhanh_filter: nhanhFilter,
      results: [],
      message: "Chưa có kết quả được công bố",
    });
  }

  // Apply nhanh filter
  const filtered = nhanhFilter
    ? completedReqs.filter(r => r.nhanh === nhanhFilter)
    : completedReqs;

  // ── 3. Get indicators map (from manifest) ─────────────────
  let indicatorMap = {};
  if (manifestSnap.exists) {
    for (const ind of (manifestSnap.data().indicators || [])) {
      indicatorMap[ind.chi_so_id] = ind;
    }
  }

  // ── 4. For each request — fetch verified submissions ──────
  const results = await Promise.all(filtered.map(async (request) => {
    const subs = await queryAll(
      paths.submissions(xa_code)
        .where("req_id", "==", request.req_id || request.id)
        .where("year",   "==", year)
        .where("status", "==", SUBMISSION_STATUS.VERIFIED || "VERIFIED")
    );

    // Build per-thon table
    const thon_data = subs.map(s => ({
      thon_code:  s.thon_code,
      values:     _sanitizeValues(s.values),
      verified_at: s.verified_at
        ? (s.verified_at.toDate ? s.verified_at.toDate().toISOString() : s.verified_at)
        : null,
    }));

    // Aggregate across thons per indicator
    const aggregated = {};
    for (const chi_so_id of (request.chi_so_ids || [])) {
      const ind  = indicatorMap[chi_so_id];
      const vals = subs
        .map(s => s.values?.[chi_so_id])
        .filter(v => v !== undefined && v !== null && v !== "");

      aggregated[chi_so_id] = {
        ten_chi_so:  ind?.ten_chi_so  || chi_so_id,
        don_vi_do:   ind?.don_vi_do   || "",
        kieu_du_lieu: ind?.kieu_du_lieu || "so",
        aggregation_method: ind?.aggregation_method || "SUM",
        value: _aggregate(vals, ind?.aggregation_method || "SUM", ind?.kieu_du_lieu),
        thon_count: vals.length,
      };
    }

    return {
      req_id:       request.req_id || request.id,
      tieu_de:      request.tieu_de,
      nhanh:        request.nhanh,
      linh_vuc_list: request.linh_vuc_list || [],
      deadline:     request.deadline,
      published_at: request.published_at
        ? (request.published_at.toDate
            ? request.published_at.toDate().toISOString()
            : request.published_at)
        : null,
      total_thon:    (request.danh_sach_thon || []).length,
      verified_thon: subs.length,
      aggregated,
      thon_data,
    };
  }));

  return successResponse(res, {
    xa_code,
    xa_name,
    year,
    nhanh_filter: nhanhFilter,
    generated_at: new Date().toISOString(),
    results: results.sort((a, b) =>
      (b.published_at || "").localeCompare(a.published_at || "")
    ),
  });
}

// ── Helpers ──────────────────────────────────────────────────

function _sanitizeValues(values) {
  if (!values || typeof values !== "object") return {};
  // Strip any file_ids (don't expose in public API)
  const clean = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string" || !v.startsWith("1")) {
      clean[k] = v; // rough heuristic: Drive IDs start with "1"
    } else {
      clean[k] = "[ảnh]";
    }
  }
  return clean;
}

function _aggregate(vals, method, kieu_du_lieu) {
  if (!vals || vals.length === 0) return null;
  if (kieu_du_lieu === "text" || kieu_du_lieu === "boolean") return vals;

  const nums = vals.map(Number).filter(n => !isNaN(n));
  if (nums.length === 0) return null;

  if (method === "AVERAGE") {
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  }
  // Default: SUM
  return nums.reduce((a, b) => a + b, 0);
}

module.exports = { getPublicResults };
