// utils/constants.js  —  Village Linker V6
// ============================================================
// V6 DESIGN CHANGE SUMMARY (vs V5):
//
//   V5: flat vai_tro (LANH_DAO / CB_CHUYEN_MON / CB_THON / ADMIN…)
//   V6: two orthogonal axes
//       - placement  : WHERE the user sits (nhanh + don_vi/thon + linh_vuc_codes)
//       - tier (cap_vi_tri): WHAT they can do (CB_THON / CHUYEN_VIEN / LD_DON_VI / LD_NHANH)
//
//   Permission = tier_allowed(tier, action)  AND  in_scope(active_placement, data)
//
//   Admin / SUPER_ADMIN: orthogonal management plane, not a tier.
// ============================================================
"use strict";

// ============================================================
// TIERS — operational capability level (replaces flat ROLES)
// Four tiers in the governance chain. LD_DON_VI is optional:
// small communes without department heads skip this tier and
// escalation goes directly to LD_NHANH.
// ============================================================
const TIERS = {
  CB_THON:     "CB_THON",      // Village rep — submits data/reports
  CHUYEN_VIEN: "CHUYEN_VIEN",  // Staff — creates indicators, tasks, verifies (front-line)
  LD_DON_VI:   "LD_DON_VI",    // Department head — approves indicators, escalation verify (optional)
  LD_NHANH:    "LD_NHANH",     // Branch head — publish, complete, escalation verify
};

// Management plane — orthogonal to operational tiers.
// A user can be ADMIN and also hold a placement+tier.
const ADMIN_ROLES = {
  ADMIN:       "ADMIN",        // Commune admin: approve users, manage placements
  SUPER_ADMIN: "SUPER_ADMIN",  // CARE cross-commune: bootstrap, create communes
};

// ============================================================
// NHANH — organisational branches (V6 adds HDND vs V5)
// Per NĐ 150/2025 + NĐ 370/2025
// ============================================================
const NHANH = {
  UBND: "UBND",  // Uỷ ban Nhân dân (3 phòng + TT HCC)
  HDND: "HDND",  // Hội đồng Nhân dân (V6 NEW — was missing in V5)
  MTTQ: "MTTQ",  // Mặt trận Tổ quốc & Đoàn thể
  DANG: "DANG",  // Đảng uỷ xã
};

// ============================================================
// TASK TYPES — finite, fixed set. Pha 1 ships DATA_COLLECTION only.
// Never build a free-form builder; each type has a known schema.
// ============================================================
const TASK_TYPES = {
  DATA_COLLECTION: "DATA_COLLECTION",  // Pha 1: fill indicators + photos
  EVENT_REPORT:    "EVENT_REPORT",     // Pha 2: describe event + photos + location
  ACKNOWLEDGE:     "ACKNOWLEDGE",      // Pha 2: confirm receipt of directive
};

