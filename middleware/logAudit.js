"use strict";

const { paths, serverTimestamp } = require("../utils/firestore");

// ============================================================
// AUDIT LOG MIDDLEWARE
// Every write operation must call logAudit() — no exceptions.
// Logged asynchronously (fire-and-forget acceptable for audit),
// but we still await to catch Firestore errors in staging.
// ============================================================

/**
 * Write an audit log entry to audit_logs collection.
 *
 * @param {object} user   - Authenticated user (req.user)
 * @param {string} action - Action performed (use ACTIONS constants)
 * @param {object} detail - Action-specific detail (req_id, submission_id, etc.)
 * @param {object} req    - Express request (for IP extraction)
 * @returns {Promise<void>}
 */
async function logAudit(user, action, detail = {}, req = null) {
  try {
    await paths.auditLogs().add({
      user_id:   user.user_id || user.id,
      xa_code:   user.xa_code,
      vai_tro:   user.vai_tro,
      action,
      timestamp: serverTimestamp(),
      detail,
      ip: req?.headers?.["x-forwarded-for"]
        || req?.headers?.["x-real-ip"]
        || req?.ip
        || null,
    });
  } catch (err) {
    // Log failure should not break the main flow —
    // but always surface the error in Cloud Functions logs.
    console.error("[logAudit] Failed to write audit log:", err);
  }
}

module.exports = { logAudit };
