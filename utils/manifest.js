"use strict";

const { db, paths, queryAll, serverTimestamp } = require("./firestore");
const { ROLES, INDICATOR_STATUS, REQUEST_STATUS, QUOTA } = require("./constants");

// ============================================================
// MANIFEST UTILITIES
//
// Quota optimization baked in:
//   1. Pre-computed manifest stored in manifests/current — 1 read
//      instead of 3 collection reads on every login/pull.
//   2. Conditional fetch: if client sends current_version and it
//      matches, return { up_to_date: true } — 1 read instead of full.
//   3. rebuildManifest() only triggered on actual data changes
//      (create/approve indicator, create request).
// ============================================================

// ============================================================
// PUBLIC: filterManifestForUser
// Applies user-specific filtering to the pre-computed manifest.
// No Firestore reads — pure in-memory filtering.
// ============================================================

/**
 * Filter a full manifest to only include data relevant to this user.
 * Also adds has_submitted flag for CB_THON (from pre-loaded submissions).
 *
 * @param {object} fullManifest    - Raw manifest from manifests/current
 * @param {object} user            - Authenticated user
 * @param {Set}    submittedReqIds - Set of req_ids already submitted by this user's thon
 * @returns {object}               - Filtered manifest ready to send to client
 */
function filterManifestForUser(fullManifest, user, submittedReqIds = new Set()) {
  const { vai_tro, don_vi, linh_vuc_codes } = user;

  let indicators = fullManifest.indicators || [];
  let requests   = fullManifest.requests   || [];

  // ── Indicator filtering ──────────────────────────────────
  if (vai_tro === ROLES.CB_THON) {
    // CB_THON sees all active indicators (needed to understand form)
  } else if (vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(linh_vuc_codes || []);
    indicators = indicators.filter(i => allowedLv.has(i.linh_vuc));
  }
  // LANH_DAO and ADMIN see all indicators

  // ── Request filtering ────────────────────────────────────
  if (vai_tro === ROLES.CB_THON) {
    requests = requests
      .filter(r => Array.isArray(r.danh_sach_thon) && r.danh_sach_thon.includes(don_vi))
      .map(r => ({
        ...r,
        has_submitted: submittedReqIds.has(r.req_id),
        submitted_at:  null,
      }));
  } else if (vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(linh_vuc_codes || []);
    requests = requests.filter(r =>
      r.tao_boi === user.user_id ||
      (Array.isArray(r.chi_so_ids) && r.chi_so_ids.some(id => {
        const ind = (fullManifest.indicators || []).find(i => i.chi_so_id === id);
        return ind && allowedLv.has(ind.linh_vuc);
      }))
    );
  }
  // LANH_DAO and ADMIN see all requests

  return {
    manifest_version: fullManifest.version,
    generated_at:     fullManifest.generated_at,
    expires_at:       _expiresAt(fullManifest.generated_at),

    user: {
      user_id:  user.user_id || user.id,
      ho_ten:   user.ho_ten,
      vai_tro:  user.vai_tro,
      don_vi:   user.don_vi,
      nhanh:    user.nhanh,
      xa_code:  user.xa_code,
      xa_name:  fullManifest.xa_name,
    },

    indicators,
    requests,

    config: {
      drive_folder_id: fullManifest.drive_folder_id,
      current_year:    fullManifest.year,
    },
  };
}

// ============================================================
// PUBLIC: buildManifest
// Reads Firestore and returns a filtered manifest for this user.
//
// Quota:
//   CB_THON:       2 reads (manifest + submissions for has_submitted)
//   CB_CHUYEN_MON: 2 reads (manifest + submissions for pending_verifications)
//   Others:        1 read  (manifest only)
//
// Conditional fetch: if client_version matches current, skip full
// manifest read and return { up_to_date: true } — saves 1 read.
//
// year param is optional: if null/undefined, auto-detected from
// the stored manifest document (supports login without year in body).
// ============================================================

/**
 * Build and return a filtered manifest for the user.
 *
 * @param {string}      xa_code          - Commune code
 * @param {number|null} year             - Data year (null = auto-detect from manifest)
 * @param {object}      user             - Authenticated user
 * @param {string}      [client_version] - Client's current manifest version (conditional fetch)
 * @returns {Promise<object>}            - { up_to_date: true } OR filtered manifest
 */