// ============================================================
// ACTIONS — catalog of every operation the system can perform.
// Used as keys in PERMISSION_MATRIX and audit logs.
// ============================================================
const ACTIONS = {
  // Session
  LOGIN:                      "login",
  LOGOUT:                     "logout",
  SWITCH_PLACEMENT:           "switch_placement",  // V6 NEW: context switch for multi-role users
  PULL_MANIFEST:              "pull_manifest",

  // Indicator lifecycle (§5.3)
  CREATE_INDICATOR:           "create_indicator",
  SUBMIT_INDICATOR:           "submit_indicator",    // DRAFT|REJECTED → PENDING
  APPROVE_INDICATOR:          "approve_indicator",   // PENDING → ACTIVE
  REJECT_INDICATOR:           "reject_indicator",    // PENDING → REJECTED

  // Task lifecycle (§5.2) — replaces V5 request lifecycle
  CREATE_TASK:                "create_task",
  UPDATE_TASK_STATUS:         "update_task_status",  // cancel | complete | exclude_thon | publish

  // Task response lifecycle — replaces V5 push_data / verify_data
  SUBMIT_TASK_RESPONSE:       "submit_task_response",
  RESUBMIT_TASK_RESPONSE:     "resubmit_task_response",  // after REJECTED
  VERIFY_TASK_RESPONSE:       "verify_task_response",    // CHUYEN_VIEN front-line OR LD on ESCALATED

  // Reports
  VIEW_REPORT:                "view_report",
  VIEW_DASHBOARD:             "view_dashboard",

  // Device / file
  REGISTER_DEVICE_TOKEN:      "register_device_token",
  UPLOAD_FILE:                "upload_file",

  // Admin plane (checked via is_admin flag, not tier)
  ADMIN_CREATE_INVITE:        "admin_create_invite_link",
  ADMIN_APPROVE_USER:         "admin_approve_user",
  ADMIN_LIST_PENDING:         "admin_list_pending_users",
  ADMIN_RESET_PASSWORD:       "admin_reset_password",
  ADMIN_SETUP_COMMUNE:        "admin_setup_commune",
  ADMIN_GET_COMMUNE:          "admin_get_commune_config",

  // Super-Admin plane (checked via is_super_admin flag)
  SUPER_ADMIN_CREATE_COMMUNE: "super_admin_create_commune",
  SUPER_ADMIN_BOOTSTRAP_LINK: "super_admin_bootstrap_link",
  SUPER_ADMIN_LIST_COMMUNES:  "super_admin_list_communes",
};

// ============================================================
// STATUS ENUMS
// ============================================================

const USER_STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE:           "ACTIVE",
  INACTIVE:         "INACTIVE",
};

const INDICATOR_STATUS = {
  DRAFT:    "DRAFT",
  PENDING:  "PENDING",
  ACTIVE:   "ACTIVE",
  REJECTED: "REJECTED",
  ARCHIVED: "ARCHIVED",
};

const TASK_STATUS = {
  OPEN:      "OPEN",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  // Note: no IN_PROGRESS at task level — track by task_response aggregation
};

// V6 review_status — replaces V5 SUBMISSION_STATUS.
// ESCALATED is the new state that gates LD verify access.
const REVIEW_STATUS = {
  PENDING_REVIEW: "PENDING_REVIEW",  // CB_THON submitted, waiting for CHUYEN_VIEN
  IN_REVIEW:      "IN_REVIEW",       // CHUYEN_VIEN opened (optional intermediate)
  ESCALATED:      "ESCALATED",       // Timeout / manual escalation → LD takes over
  VERIFIED:       "VERIFIED",        // Accepted
  REJECTED:       "REJECTED",        // Rejected — CB_THON must resubmit
};

// ============================================================
// ERROR CODES
// ============================================================
const ERROR_CODES = {
  // Auth
  AUTH_001: "AUTH_001",   // Token invalid / expired / missing
  AUTH_002: "AUTH_002",   // Wrong credentials / account not active

  // Permission
  PERM_001: "PERM_001",   // Tier not allowed for this action
  PERM_002: "PERM_002",   // Scope mismatch: nhanh / don_vi / thon / linh_vuc
  PERM_003: "PERM_003",   // No active placement (user has no placements assigned)

  // Data validation
  DATA_001: "DATA_001",   // Missing or invalid input field
  DATA_002: "DATA_002",   // Referenced entity not found or wrong status
  DATA_003: "DATA_003",   // (reserved)
  DATA_004: "DATA_004",   // Duplicate task_response (same thon + task)
  DATA_005: "DATA_005",   // State transition not allowed (wrong current status)
  DATA_006: "DATA_006",   // Duplicate indicator (same name+unit in same nhanh+year)

  // Task errors
  TASK_001: "TASK_001",   // Task not found
  TASK_002: "TASK_002",   // Task already in terminal state (COMPLETED|CANCELLED)
  TASK_003: "TASK_003",   // Cannot complete: not all thons VERIFIED

  // Invite / bootstrap
  INV_001:  "INV_001",    // Invite link expired or inactive
  INV_002:  "INV_002",    // User already exists (phone or CCCD conflict)
  BOOTSTRAP_INVALID: "BOOTSTRAP_INVALID",
  BOOTSTRAP_EXPIRED: "BOOTSTRAP_EXPIRED",
  BOOTSTRAP_USED:    "BOOTSTRAP_USED",
  COMMUNE_EXISTS:    "COMMUNE_EXISTS",

  NOT_FOUND: "NOT_FOUND",
  SYS_001:   "SYS_001",  // Generic server error
};

