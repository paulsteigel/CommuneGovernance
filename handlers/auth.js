"use strict";

const { db, paths, serverTimestamp } = require("../utils/firestore");
const { verifyPassword, generateToken, tokenExpiresAt } = require("../utils/crypto");
const { buildManifest }   = require("../utils/manifest");
const { validateToken }   = require("../middleware/validateToken");
const { checkPermission } = require("../middleware/checkPermission");
const { logAudit }        = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { ACTIONS, ERROR_CODES, QUOTA }    = require("../utils/constants");

// ============================================================
// LOGIN
//
// Quota: 1 read (user doc) + 1 write (update token) + 2 reads (manifest)
// Total: 4 Firestore ops per login — minimum possible.
// ============================================================

/**
 * POST /login
 * Body: { user_id, password, xa_code, year }
 */
async function login(req, res) {
  const { user_id, password, xa_code, year } = req.body;

  // ── Input validation ─────────────────────────────────────
  if (!user_id || !password || !xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu thông tin đăng nhập (user_id, password, xa_code, year)");
  }

  // ── Read user — 1 Firestore read ─────────────────────────
  const userSnap = await paths.user(user_id).get();
  if (!userSnap.exists) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Sai tên đăng nhập hoặc mật khẩu");
  }

  const user = { id: userSnap.id, ...userSnap.data() };

  // Check account status
  if (user.status !== "ACTIVE") {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Tài khoản đã bị vô hiệu hóa");
  }

  // Check xa_code matches user's commune
  if (user.xa_code !== xa_code) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Sai tên đăng nhập hoặc mật khẩu");
  }

  // ── Password verification ────────────────────────────────
  const passwordValid = verifyPassword(password, user.password_salt, user.password_hash);
  if (!passwordValid) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Sai tên đăng nhập hoặc mật khẩu");
  }

  // ── Generate new session token ───────────────────────────
  const newToken   = generateToken();
  const expiresAt  = tokenExpiresAt(QUOTA.TOKEN_TTL_DAYS);

  // ── Write token — 1 Firestore write ─────────────────────
  await paths.user(user_id).update({
    session_token:    newToken,
    token_expires_at: expiresAt,
    last_login_at:    serverTimestamp(),
  });

  // Update user object for manifest building
  user.session_token    = newToken;
  user.token_expires_at = expiresAt;

  // ── Build filtered manifest — 2 reads ───────────────────
  // Login always fetches fresh manifest (no conditional fetch on login)
  const manifest = await buildManifest(xa_code, Number(year), user, null);

  // ── Audit log ────────────────────────────────────────────
  await logAudit(user, ACTIONS.LOGIN, { xa_code, year }, req);

  return successResponse(res, {
    token:    newToken,
    manifest,
  });
}

// ============================================================
// LOGOUT
//
// Quota: 1 read (validateToken) + 1 write (clear token)
// ============================================================

/**
 * POST /logout
 * Body: { token, user_id, xa_code, year }
 */
async function logout(req, res) {
  // Validate token first (also attaches req.user)
  const user = await validateToken(req);

  checkPermission(user, ACTIONS.LOGOUT);

  // Clear token from Firestore — 1 write
  await paths.user(user.id).update({
    session_token:    null,
    token_expires_at: null,
  });

  await logAudit(user, ACTIONS.LOGOUT, {}, req);

  return successResponse(res, { message: "Đăng xuất thành công" });
}

// ============================================================
// PULL MANIFEST
//
// Quota optimization:
//   - If client sends current manifest_version AND it matches
//     server version → return { up_to_date: true } (1 read only)
//   - If stale → return fresh filtered manifest (2-3 reads)
// ============================================================

/**
 * POST /pull_manifest
 * Body: { token, user_id, xa_code, year, current_version? }
 */
async function pullManifest(req, res) {
  const user = await validateToken(req);

  checkPermission(user, ACTIONS.PULL_MANIFEST);

  const { xa_code, year, current_version } = req.body;

  if (!xa_code || !year) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc year");
  }

  // Build manifest — conditional fetch handled inside buildManifest
  const manifest = await buildManifest(
    xa_code,
    Number(year),
    user,
    current_version || null
  );

  // If manifest is current, return lightweight response (save bytes + quota)
  if (manifest.up_to_date) {
    return successResponse(res, {
      up_to_date:       true,
      manifest_version: manifest.manifest_version,
    });
  }

  await logAudit(user, ACTIONS.PULL_MANIFEST, {
    xa_code,
    year,
    manifest_version: manifest.manifest_version,
    was_stale: current_version !== manifest.manifest_version,
  }, req);

  return successResponse(res, { manifest });
}

module.exports = { login, logout, pullManifest };
