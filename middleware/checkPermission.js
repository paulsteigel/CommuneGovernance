// middleware/checkPermission.js  —  Village Linker V6
// ============================================================
// V6 PERMISSION MODEL (replaces V5 flat-role check):
//
//   checkPermission(req, ACTIONS.X, scope)
//
//   Reads from req (set by validateToken):
//     req.user             — full user doc
//     req.active_placement — active Placement object or null
//
//   Decision tree:
//     1. SUPER_ADMIN → pass everything
//     2. Admin-allowed action + is_admin → pass
//     3. allTiers (any authenticated user) → run scopeCheck, pass
//     4. No active_placement → PERM_003 (unassigned account)
//     5. placement.cap_vi_tri not in allowedTiers → PERM_001
//     6. scopeCheck(user, placement, scope) → may throw PERM_002
//
// Admin actions (ADMIN_APPROVE_USER etc.) are NOT in PERMISSION_MATRIX.
// Use requireAdmin() / requireSuperAdmin() helpers in handlers directly.
// ============================================================
"use strict";

const { PERMISSION_MATRIX, ERROR_CODES } = require("../utils/constants");

/**
 * Check whether the authenticated user may perform `action` in the given `scope`.
 * Throws { code, message } immediately on any failure — never lets execution continue.
 *
 * MUST be called after validateToken() (relies on req.user + req.active_placement).
 *
 * @param {import('express').Request} req    — Express request (req.user + req.active_placement set)
 * @param {string}                   action — ACTIONS.* constant
 * @param {object}                   scope  — Action-specific context (nhanh, linh_vuc, is_escalated …)
 */
function checkPermission(req, action, scope = {}) {
  const user      = req.user;
  const placement = req.active_placement;  // may be null for admin/super_admin

  // ── 0. Unknown action (programmer error — catch in dev) ───
  const rule = PERMISSION_MATRIX[action];
  if (!rule) {
    throw {
      code:    ERROR_CODES.PERM_001,
      message: `Action không xác định trong PERMISSION_MATRIX: ${action}`,
    };
  }

  // ── 1. SUPER_ADMIN bypasses everything ────────────────────
  if (user.is_super_admin) return;

  // ── 2. Admin bypass (for adminAllowed actions) ────────────
  if (user.is_admin && rule.adminAllowed) return;

  // ── 3. allTiers — any authenticated user (no tier needed) ─
  if (rule.allTiers) {
    if (typeof rule.scopeCheck === "function") {
      rule.scopeCheck(user, placement, scope);
    }
    return;
  }

  // ── 4. Regular path: active placement required ────────────
  if (!placement) {
    throw {
      code:    ERROR_CODES.PERM_003,
      message: "Tài khoản chưa được gán vị trí tổ chức (placement). Vui lòng liên hệ Admin xã.",
    };
  }

  // ── 5. Tier check ─────────────────────────────────────────
  if (!Array.isArray(rule.allowedTiers) || !rule.allowedTiers.includes(placement.cap_vi_tri)) {
    throw {
      code:    ERROR_CODES.PERM_001,
      message: `Cấp "${placement.cap_vi_tri}" không được phép thực hiện thao tác này`,
    };
  }

  // ── 6. Scope check (nhanh / linh_vuc / thon / escalation) ─
  if (typeof rule.scopeCheck === "function") {
    rule.scopeCheck(user, placement, scope);
  }

  // Passed — execution continues in caller
}

// ============================================================
// ADMIN PLANE HELPERS
// Use these in admin / super-admin handlers instead of the matrix.
// ============================================================

/**
 * Assert that the authenticated user is an Admin (or Super-Admin).
 * Throws PERM_001 if not.
 * @param {object} user — req.user
 */
function requireAdmin(user) {
  if (!user.is_admin && !user.is_super_admin) {
    throw {
      code:    ERROR_CODES.PERM_001,
      message: "Thao tác này yêu cầu quyền Admin.",
    };
  }
}

/**
 * Assert that the authenticated user is a Super-Admin.
 * Throws PERM_001 if not.
 * @param {object} user — req.user
 */
function requireSuperAdmin(user) {
  if (!user.is_super_admin) {
    throw {
      code:    ERROR_CODES.PERM_001,
      message: "Thao tác này yêu cầu quyền Super-Admin (CARE).",
    };
  }
}

module.exports = { checkPermission, requireAdmin, requireSuperAdmin };  