// ============================================================
// PERMISSION MATRIX (Tier × Action)
//
// Each entry:
//   allowedTiers    string[]   — which cap_vi_tri values may perform this action
//   allTiers        bool       — any authenticated user (any tier, incl. no placement)
//   adminAllowed    bool       — is_admin bypasses tier check for this action
//   superAdminOnly  bool       — only SUPER_ADMIN (checked separately in handler)
//   scopeCheck      fn(user, placement, scope) → throws { code, message } on violation
//
// Admin / SuperAdmin actions are NOT in this matrix — they are
// checked directly in their handlers using requireAdmin() / requireSuperAdmin().
//
// Scope check receives:
//   user        — full user doc from Firestore
//   placement   — active placement object (placements[active_placement_index])
//   scope       — action-specific context provided by the handler
// ============================================================

const PERMISSION_MATRIX = {

  // ── Session ───────────────────────────────────────────────

  [ACTIONS.LOGIN]: {
    allTiers: true,
    scopeCheck: null,
  },

  [ACTIONS.LOGOUT]: {
    allTiers: true,
    scopeCheck: null,
  },

  [ACTIONS.SWITCH_PLACEMENT]: {
    allTiers: true,
    scopeCheck: null,
  },

  [ACTIONS.PULL_MANIFEST]: {
    allTiers: true,
    adminAllowed: true,
    scopeCheck: null,
  },

  // ── Indicator lifecycle ───────────────────────────────────
  // Uniqueness: normalized(ten_chi_so) + "│" + normalized(don_vi_do)
  //             must be unique per (xa_code, nhanh, year)
  //             — cross-nhánh sharing is intentional (see Q3 decision)

  [ACTIONS.CREATE_INDICATOR]: {
    allowedTiers: [TIERS.CHUYEN_VIEN, TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
      if (placement.cap_vi_tri === TIERS.CHUYEN_VIEN) {
        // CHUYEN_VIEN must be responsible for this linh_vuc
        _assertLinhVuc(placement, scope);
      }
    },
  },

  // CHUYEN_VIEN submits own indicators; LD_DON_VI can submit any in their nhanh
  [ACTIONS.SUBMIT_INDICATOR]: {
    allowedTiers: [TIERS.CHUYEN_VIEN, TIERS.LD_DON_VI],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      if (placement.cap_vi_tri === TIERS.CHUYEN_VIEN) {
        const userId = user.user_id || user.id;
        if (scope.created_by && scope.created_by !== userId) {
          throw {
            code: ERROR_CODES.PERM_002,
            message: "Bạn chỉ có thể gửi duyệt chỉ số do chính mình tạo",
          };
        }
      }
    },
  },

  [ACTIONS.APPROVE_INDICATOR]: {
    allowedTiers: [TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
    },
  },

  [ACTIONS.REJECT_INDICATOR]: {
    allowedTiers: [TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
    },
  },

  // ── Task lifecycle ────────────────────────────────────────
  // Pha 1: only DATA_COLLECTION; pipeline is type-agnostic

  [ACTIONS.CREATE_TASK]: {
    allowedTiers: [TIERS.CHUYEN_VIEN, TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
      if (placement.cap_vi_tri === TIERS.CHUYEN_VIEN) {
        // CHUYEN_VIEN can only create tasks within their linh_vuc scope
        _assertLinhVucList(placement, scope);
      }
    },
  },

  // Only LD_NHANH can change task terminal status (complete / cancel / publish)
  [ACTIONS.UPDATE_TASK_STATUS]: {
    allowedTiers: [TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
    },
  },

  // ── Task response lifecycle ───────────────────────────────

  [ACTIONS.SUBMIT_TASK_RESPONSE]: {
    allowedTiers: [TIERS.CB_THON],
    adminAllowed: false,  // Admin cannot submit on behalf of village
    scopeCheck: (user, placement, scope) => {
      const thon = placement.thon;
      if (!thon) {
        throw { code: ERROR_CODES.PERM_002, message: "Tài khoản của bạn chưa được gán thôn" };
      }
      if (!Array.isArray(scope.danh_sach_thon) || !scope.danh_sach_thon.includes(thon)) {
        throw {
          code: ERROR_CODES.PERM_002,
          message: `Thôn ${thon} không nằm trong danh sách thôn của nhiệm vụ này`,
        };
      }
    },
  },

  [ACTIONS.RESUBMIT_TASK_RESPONSE]: {
    allowedTiers: [TIERS.CB_THON],
    adminAllowed: false,
    scopeCheck: (user, placement, scope) => {
      const userId = user.user_id || user.id;
      if (scope.submitted_by && scope.submitted_by !== userId) {
        throw { code: ERROR_CODES.PERM_002, message: "Bạn không thể nộp lại phản hồi của người khác" };
      }
    },
  },

  // VERIFY has a dual-path gated by escalation state:
  //   review_status != ESCALATED → only CHUYEN_VIEN (front-line verify)
  //   review_status == ESCALATED → only LD_DON_VI | LD_NHANH
  //
  // scope must include:
  //   nhanh          — the task's nhanh (for scope check)
  //   linh_vuc_list  — indicator linh_vuc list (for CHUYEN_VIEN scope)
  //   is_escalated   — bool from response.review_status === 'ESCALATED'
  [ACTIONS.VERIFY_TASK_RESPONSE]: {
    allowedTiers: [TIERS.CHUYEN_VIEN, TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: (user, placement, scope) => {
      _assertNhanh(placement, scope);
      const tier         = placement.cap_vi_tri;
      const isEscalated  = scope.is_escalated === true;

      if (!isEscalated) {
        // Normal path: CHUYEN_VIEN only
        if (tier !== TIERS.CHUYEN_VIEN) {
          throw {
            code: ERROR_CODES.PERM_002,
            message: "Xác thực tuyến đầu chỉ dành cho Chuyên viên. Lãnh đạo xác thực sau khi nhiệm vụ được leo thang.",
          };
        }
        _assertLinhVucList(placement, scope);
      } else {
        // Escalated path: LD only
        if (tier === TIERS.CHUYEN_VIEN) {
          throw {
            code: ERROR_CODES.PERM_002,
            message: "Nhiệm vụ đã được leo thang — xác thực do Lãnh đạo thực hiện.",
          };
        }
      }
    },
  },

  // ── Reporting ─────────────────────────────────────────────

  [ACTIONS.VIEW_REPORT]: {
    allTiers: true,
    adminAllowed: true,
    scopeCheck: null,  // Scope filtering happens inside the report handler
  },

  [ACTIONS.VIEW_DASHBOARD]: {
    allowedTiers: [TIERS.LD_DON_VI, TIERS.LD_NHANH],
    adminAllowed: true,
    scopeCheck: null,
  },

  // ── Device / file ─────────────────────────────────────────

  [ACTIONS.REGISTER_DEVICE_TOKEN]: {
    allTiers: true,
    adminAllowed: true,
    scopeCheck: null,
  },

  [ACTIONS.UPLOAD_FILE]: {
    allTiers: true,
    adminAllowed: true,
    scopeCheck: null,
  },
};