async function buildManifest(xa_code, year, user, client_version = null) {
  // Read 1: pre-computed manifest
  const manifestSnap = await paths.manifest(xa_code).get();

  if (!manifestSnap.exists) {
    // First time — build from scratch; year must be known here
    const effectiveYear = year || new Date().getFullYear();
    await rebuildManifest(xa_code, effectiveYear);
    return buildManifest(xa_code, effectiveYear, user, null);
  }

  const fullManifest = manifestSnap.data();

  // FIX BUG-A1 support: auto-detect year from manifest if caller didn't pass one
  const effectiveYear = year || fullManifest.year;

  // ── Conditional fetch optimization ──────────────────────
  if (
    QUOTA.MANIFEST_CONDITIONAL_FETCH &&
    client_version &&
    client_version === fullManifest.version
  ) {
    return { up_to_date: true, manifest_version: fullManifest.version };
  }

  // ── Read 2a (CB_THON): has_submitted flags ───────────────
  let submittedReqIds = new Set();
  if (user.vai_tro === ROLES.CB_THON) {
    const subs = await queryAll(
      paths.submissions(xa_code)
        .where("thon_code", "==", user.don_vi)
        .where("year", "==", effectiveYear)
        .select("req_id")
    );
    submittedReqIds = new Set(subs.map(s => s.req_id));
  }

  const filtered = filterManifestForUser(fullManifest, user, submittedReqIds);

  // ── Read 2b (CB_CM): pending_verifications ───────────────
  // FIX BUG-B2: CB_CM cần thấy danh sách submissions đang chờ duyệt.
  if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(user.linh_vuc_codes || []);

    // Tìm req_ids trong linh_vuc của CB_CM này
    const relevantReqIds = new Set(
      (fullManifest.requests || [])
        .filter(r =>
          Array.isArray(r.chi_so_ids) &&
          r.chi_so_ids.some(id => {
            const ind = (fullManifest.indicators || []).find(i => i.chi_so_id === id);
            return ind && allowedLv.has(ind.linh_vuc);
          })
        )
        .map(r => r.req_id || r.id)
    );

    if (relevantReqIds.size > 0) {
      const subs = await queryAll(
        paths.submissions(xa_code)
          .where("year", "==", effectiveYear)
          .where("status", "in", [
            "PENDING_VERIFY",
            "IN_REVIEW",
            "NEEDS_REVISION",
            "VERIFIED",
          ])
      );

      filtered.pending_verifications = subs
        .filter(s => relevantReqIds.has(s.req_id))
        .map(s => {
          const req = (fullManifest.requests || []).find(
            r => (r.req_id || r.id) === s.req_id
          );
          return {
            submission_id: s.submission_id || s.id,
            req_id:        s.req_id,
            thon_code:     s.thon_code,
            status:        s.status,
            submitted_by:  s.submitted_by,
            submitted_at:  s.submitted_at,
            values:        s.values || {},
            tieu_de:       req?.tieu_de || s.req_id,
          };
        });
    } else {
      filtered.pending_verifications = [];
    }
  }

  return filtered;
}

// ============================================================
// PUBLIC: rebuildManifest
// Reads all ACTIVE indicators + OPEN requests, writes to
// manifests/current. Called after every indicator/request change.
//
// Quota: 2 collection reads + 1 write.
// ============================================================

/**
 * Rebuild the pre-computed manifest document for a commune.
 * Must be called after any indicator or request change.
 *
 * @param {string} xa_code - Commune code
 * @param {number} year    - Data year
 * @returns {Promise<string>} - New manifest version string
 */
async function rebuildManifest(xa_code, year) {
  const [indicators, requests, xaSnap] = await Promise.all([
    queryAll(
      paths.indicators(xa_code)
        .where("status", "==", INDICATOR_STATUS.ACTIVE)
        .where("year", "==", year)
    ),
    queryAll(
      paths.requests(xa_code)
        .where("status", "==", REQUEST_STATUS.OPEN)
        .where("year", "==", year)
    ),
    paths.xa(xa_code).get(),
  ]);

  const xaData  = xaSnap.exists ? xaSnap.data() : {};
  const version = `v${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15)}`;

  const manifest = {
    version,
    generated_at:    serverTimestamp(),
    xa_code,
    xa_name:         xaData.xa_name || xa_code,
    year,
    drive_folder_id: xaData.drive_folder_id || null,

    indicators: indicators.map(i => ({
      chi_so_id:    i.chi_so_id || i.id,
      ten_chi_so:   i.ten_chi_so,
      mo_ta:        i.mo_ta || null,
      don_vi_do:    i.don_vi_do || null,
      kieu_du_lieu: i.kieu_du_lieu,
      linh_vuc:     i.linh_vuc,
      validation:   i.validation || {},
    })),

    // FIX BUG-B1: normalize chi_so_ids + danh_sach_thon thành array
    // phòng trường hợp Firestore lưu sai dạng string "CS001 CS002"
    requests: requests.map(r => ({
      req_id:         r.req_id || r.id,
      tieu_de:        r.tieu_de,
      chi_so_ids:     _toArray(r.chi_so_ids),
      danh_sach_thon: _toArray(r.danh_sach_thon),
      deadline:       r.deadline || null,
      ghi_chu:        r.ghi_chu || null,
      tao_boi:        r.tao_boi || null,
    })),
  };

  await paths.manifest(xa_code).set(manifest);
  return version;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Normalize a value to array.
 * Handles: already array, space-separated string, undefined/null.
 */
function _toArray(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return String(val).split(/\s+/).filter(Boolean);
}

function _expiresAt(generatedAt) {
  if (!generatedAt) return null;
  const d = generatedAt.toDate ? generatedAt.toDate() : new Date(generatedAt);
  d.setHours(d.getHours() + QUOTA.MANIFEST_TTL_HOURS);
  return d.toISOString();
}

module.exports = {
  buildManifest,
  rebuildManifest,
  filterManifestForUser,
};
