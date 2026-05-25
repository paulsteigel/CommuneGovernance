"use strict";

const { db, paths } = require("../utils/firestore");
const { ERROR_CODES } = require("../utils/constants");

// ============================================================
// TOKEN VALIDATION MIDDLEWARE
//
// Quota optimization:
//   - Single Firestore read per request (users/{user_id} doc only).
//   - user_id is embedded in the request body (not a lookup by token),
//     so we read exactly one document and verify the token matches.
//   - Validated user is attached to req.user for downstream handlers.
// ============================================================

/**
 * Validate the session token sent in every request body.
 * Throws a structured error on failure — asyncHandler will catch it.
 *
 * @param {object} req - Express request (body must have token + user_id)
 * @returns {Promise<object>} - Resolved user data (also set on req.user)
 */
async function validateToken(req) {
  const { token, user_id } = req.body;

  // Basic presence check
  if (!token || !user_id) {
    throw { code: ERROR_CODES.AUTH_001, message: "Thiếu token hoặc user_id" };
  }

  // Single Firestore read — 1 quota unit
  const userSnap = await paths.user(user_id).get();

  if (!userSnap.exists) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token không hợp lệ" };
  }

  const user = { id: userSnap.id, ...userSnap.data() };

  // Check account is active
  if (user.status !== "ACTIVE") {
    throw { code: ERROR_CODES.AUTH_001, message: "Tài khoản đã bị vô hiệu hóa" };
  }

  // Check token matches
  if (!user.session_token || user.session_token !== token) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token không hợp lệ hoặc đã bị thu hồi" };
  }

  // Check token expiry
  const now = new Date();
  const expiresAt = user.token_expires_at?.toDate
    ? user.token_expires_at.toDate()
    : new Date(user.token_expires_at);

  if (!expiresAt || now > expiresAt) {
    throw { code: ERROR_CODES.AUTH_001, message: "Token đã hết hạn. Vui lòng đăng nhập lại." };
  }

  // Attach user to request for downstream use
  req.user = user;
  return user;
}

module.exports = { validateToken };