// ============================================================
// INTERNAL SCOPE HELPERS
// Used by scopeCheck functions above. Throw PERM_002 on violation.
// ============================================================

/**
 * Assert that the active placement's nhanh matches the required nhanh from scope.
 * No-op if scope.nhanh is absent (some actions don't have a nhanh constraint).
 */
function _assertNhanh(placement, scope) {
  if (!scope.nhanh) return;
  if (!placement || placement.nhanh !== scope.nhanh) {
    throw {
      code: ERROR_CODES.PERM_002,
      message: `Bạn không có quyền thực hiện thao tác này cho nhánh ${scope.nhanh}`,
    };
  }
}

/**
 * Assert that the active placement covers the given linh_vuc (single field).
 * Used for CREATE_INDICATOR by CHUYEN_VIEN.
 */
function _assertLinhVuc(placement, scope) {
  if (!scope.linh_vuc) return;
  const allowed = new Set(placement.linh_vuc_codes || []);
  if (!allowed.has(scope.linh_vuc)) {
    throw {
      code: ERROR_CODES.PERM_002,
      message: `Lĩnh vực "${scope.linh_vuc}" không thuộc phạm vi phụ trách của bạn`,
    };
  }
}

/**
 * Assert that ALL linh_vuc in scope.linh_vuc_list are within the placement's scope.
 * Used for CREATE_TASK and VERIFY_TASK_RESPONSE (front-line) by CHUYEN_VIEN.
 */
