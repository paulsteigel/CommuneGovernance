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
// FIX BUG-A1: xa_code và year không còn bắt buộc từ body.
//   xa_code → luôn lấy từ user record trong Firestore (trusted source).
//   year    → auto-detect từ manifest (xem buildManifest).
//   Body cũ { user_id, password, xa_code, year } vẫn tương thích
//   (xa_code/year trong body bị ignore — không dùng nữa).
//
// Quota: 1 read (user) + 1 write (token) + 2 reads (manifest + subs)
// Total: 4 Firestore ops — không đổi so với trước.
// ============================================================

/**
 * POST /login
 * Body: { user_id, password }         ← existing (backward compatible)
 *       { phone,   password }         ← new: login bằng số điện thoại
 */
async function login(req, res) {
  const { user_id, phone, password } = req.body;
  const loginId = (user_id || phone || "").trim();

  // ── Input validation ─────────────────────────────────────
  if (!loginId || !password) {
    return errorResponse(res, ERROR_CODES.AUTH_002,
      "Vui lòng nhập số điện thoại (hoặc mã cán bộ) và mật khẩu");
  }

  // ── Find user: direct doc → fallback phone query ──────────
  let userSnap = null;
  const directSnap = await paths.user(loginId).get();
  if (directSnap.exists) {
    userSnap = directSnap;
  } else {
    const cleanPhone = loginId.replace(/\s/g, "");
    const phoneQuery = await db.collection("users")
      .where("phone", "==", cleanPhone)
      .limit(1)
      .get();
    if (!phoneQuery.empty) userSnap = phoneQuery.docs[0];
  }

  if (!userSnap || !userSnap.exists) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Sai thông tin đăng nhập");
  }

  const user = { id: userSnap.id, ...userSnap.data() };

  if (user.status === "PENDING_APPROVAL") {
    return errorResponse(res, ERROR_CODES.AUTH_002,
      "Tài khoản đang chờ phê duyệt từ Admin xã. Vui lòng liên hệ Admin.");
  }
  if (user.status !== "ACTIVE") {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Tài khoản đã bị vô hiệu hóa");
  }

  // FIX BUG-A1: xa_code luôn từ user record — không tin body
  const xa_code = user.xa_code;
  if (!xa_code) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Tài khoản chưa được phân xã");
  }

  // ── Password verification ────────────────────────────────
  const passwordValid = verifyPassword(password, user.password_salt, user.password_hash);
  if (!passwordValid) {
    return errorResponse(res, ERROR_CODES.AUTH_002, "Sai tên đăng nhập hoặc mật khẩu");
  }

  // ── Generate new session token ───────────────────────────
  const newToken  = generateToken();
  const expiresAt = tokenExpiresAt(QUOTA.TOKEN_TTL_DAYS);

  // ── Write token — 1 Firestore write ─────────────────────
  await paths.user(user.id).update({
    session_token:    newToken,
    token_expires_at: expiresAt,
    last_login_at:    serverTimestamp(),
  });

  user.session_token    = newToken;
  user.token_expires_at = expiresAt;

  // ── Build filtered manifest — 1-2 reads ─────────────────
  // year=null → buildManifest tự detect từ manifest document
  // Login luôn fetch fresh (no conditional fetch → client_version=null)
  const manifest = await buildManifest(xa_code, null, user, null);

  // ── Audit log ────────────────────────────────────────────
  await logAudit(user, ACTIONS.LOGIN, { xa_code }, req);

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
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.LOGOUT);

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

  const manifest = await buildManifest(
    xa_code,
    Number(year),
    user,
    current_version || null
  );

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
