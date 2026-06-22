// middleware/validateToken.js  —  Village Linker V6
// ============================================================
// TWO RESPONSIBILITIES:
//
// 1. TOKEN VALIDATION
//    - Reads user doc (1 Firestore read; same as V5)
//    - Token: 64-char random hex stored in user.session_token
//    - Lazy-sliding expiry: only extends token_expires_at when
//      less than TOKEN_EXTEND_THRESHOLD_DAYS remain (1 write
//      every ~11 months per user, not every request)
//
// 2. ACTIVE PLACEMENT RESOLUTION  (V6 Option C design)
//    - User stores active_placement_index in Firestore
//    - validateToken sets req.active_placement = placements[index]
//    - 0 extra reads (index is in the same user doc)
//    - Multi-device caveat: last switch_placement wins globally
//      (acceptable for 10K rural users; rare multi-device use)
//    - ADMIN / SUPER_ADMIN may have empty placements[] — that's OK;
//      their is_admin / is_super_admin flags bypass tier checks.
// ============================================================
"use strict";

const { paths, serverTimestamp }                 = require("../utils/firestore");
const { QUOTA, ERROR_CODES, USER_STATUS, TIERS } = require("../utils/constants");

/**
 * Validate token and resolve active placement.
 *
 * Sets:
 *   req.user              — full user doc (plain object)
 *   req.active_placement  — active placement or null (admin/super_admin)
 *
 * @param {import('express').Request} req
 * @returns {Promise<object>} resolved user object
 * @throws {{ code, message }} on any auth failure
 */
async function validateToken(req) {
  const { token, user_id } = req.body;

  if (!token || !user_id) {
    throw { code: ERROR_CODES.AUTH_001, message: "Thiếu token hoặc user_id" };
  }

  // ── 1. Read user doc (1 quota unit) ───────────────────────
  const userSnap = await paths.user(user_id).get();

  if (!userSnap.exists) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token không hợp lệ" };
  }

  const user = { id: userSnap.id, ...userSnap.data() };

  // ── 2. Account status ─────────────────────────────────────
  if (user.status !== USER_STATUS.ACTIVE) {
    const msg = user.status === USER_STATUS.PENDING_APPROVAL
      ? "Tài khoản đang chờ phê duyệt. Vui lòng liên hệ Admin xã."
      : "Tài khoản đã bị vô hiệu hóa.";
    throw { code: ERROR_CODES.AUTH_001, message: msg };
  }

  // ── 3. Token match ────────────────────────────────────────
  if (!user.session_token || user.session_token !== token) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token không hợp lệ hoặc đã bị thu hồi" };
  }

  // ── 4. Expiry check ───────────────────────────────────────
  const now       = new Date();
  const expiresAt = _toDate(user.token_expires_at);

  if (!expiresAt || now > expiresAt) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token đã hết hạn. Vui lòng đăng nhập lại." };
  }

  // ── 5. Lazy sliding extension ─────────────────────────────
  // Extend only when close to expiry. Avoids a Firestore write on
  // every request (protects free-tier write quota).
  const thresholdMs = QUOTA.TOKEN_EXTEND_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const timeLeft    = expiresAt.getTime() - now.getTime();

  if (timeLeft < thresholdMs) {
    const newExpiry = _daysFromNow(QUOTA.TOKEN_TTL_DAYS);
    // Fire-and-forget: don't block the request on this write
    paths.user(user_id)
      .update({ token_expires_at: newExpiry })
      .catch(err => console.error("Token extend failed:", err));
    user.token_expires_at = newExpiry;
  }

  // ── 6. Resolve active placement (V6 Option C) ─────────────
  const placements = Array.isArray(user.placements) ? user.placements : [];
  const idx        = Number.isInteger(user.active_placement_index)
    ? user.active_placement_index
    : 0;

  // Clamp to valid range (guard against stale index after placement removal)
  const safeIdx        = idx >= 0 && idx < placements.length ? idx : 0;
  const activePlacement = placements[safeIdx] ?? null;

  // Warn if index was out of range (Admin can correct via approve_user)
  if (placements.length > 0 && safeIdx !== idx) {
    console.warn(`[validateToken] active_placement_index ${idx} out of range for user ${user_id}; clamped to ${safeIdx}`);
  }

  // ── 7. Attach to request ──────────────────────────────────
  req.user             = user;
  req.active_placement = activePlacement;

  return user;
}

// ── Helpers ───────────────────────────────────────────────────

function _toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === "function") return ts.toDate();   // Firestore Timestamp
  if (typeof ts._seconds === "number")
    return new Date(ts._seconds * 1000);                     // serialised Timestamp
  if (typeof ts === "string" || typeof ts === "number")
    return new Date(ts);
  return null;
}

function _daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = { validateToken };