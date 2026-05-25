//utils/constants.js
"use strict";

// ============================================================
// ROLES
// ============================================================
const ROLES = {
  ADMIN:          "ADMIN",
  LANH_DAO:       "LANH_DAO",
  CB_CHUYEN_MON:  "CB_CHUYEN_MON",
  CB_THON:        "CB_THON",
};

// ============================================================
// NHANH (organizational branch)
// Each user belongs to exactly one branch.
// DANG is the highest — can view cross-branch (future feature).
// LANH_DAO/CB_CM of one branch cannot create requests for another.
// ============================================================
const NHANH = {
  UBND:    "UBND",    // Government: departments, specialists, village heads
  MTTQ:    "MTTQ",   // Mass org: Women's Union, Youth Union, Veterans, etc.
  DANG:    "DANG",   // Party: Party committee, party cells
};

// ============================================================
// ACTIONS
// ============================================================
const ACTIONS = {
  LOGIN:              "login",
  LOGOUT:             "logout",
  PULL_MANIFEST:      "pull_manifest",
  PUSH_DATA:          "push_data",
  CREATE_INDICATOR:   "create_indicator",
  APPROVE_INDICATOR:  "approve_indicator",
  CREATE_REQUEST:     "create_request",
  VERIFY_DATA:        "verify_data",
  GET_DASHBOARD:      "get_dashboard",
  SYNC_SHEETS:        "sync_sheets",
  VERIFY_DATA_RESUBMIT: "verify_data_resubmit",
};

const SUBMISSION_STATUS = {
  PENDING_VERIFY: "PENDING_VERIFY",
  IN_REVIEW:      "IN_REVIEW",       // ← NEW
  VERIFIED:       "VERIFIED",
  NEEDS_REVISION: "NEEDS_REVISION",  // ← NEW
  REJECTED:       "REJECTED",        // kept for compat
};

// ============================================================
// ERROR CODES
// ============================================================
const ERROR_CODES = {
  // Auth
  AUTH_001: "AUTH_001", // Invalid or expired token
  AUTH_002: "AUTH_002", // Wrong user_id or password

  // Permission
  PERM_001: "PERM_001", // Role not allowed for this action
  PERM_002: "PERM_002", // User not allowed on this scope (wrong thon/linh_vuc/nhanh)

  // Data
  DATA_001: "DATA_001", // Missing required field
  DATA_002: "DATA_002", // Request not found or closed
  DATA_003: "DATA_003", // Indicator's linh_vuc not in user's linh_vuc_codes
  DATA_004: "DATA_004", // Duplicate submission (req_id + thon_code already exists)
  DATA_005: "DATA_005", // Indicator not in valid status for this action

  // Sync
  SYNC_001: "SYNC_001", // Manifest version mismatch (warning only, does not block)

  // System
  SYS_001:  "SYS_001",  // Internal system error
};

// ============================================================
// INDICATOR STATUS TRANSITIONS
// ============================================================
const INDICATOR_STATUS = {
  DRAFT:    "DRAFT",
  PENDING:  "PENDING",
  ACTIVE:   "ACTIVE",
  ARCHIVED: "ARCHIVED",
};

// ============================================================
// REQUEST STATUS
// ============================================================
const REQUEST_STATUS = {
  OPEN:        "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED:   "COMPLETED",
  CANCELLED:   "CANCELLED",
};

// ============================================================
// SUBMISSION STATUS
// ============================================================
/*
*/
// ============================================================
// PERMISSION MATRIX
//
// Structure per action:
//   allowedRoles  — which roles may perform this action at all
//   scopeCheck    — function(user, scope) that throws PERM_002
//                   if the user's scope does not match.
//                   scope fields are action-dependent (see below).
//                   scopeCheck is null when no scope restriction applies.
//
// Scope fields used per action:
//   push_data          → { request }   request.danh_sach_thon must include user.don_vi
//   create_indicator   → { linh_vuc }  CB_CM: must be in user.linh_vuc_codes
//                                      LANH_DAO: nhanh must match
//   approve_indicator  → { nhanh }     LANH_DAO: nhanh must match indicator's creator nhanh
//   create_request     → { nhanh }     CB_CM/LANH_DAO: nhanh must match
//   verify_data        → { linh_vuc, nhanh }
//   get_dashboard      → no scope restriction beyond role
// ============================================================

