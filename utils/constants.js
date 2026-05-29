//utils/constants.js
"use strict";

const ROLES = {
  ADMIN:          "ADMIN",
  LANH_DAO:       "LANH_DAO",
  CB_CHUYEN_MON:  "CB_CHUYEN_MON",
  CB_THON:        "CB_THON",
};

const NHANH = {
  UBND: "UBND",
  MTTQ: "MTTQ",
  DANG: "DANG",
};

const ACTIONS = {
  LOGIN:                  "login",
  LOGOUT:                 "logout",
  PULL_MANIFEST:          "pull_manifest",
  PUSH_DATA:              "push_data",
  CREATE_INDICATOR:       "create_indicator",
  SUBMIT_INDICATOR:       "submit_indicator",   // DRAFT → PENDING (CB_CM)
  APPROVE_INDICATOR:      "approve_indicator",  // PENDING → ACTIVE (LANH_DAO)
  REJECT_INDICATOR:       "reject_indicator",   // PENDING → REJECTED (LANH_DAO)
  CREATE_REQUEST:         "create_request",
  VERIFY_DATA:            "verify_data",
  VERIFY_DATA_RESUBMIT:   "verify_data_resubmit",
  GET_DASHBOARD:          "get_dashboard",
  GET_REPORT_DATA:        "get_report_data",
  SYNC_SHEETS:            "sync_sheets",
};

const SUBMISSION_STATUS = {
  PENDING_VERIFY: "PENDING_VERIFY",
  IN_REVIEW:      "IN_REVIEW",
  VERIFIED:       "VERIFIED",
  NEEDS_REVISION: "NEEDS_REVISION",
  REJECTED:       "REJECTED",
};

const ERROR_CODES = {
  AUTH_001: "AUTH_001",
  AUTH_002: "AUTH_002",
  PERM_001: "PERM_001",
  PERM_002: "PERM_002",
  DATA_001: "DATA_001",
  DATA_002: "DATA_002",
  DATA_003: "DATA_003",
  DATA_004: "DATA_004",
  DATA_005: "DATA_005",
  DATA_006: "DATA_006", // Duplicate indicator name+unit
  SYNC_001: "SYNC_001",
  SYS_001:  "SYS_001",
};

const INDICATOR_STATUS = {
  DRAFT:    "DRAFT",
  PENDING:  "PENDING",
  ACTIVE:   "ACTIVE",
  REJECTED: "REJECTED",  // ← NEW: LANH_DAO từ chối
  ARCHIVED: "ARCHIVED",
};

const REQUEST_STATUS = {
  OPEN:        "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED:   "COMPLETED",
  CANCELLED:   "CANCELLED",
};

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

  [ACTIONS.CREATE_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      const { linh_vuc } = scope;
      if (user.vai_tro === ROLES.ADMIN) return;
      if (user.vai_tro === ROLES.LANH_DAO) { _checkNhanh(user, scope); return; }
      if (!linh_vuc) throw { code: ERROR_CODES.DATA_001, message: "Thiếu linh_vuc" };
      if (!Array.isArray(user.linh_vuc_codes) || !user.linh_vuc_codes.includes(linh_vuc)) {
        throw { code: ERROR_CODES.PERM_002, message: `Lĩnh vực ${linh_vuc} không thuộc phạm vi của bạn` };
      }
      _checkNhanh(user, scope);
    },
  },

  // CB_CM gửi indicator của mình (DRAFT → PENDING)
  [ACTIONS.SUBMIT_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      const { created_by } = scope;
      if (created_by && created_by !== (user.user_id || user.id)) {
        throw { code: ERROR_CODES.PERM_002, message: "Bạn chỉ có thể gửi duyệt chỉ số do mình tạo" };
      }
    },
  },

  [ACTIONS.APPROVE_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
    },
  },

  [ACTIONS.REJECT_INDICATOR]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
    },
  },

  [ACTIONS.CREATE_REQUEST]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON],
    scopeCheck: (user, scope) => {
      if (user.vai_tro === ROLES.ADMIN) return;
      _checkNhanh(user, scope);
      if (user.vai_tro === ROLES.CB_CHUYEN_MON) {
        const { linh_vuc_list } = scope;
        if (Array.isArray(linh_vuc_list) && linh_vuc_list.length > 0) {
          const unauthorized = linh_vuc_list.filter(lv => !user.linh_vuc_codes.includes(lv));
          if (unauthorized.length > 0) {
            throw { code: ERROR_CODES.PERM_002, message: `Lĩnh vực [${unauthorized.join(", ")}] không thuộc phạm vi của bạn` };
          }
        }
      }
    },
  },

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
            throw { code: ERROR_CODES.PERM_002, message: `Lĩnh vực [${unauthorized.join(", ")}] không thuộc phạm vi của bạn` };
          }
        }
      }
    },
  },

  [ACTIONS.VERIFY_DATA_RESUBMIT]: {
    allowedRoles: [ROLES.CB_THON],
    scopeCheck: (user, scope) => {
      const { submitted_by } = scope;
      if (submitted_by && submitted_by !== (user.user_id || user.id)) {
        throw { code: ERROR_CODES.PERM_002, message: "Bạn không thể resubmit dữ liệu của người khác" };
      }
    },
  },

  [ACTIONS.GET_DASHBOARD]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO],
    scopeCheck: null,
  },

  [ACTIONS.GET_REPORT_DATA]: {
    allowedRoles: [ROLES.ADMIN, ROLES.LANH_DAO, ROLES.CB_CHUYEN_MON, ROLES.CB_THON],
    scopeCheck: null,
  },
};

function _checkNhanh(user, scope) {
  const { nhanh } = scope;
  if (!nhanh) return;
  if (user.nhanh !== nhanh) {
    throw { code: ERROR_CODES.PERM_002, message: `Bạn không có quyền thực hiện thao tác này cho nhánh ${nhanh}` };
  }
}

const QUOTA = {
  MANIFEST_CONDITIONAL_FETCH: true,
  MANIFEST_TTL_HOURS: 24,
  TOKEN_TTL_DAYS: 30,
};

module.exports = {
  ROLES, NHANH, ACTIONS, ERROR_CODES,
  INDICATOR_STATUS, REQUEST_STATUS, SUBMISSION_STATUS,
  PERMISSION_MATRIX, QUOTA,
};
