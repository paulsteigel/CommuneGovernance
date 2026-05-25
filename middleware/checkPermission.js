"use strict";

const { PERMISSION_MATRIX, ERROR_CODES } = require("../utils/constants");

// ============================================================
// PERMISSION CHECK MIDDLEWARE
//
// MUST be called before any business logic in every handler.
// Throws immediately on failure — never lets execution continue.
//
// Usage:
//   checkPermission(req.user, ACTIONS.PUSH_DATA, { request });
//   checkPermission(req.user, ACTIONS.CREATE_INDICATOR, { linh_vuc, nhanh });
// ============================================================

/**
 * Check if the user is allowed to perform the given action in the given scope.
 * Throws a structured error ({ code, message }) immediately on failure.
 *
 * @param {object} user   - Authenticated user from req.user
 * @param {string} action - One of ACTIONS constants
 * @param {object} scope  - Action-specific scope data (see PERMISSION_MATRIX)
 */
function checkPermission(user, action, scope = {}) {
  const rule = PERMISSION_MATRIX[action];

  // Guard: unknown action (should never happen in production)
  if (!rule) {
    throw {
      code: ERROR_CODES.PERM_001,
      message: `Action không xác định: ${action}`,
    };
  }

  // Step 1: role check
  if (!rule.allowedRoles.includes(user.vai_tro)) {
    throw {
      code: ERROR_CODES.PERM_001,
      message: `Vai trò ${user.vai_tro} không được phép thực hiện thao tác này`,
    };
  }

  // Step 2: scope check (if defined for this action)
  if (typeof rule.scopeCheck === "function") {
    rule.scopeCheck(user, scope); // throws PERM_002 internally if failed
  }

  // Passed — execution continues in caller
}

module.exports = { checkPermission };