const PERMISSION_MATRIX = {

  [ACTIONS.LOGIN]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON, ROLES.CB_THON],
    scopeCheck: null,
  },

  [ACTIONS.LOGOUT]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON, ROLES.CB_THON],
    scopeCheck: null,
  },

  [ACTIONS.PULL_MANIFEST]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON, ROLES.CB_THON],
    scopeCheck: null,
  },

  // R2: Only CB_THON can push data
  // R5: user.don_vi must be in request.danh_sach_thon (anti-forge)
  [ACTIONS.PUSH_DATA]: {
    allowedRoles: [ROLES.CB_THON],
    scopeCheck: (user, scope) => {
      const { request } = scope;
      if (!request || !Array.isArray(request.danh_sach_thon)) {
        throw { code: ERROR_CODES.PERM_002, message: "Request data missing for scope check" };
      }
      if (!request.danh_sach_thon.includes(user.don_vi)) {
        throw {
          code: ERROR_CODES.PERM_002,
          message: `Thôn ${user.don_vi} không nằm trong danh sách thôn của request này`,
        };
      }
    },
  },

  // R3: CB_CM can only create indicators in their own linh_vuc_codes
  // LANH_DAO: must match nhanh (cannot create for another branch)
  // ADMIN: no scope restriction
  [ACTIONS.CREATE_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      const { linh_vuc } = scope;

      if (user.vai_tro === ROLES.ADMIN) return; // no restriction

      if (user.vai_tro === ROLES.LANH_DAO) {
        _checkNhanh(user, scope);
        return;
      }

      // CB_CHUYEN_MON
      if (!linh_vuc) {
        throw { code: ERROR_CODES.DATA_001, message: "Thiếu linh_vuc" };
      }
      if (!Array.isArray(user.linh_vuc_codes) || !user.linh_vuc_codes.includes(linh_vuc)) {
        throw {
          code: ERROR_CODES.PERM_002,
          message: `Lĩnh vực ${linh_vuc} không thuộc phạm vi của bạn`,
        };
      }
      _checkNhanh(user, scope);
    },
  },

  // R1: Only LANH_DAO (or ADMIN) can approve indicators
  [ACTIONS.APPROVE_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
    },
  },

  // CB_CM: nhanh match + linh_vuc in linh_vuc_codes
  // LANH_DAO: nhanh match, can span all linh_vuc within their nhanh
  // ADMIN: no restriction
  [ACTIONS.CREATE_REQUEST]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
      // CB_CM: further restrict to their linh_vuc_codes
      if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
        const { linh_vuc_list } = scope; // array of linh_vuc in the request's chi_so list
        if (Array.isArray(linh_vuc_list) && linh_vuc_list.length > 0) {
          const unauthorized = linh_vuc_list.filter(
            lv => !user.linh_vuc_codes.includes(lv)
          );
          if (unauthorized.length > 0) {
            throw {
              code: ERROR_CODES.PERM_002,
              message: `Lĩnh vực [${unauthorized.join(", ")}] không thuộc phạm vi của bạn`,
            };
          }
        }
      }
    },
  },

  // CB_CM: can verify submissions where ALL linh_vuc in the request are
  //        covered by their linh_vuc_codes, AND nhanh matches.
  // LANH_DAO: nhanh match only (can span all linh_vuc within their nhanh)
  // ADMIN: no restriction
  [ACTIONS.VERIFY_DATA]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
      if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
        const { linh_vuc_list } = scope;
        if (Array.isArray(linh_vuc_list) && linh_vuc_list.length > 0) {
          const unauthorized = linh_vuc_list.filter(
            lv => !Array.isArray(user.linh_vuc_codes) || !user.linh_vuc_codes.includes(lv)
          );
          if (unauthorized.length > 0) {
            throw {
              code: ERROR_CODES.PERM_002,
              message: `Lĩnh vực [${unauthorized.join(", ")}] không thuộc phạm vi của bạn`,
            };
          }
        }
      }
    },
  },

  [ACTIONS.VERIFY_DATA_RESUBMIT]: {  // ← NEW entry
    allowedRoles: [ROLES.CB_THON],
    scopeCheck: (user, scope) => {
      const { submitted_by } = scope;
      if (submitted_by && submitted_by !== user.user_id) {
        throw { code: ERROR_CODES.PERM_002, message: "Bạn không thể resubmit dữ liệu của người khác" };
      }
    },
  },

  // Dashboard: LANH_DAO and ADMIN only
  [ACTIONS.GET_DASHBOARD]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO],
    scopeCheck: null,
  },
};

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Throws PERM_002 if user.nhanh does not match scope.nhanh.
 * Called internally by multiple scopeCheck functions.
 */
function _checkNhanh(user, scope) {
  const { nhanh } = scope;
  if (!nhanh) return; // no nhanh constraint in this scope
  if (user.nhanh !== nhanh) {
    throw {
      code: ERROR_CODES.PERM_002,
      message: `Bạn không có quyền thực hiện thao tác này cho nhánh ${nhanh}`,
    };
  }
}

// ============================================================
// QUOTA OPTIMIZATION CONSTANTS
// ============================================================
const QUOTA = {
  // Client sends current manifest version; server skips full read if unchanged.
  MANIFEST_CONDITIONAL_FETCH: true,

  // TTL for manifest validity (hours). After this, client should pull_manifest.
  MANIFEST_TTL_HOURS: 24,

  // Session token TTL (days)
  TOKEN_TTL_DAYS: 30,
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  ROLES,
  NHANH,
  ACTIONS,
  ERROR_CODES,
  INDICATOR_STATUS,
  REQUEST_STATUS,
  SUBMISSION_STATUS,
  PERMISSION_MATRIX,
  QUOTA,
};