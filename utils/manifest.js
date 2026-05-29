"use strict";

const { db, paths, queryAll, serverTimestamp } = require("./firestore");
const { ROLES, INDICATOR_STATUS, REQUEST_STATUS, QUOTA } = require("./constants");

// ============================================================
// MANIFEST UTILITIES  v2
//
// Changes from v1:
//   - CB_THON: manifest now includes full submission state per
//     request (submission_id, submission_status, verify_comment,
//     indicator_reviews, submitted_values) so CB_THON can see
//     rejections and resubmit offline-first.
//
//   - CB_CM:
//       pending_verifications = PENDING_VERIFY + IN_REVIEW  (actionable)
//       waiting_revision      = NEEDS_REVISION              (informational)
//
//   - LANH_DAO / ADMIN:
//       pending_verifications = PENDING_VERIFY only          (bypass-able)
//       waiting_revision      = IN_REVIEW + NEEDS_REVISION   (informational)
//
//   - _mapSubmission helper centralized to avoid duplication.
// ============================================================

// ============================================================
// PUBLIC: filterManifestForUser
// Pure in-memory filter — no Firestore reads.
// ============================================================
function filterManifestForUser(fullManifest, user, submittedReqIds = new Set()) {
  const { vai_tro, don_vi, linh_vuc_codes } = user;

  let indicators = fullManifest.indicators || [];
  let requests   = fullManifest.requests   || [];

  // ── Indicator filtering ──────────────────────────────────
  if (vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(linh_vuc_codes || []);
    indicators = indicators.filter(i => allowedLv.has(i.linh_vuc));
  }
  // LANH_DAO / ADMIN / CB_THON: see all active indicators

  // ── Request filtering ────────────────────────────────────
  if (vai_tro === ROLES.CB_THON) {
    requests = requests
      .filter(r => Array.isArray(r.danh_sach_thon) && r.danh_sach_thon.includes(don_vi))
      .map(r => ({
        ...r,
        has_submitted:     submittedReqIds.has(r.req_id),
        // submission_id, submission_status etc. enriched in buildManifest
        submission_id:     null,
        submission_status: null,
        verify_comment:    null,
        indicator_reviews: null,
        submitted_values:  null,
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
  // LANH_DAO / ADMIN: see all requests

  return {
    manifest_version: fullManifest.version,
    generated_at:     _toIso(fullManifest.generated_at),
    expires_at:       _expiresAt(fullManifest.generated_at),
    user: {
      user_id: user.user_id || user.id,
      ho_ten:  user.ho_ten,
      vai_tro: user.vai_tro,
      don_vi:  user.don_vi,
      nhanh:   user.nhanh,
      xa_code: user.xa_code,
      xa_name: fullManifest.xa_name,
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
//
// Quota:
//   CB_THON:       2 reads (manifest + own submissions)
//   CB_CM:         2 reads (manifest + pending subs)
//   LANH_DAO:      2 reads (manifest + pending subs)
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

  // ── Read 2a (CB_THON): full submissions for status enrichment ─
  let submittedReqIds = new Set();
  let subByReq = {};

  if (user.vai_tro === ROLES.CB_THON) {
    const subs = await queryAll(
      paths.submissions(xa_code)
        .where("thon_code", "==", user.don_vi)
        .where("year", "==", effectiveYear)
    );
    for (const s of subs) {
      subByReq[s.req_id] = s;
    }
    submittedReqIds = new Set(Object.keys(subByReq));
  }

  const filtered = filterManifestForUser(fullManifest, user, submittedReqIds);

  // ── Enrich CB_THON requests with submission state ────────
  // CB_THON now knows: submission_status, rejection reason,
  // indicator_reviews, and old values to pre-fill resubmit form.
  if (user.vai_tro === ROLES.CB_THON) {
    filtered.requests = filtered.requests.map(r => {
      const sub = subByReq[r.req_id];
      if (!sub) return r;
      return {
        ...r,
        submission_id:     sub.submission_id || sub.id,
        submission_status: sub.status || null,
        verify_comment:    sub.verify_comment || null,
        indicator_reviews: sub.indicator_reviews || null,
        submitted_values:  sub.values || null,
      };
    });
  }

  // ── Read 2b (CB_CM): single query, split in memory ───────
  //   pending_verifications = PENDING_VERIFY + IN_REVIEW  (actionable)
  //   waiting_revision      = NEEDS_REVISION              (informational only)
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
      const allSubs = await queryAll(
        paths.submissions(xa_code)
          .where("year", "==", effectiveYear)
          .where("status", "in", ["PENDING_VERIFY", "IN_REVIEW", "NEEDS_REVISION"])
      );

      const relevant = allSubs.filter(s => relevantReqIds.has(s.req_id));

      filtered.pending_verifications = relevant
        .filter(s => s.status === "PENDING_VERIFY" || s.status === "IN_REVIEW")
        .map(s => _mapSubmission(s, fullManifest.requests));

      filtered.waiting_revision = relevant
        .filter(s => s.status === "NEEDS_REVISION")
        .map(s => _mapSubmission(s, fullManifest.requests));
    } else {
      filtered.pending_verifications = [];
      filtered.waiting_revision = [];
    }
  }

  // ── Read 2c (LANH_DAO / ADMIN): single query, split in memory ─
  //   pending_verifications = PENDING_VERIFY only          (bypass-able)
  //   waiting_revision      = IN_REVIEW + NEEDS_REVISION   (informational only)
  if (user.vai_tro === ROLES.LANH_DAO || user.vai_tro === ROLES.ADMIN) {
    const allSubs = await queryAll(
      paths.submissions(xa_code)
        .where("year", "==", effectiveYear)
        .where("status", "in", ["PENDING_VERIFY", "IN_REVIEW", "NEEDS_REVISION"])
    );

    filtered.pending_verifications = allSubs
      .filter(s => s.status === "PENDING_VERIFY")
      .map(s => _mapSubmission(s, fullManifest.requests));

    filtered.waiting_revision = allSubs
      .filter(s => s.status === "IN_REVIEW" || s.status === "NEEDS_REVISION")
      .map(s => _mapSubmission(s, fullManifest.requests));
  }

  return filtered;
}

// ============================================================
// PUBLIC: rebuildManifest
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
 * Map a Firestore submission doc to the manifest response shape.
 * Used by CB_CM and LANH_DAO sections.
 */
function _mapSubmission(s, requests) {
  const req = (requests || []).find(r => (r.req_id || r.id) === s.req_id);
  return {
    submission_id:       s.submission_id || s.id,
    req_id:              s.req_id,
    thon_code:           s.thon_code,
    status:              s.status,
    submitted_by:        s.submitted_by,
    submitted_at:        _toIso(s.submitted_at),
    verified_at:         _toIso(s.verified_at),
    device_collected_at: _toIso(s.device_collected_at),
    values:              s.values || {},
    verify_comment:      s.verify_comment || null,
    indicator_reviews:   s.indicator_reviews || null,
    tieu_de:             req?.tieu_de || s.req_id,
    deadline:            _toIso(req?.deadline) || req?.deadline || null,
  };
}

/** Convert any Timestamp to ISO string. */
function _toIso(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

/** Normalize to array. */
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

module.exports = { buildManifest, rebuildManifest, filterManifestForUser };