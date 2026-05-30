"use strict";

const crypto = require("crypto");

// ============================================================
// PASSWORD HASHING
// Using SHA-256 + per-user random salt.
// bcrypt is avoided: too slow for Cloud Functions cold start.
// Salt is stored separately in Firestore (users/{id}.password_salt).
// ============================================================

/**
 * Hash a plaintext password with the given salt.
 * @param {string} plain  - Plaintext password
 * @param {string} salt   - Hex-encoded per-user salt
 * @returns {string}      - Hex-encoded SHA-256 hash
 */
function hashPassword(plain, salt) {
  if (!plain || !salt) throw new Error("hashPassword: plain and salt are required");
  return crypto
    .createHash("sha256")
    .update(plain + salt)
    .digest("hex");
}

/**
 * Generate a random per-user salt.
 * @returns {string} - 16-byte random salt, hex-encoded (32 chars)
 */
function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Verify a plaintext password against a stored hash + salt.
 * @param {string} plain      - Plaintext password to verify
 * @param {string} salt       - Stored hex salt
 * @param {string} storedHash - Stored hex hash
 * @returns {boolean}
 */
function verifyPassword(plain, salt, storedHash) {
  const candidate = hashPassword(plain, salt);
  // Constant-time comparison to prevent timing attacks
  if (candidate.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(candidate, "hex"),
    Buffer.from(storedHash, "hex")
  );
}

// ============================================================
// SESSION TOKEN
// 32 bytes random = 64-char hex string.
// TTL enforced via Firestore token_expires_at field.
// ============================================================

/**
 * Generate a cryptographically secure session token.
 * @param {number} [bytes=32] - Number of random bytes (default 32 → 64-char hex)
 * @returns {string} - hex string
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Calculate token expiry timestamp.
 * @param {number} ttlDays - Token lifetime in days (default 30)
 * @returns {Date}
 */
function tokenExpiresAt(ttlDays = 30) {
  const d = new Date();
  d.setDate(d.getDate() + ttlDays);
  return d;
}

module.exports = {
  hashPassword,
  generateSalt,
  verifyPassword,
  generateToken,
  tokenExpiresAt,
  // Convenience: create new salt+hash pair for a plaintext password
  createPasswordHash: (plain) => {
    const salt = generateSalt();
    return { hash: hashPassword(plain, salt), salt };
  },
};
