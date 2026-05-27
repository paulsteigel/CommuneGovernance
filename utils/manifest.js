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
    generated_at:     _toIso(fullManifest.generated_at),  // FIX: convert Timestamp
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
//   LANH_DAO:      2 reads (manifest + all submissions)
//   Others:        1 read  (manifest only)
// ============================================================

async function buildManifest(xa_code, year, user, client_version = null) {
  // Read 1: pre-computed manifest
  const manifestSnap = await paths.manifest(xa_code).get();

  if (!manifestSnap.exists) {
    const effectiveYear = year || new Date().getFullYear();
    await rebuildManifest(xa_code, effectiveYear);
    return buildManifest(xa_code, effectiveYear, user, null);
  }

  const fullManifest = manifestSnap.data();
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
  // FIX BUG-B2 + BUG-B5: convert Timestamp fields sang ISO string
  if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(user.linh_vuc_codes || []);

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
            submitted_at:  _toIso(s.submitted_at),          // FIX BUG-B5
            verified_at:   _toIso(s.verified_at),            // FIX BUG-B5
            device_collected_at: _toIso(s.device_collected_at), // FIX BUG-B5
            values:        s.values || {},
            tieu_de:       req?.tieu_de || s.req_id,
            deadline:      _toIso(req?.deadline) || req?.deadline || null, // FIX BUG-B5
          };
        });
    } else {
      filtered.pending_verifications = [];
    }
  }

  // ── Read 2c (LANH_DAO): tất cả pending_verifications ─────
  // FIX BUG-B4: LANH_DAO cần nhận toàn bộ submissions không lọc linh_vuc
  if (user.vai_tro === ROLES.LANH_DAO || user.vai_tro === ROLES.ADMIN) {
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

    filtered.pending_verifications = subs.map(s => {
      const req = (fullManifest.requests || []).find(
        r => (r.req_id || r.id) === s.req_id
      );
      return {
        submission_id: s.submission_id || s.id,
        req_id:        s.req_id,
        thon_code:     s.thon_code,
        status:        s.status,
        submitted_by:  s.submitted_by,
        submitted_at:  _toIso(s.submitted_at),               // FIX BUG-B5
        verified_at:   _toIso(s.verified_at),                 // FIX BUG-B5
        device_collected_at: _toIso(s.device_collected_at),  // FIX BUG-B5
        values:        s.values || {},
        tieu_de:       req?.tieu_de || s.req_id,
        deadline:      _toIso(req?.deadline) || req?.deadline || null, // FIX BUG-B5
      };
    });
  }

  return filtered;
}

// ============================================================
// PUBLIC: rebuildManifest
// Reads all ACTIVE indicators + OPEN requests, writes to
// manifests/current. Called after every indicator/request change.
// ============================================================

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
    // FIX BUG-B5: deadline có thể là Timestamp → convert
    requests: requests.map(r => ({
      req_id:         r.req_id || r.id,
      tieu_de:        r.tieu_de,
      chi_so_ids:     _toArray(r.chi_so_ids),
      danh_sach_thon: _toArray(r.danh_sach_thon),
      deadline:       _toIso(r.deadline) || r.deadline || null,
      dinh_ky:        r.dinh_ky || null,
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
 * Convert bất kỳ Timestamp value nào sang ISO string.
 * Handles: null/undefined, ISO string (passthrough),
 *          Firestore Timestamp object { _seconds, _nanoseconds },
 *          Firestore Timestamp với .toDate() method.
 *
 * FIX BUG-B5: đây là root cause của crash CB_CM.
 * submitted_at?.slice(0, 10) crash vì object {} không có .slice().
 * ?. chỉ guard null/undefined — {} là truthy nên không short-circuit.
 */
function _toIso(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

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