function _assertLinhVucList(placement, scope) {
  const list = scope.linh_vuc_list || [];
  if (list.length === 0) return;
  const allowed      = new Set(placement.linh_vuc_codes || []);
  const unauthorized = list.filter(lv => !allowed.has(lv));
  if (unauthorized.length > 0) {
    throw {
      code: ERROR_CODES.PERM_002,
      message: `Lĩnh vực [${unauthorized.join(", ")}] không thuộc phạm vi phụ trách của bạn`,
    };
  }
}

// ============================================================
// QUOTA & OPERATIONAL CONFIG
// ============================================================
const QUOTA = {
  MANIFEST_CONDITIONAL_FETCH:   true,
  MANIFEST_TTL_HOURS:           24,

  // Lazy-sliding token: 1-year lifetime, but only extended
  // when < TOKEN_EXTEND_THRESHOLD_DAYS remain — avoids a
  // Firestore write on every request (free tier protection).
  TOKEN_TTL_DAYS:               365,
  TOKEN_EXTEND_THRESHOLD_DAYS:  30,
};

// ============================================================
// FCM NOTIFICATION TYPES
// Used server-side to build FCM data payload and client-side
// for deep-link routing (§10).
// ============================================================
const FCM_NOTIFICATION_TYPES = {
  NEW_TASK:               "NEW_TASK",
  TASK_RESPONSE_RECEIVED: "TASK_RESPONSE_RECEIVED",
  RESPONSE_VERIFIED:      "RESPONSE_VERIFIED",
  RESPONSE_REJECTED:      "RESPONSE_REJECTED",
  BYPASS_ESCALATED:       "BYPASS_ESCALATED",   // Cloud Scheduler → LD
  TASK_CANCELLED:         "TASK_CANCELLED",
  TASK_COMPLETED:         "TASK_COMPLETED",
  INDICATOR_PENDING:      "INDICATOR_PENDING",   // New indicator awaiting LD approval
  NEW_USER_PENDING:       "NEW_USER_PENDING",    // Admin: new registration to approve
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Core model
  TIERS,
  ADMIN_ROLES,
  NHANH,
  TASK_TYPES,

  // Status enums
  USER_STATUS,
  INDICATOR_STATUS,
  TASK_STATUS,
  REVIEW_STATUS,

  // Behavior
  ACTIONS,
  ERROR_CODES,
  PERMISSION_MATRIX,
  QUOTA,
  FCM_NOTIFICATION_TYPES,

  // Exported for tests / seeding
  _assertNhanh,
  _assertLinhVuc,
  _assertLinhVucList,
};