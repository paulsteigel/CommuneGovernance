"use strict";

const { db, paths, queryAll, serverTimestamp } = require("./firestore");
const { ROLES, INDICATOR_STATUS, REQUEST_STATUS, QUOTA } = require("./constants");

// ============================================================
// MANIFEST UTILITIES  v3
//
// Added (v3):
//   CB_CM manifest now includes:
//     my_indicators[]  — own indicators (all statuses) for management UI
//   LANH_DAO manifest now includes:
//     pending_indicators[] — PENDING indicators awaiting approval
//   Reads are run in parallel (Promise.all) to keep latency low.
// ============================================================

function filterManifestForUser(fullManifest, user, submittedReqIds = new Set()) {
  const { vai_tro, don_vi, linh_vuc_codes } = user;

  let indicators = fullManifest.indicators || [];
  let requests   = fullManifest.requests   || [];

  if (vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(linh_vuc_codes || []);
    indicators = indicators.filter(i => allowedLv.has(i.linh_vuc));
  }

  if (vai_tro === ROLES.CB_THON) {
    requests = requests
      .filter(r => Array.isArray(r.danh_sach_thon) && r.danh_sach_thon.includes(don_vi))
      .map(r => ({
        ...r,
        has_submitted:     submittedReqIds.has(r.req_id),
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

async function buildManifest(xa_code, year, user, client_version = null) {
  const manifestSnap = await paths.manifest(xa_code).get();

  if (!manifestSnap.exists) {
    const effectiveYear = year || new Date().getFullYear();
    await rebuildManifest(xa_code, effectiveYear);
    return buildManifest(xa_code, effectiveYear, user, null);
  }

  const fullManifest = manifestSnap.data();
  const effectiveYear = year || fullManifest.year;

  if (QUOTA.MANIFEST_CONDITIONAL_FETCH && client_version && client_version === fullManifest.version) {
    return { up_to_date: true, manifest_version: fullManifest.version };
  }

  // ── CB_THON: full submission data ────────────────────────
  let submittedReqIds = new Set();
  let subByReq = {};

  if (user.vai_tro === ROLES.CB_THON) {
    const subs = await queryAll(
      paths.submissions(xa_code)
        .where("thon_code", "==", user.don_vi)
        .where("year",      "==", effectiveYear)
    );
    for (const s of subs) { subByReq[s.req_id] = s; }
    submittedReqIds = new Set(Object.keys(subByReq));
  }

  const filtered = filterManifestForUser(fullManifest, user, submittedReqIds);

  // CB_THON: enrich requests with submission state
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

  // ── CB_CM: submissions + own indicators (parallel) ───────
  if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
    const allowedLv = new Set(user.linh_vuc_codes || []);
    const relevantReqIds = new Set(
      (fullManifest.requests || [])
        .filter(r => Array.isArray(r.chi_so_ids) && r.chi_so_ids.some(id => {
          const ind = (fullManifest.indicators || []).find(i => i.chi_so_id === id);
          return ind && allowedLv.has(ind.linh_vuc);
        }))
        .map(r => r.req_id || r.id)
    );

    const userId = user.user_id || user.id;

    const [allSubs, myInds] = await Promise.all([
      relevantReqIds.size > 0
        ? queryAll(paths.submissions(xa_code)
            .where("year",   "==", effectiveYear)
            .where("status", "in", ["PENDING_VERIFY", "IN_REVIEW", "NEEDS_REVISION"]))
        : Promise.resolve([]),
      queryAll(paths.indicators(xa_code)
        .where("year",       "==", effectiveYear)
        .where("created_by", "==", userId)),
    ]);

    const relevant = allSubs.filter(s => relevantReqIds.has(s.req_id));

    filtered.pending_verifications = relevant
      .filter(s => s.status === "PENDING_VERIFY" || s.status === "IN_REVIEW")
      .map(s => _mapSubmission(s, fullManifest.requests));

    filtered.waiting_revision = relevant
      .filter(s => s.status === "NEEDS_REVISION")
      .map(s => _mapSubmission(s, fullManifest.requests));

    // my_indicators: all statuses of own indicators for management UI
    filtered.my_indicators = myInds.map(ind => ({
      chi_so_id:        ind.chi_so_id || ind.id,
      ten_chi_so:       ind.ten_chi_so,
      don_vi_do:        ind.don_vi_do || null,
      kieu_du_lieu:     ind.kieu_du_lieu,
      linh_vuc:         ind.linh_vuc,
      status:           ind.status,
      rejection_reason: ind.rejection_reason || null,
      created_at:       _toIso(ind.created_at),
      updated_at:       _toIso(ind.updated_at),
    }));
  }

  // ── LANH_DAO: submissions + pending indicators (parallel) ─
  if (user.vai_tro === ROLES.LANH_DAO || user.vai_tro === ROLES.ADMIN) {
    const [allSubs, pendingInds] = await Promise.all([
      queryAll(paths.submissions(xa_code)
        .where("year",   "==", effectiveYear)
        .where("status", "in", ["PENDING_VERIFY", "IN_REVIEW", "NEEDS_REVISION"])),
      queryAll(paths.indicators(xa_code)
        .where("year",   "==", effectiveYear)
        .where("status", "==", "PENDING")
        .where("nhanh",  "==", user.nhanh)),
    ]);

    filtered.pending_verifications = allSubs
      .filter(s => s.status === "PENDING_VERIFY")
      .map(s => _mapSubmission(s, fullManifest.requests));

    filtered.waiting_revision = allSubs
      .filter(s => s.status === "IN_REVIEW" || s.status === "NEEDS_REVISION")
      .map(s => _mapSubmission(s, fullManifest.requests));

    // pending_indicators: PENDING indicators awaiting LANH_DAO approval
    filtered.pending_indicators = pendingInds.map(ind => ({
      chi_so_id:    ind.chi_so_id || ind.id,
      ten_chi_so:   ind.ten_chi_so,
      don_vi_do:    ind.don_vi_do || null,
      mo_ta:        ind.mo_ta || null,
      kieu_du_lieu: ind.kieu_du_lieu,
      linh_vuc:     ind.linh_vuc,
      status:       ind.status,
      created_by:   ind.created_by || null,
      created_at:   _toIso(ind.created_at),
    }));
  }

  return filtered;
}

async function rebuildManifest(xa_code, year) {
  const [indicators, requests, xaSnap] = await Promise.all([
    queryAll(paths.indicators(xa_code)
      .where("status", "==", INDICATOR_STATUS.ACTIVE)
      .where("year",   "==", year)),
    queryAll(paths.requests(xa_code)
      .where("status", "==", REQUEST_STATUS.OPEN)
      .where("year",   "==", year)),
    paths.xa(xa_code).get(),
  ]);

  const xaData  = xaSnap.exists ? xaSnap.data() : {};
  const version = `v${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15)}`;

  await paths.manifest(xa_code).set({
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
  });

  return version;
}

// ── Helpers ───────────────────────────────────────────────────

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

function _toIso(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

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
