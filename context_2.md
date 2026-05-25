# CommuneGovernance — CARE Vietnam
## API & Infrastructure
- API: https://careapi-cx7avsd4pa-as.a.run.app
- Firebase project: communegovernance (ngocdd@thiennhienviet.org.vn)
- Cloud Run (asia-southeast1), Node.js 24, Firebase Functions v2
- Local: F:\Developers\CARE\CommuneGovernance\

## Project structure
```
index.js                    ← Express app, lazy-load handlers
handlers/
  auth.js                   ✅ login, logout, pullManifest
  data.js                   ✅ pushData
  indicators.js             ✅ createIndicator, approveIndicator
  requests.js               ✅ createRequest
  verify.js                 ✅ verifyData, resubmitData
  dashboard.js              ⏳ getDashboard
  sync.js                   ⏳ syncToSheets
middleware/
  validateToken.js          ← session token check, attaches req.user
  checkPermission.js        ← PERMISSION_MATRIX throw on fail
  logAudit.js               ← fire-and-forget audit log
utils/
  constants.js              ← ROLES, ACTIONS, ERROR_CODES, PERMISSION_MATRIX
  firestore.js              ← db singleton, paths{}, batchGet, batchWrite
  response.js               ← successResponse, errorResponse, asyncHandler
  crypto.js                 ← verifyPassword, generateToken
  manifest.js               ← buildManifest, rebuildManifest
tests/
  seed_test_data.js         ← run once to seed Firestore
  test_push_data.js         ✅ 19/19
  test_indicators.js        ✅ 23/23
  test_requests.js          ✅ 25/25
  test_verify.js            ✅ 34/34
```

## Handler pattern (MUST follow exactly)
```js
async function myHandler(req, res) {
  const user = await validateToken(req);          // 1 Firestore read
  // input validation → errorResponse(res, ERROR_CODES.DATA_001, "...")
  // fetch docs → paths.xxx(xa_code, id).get()
  // state check → errorResponse(res, ERROR_CODES.DATA_005, "...")
  checkPermission(user, ACTIONS.MY_ACTION, { nhanh, ... });
  // business logic
  await logAudit(user, ACTIONS.MY_ACTION, { ... }, req);
  return successResponse(res, { ... });
}
```

## Roles & test users (xa: XATEST)
| user_id       | vai_tro        | nhanh | don_vi            | linh_vuc_codes          | password   |
|---------------|----------------|-------|-------------------|-------------------------|------------|
| USR_THON01    | CB_THON        | UBND  | THON01            | null                     | Test@1234 |
| USR_CBCM01    | CB_CHUYEN_MON  | UBND  | PHONG_NONG_NGHIEP | [NONG_NGHIEP, XA_HOI]  | Test@1234 |
| USR_LANHDAO   | LANH_DAO       | UBND  | XA               | null                     | Test@1234 |

## Seeded test data (XATEST, year 2025)
- Indicators: CS001 (NONG_NGHIEP, ACTIVE), CS002 (XA_HOI, ACTIVE), CS003 (CO_SO_HA_TANG, ACTIVE), CS_DRAFT01 (DRAFT)
- Requests: REQ001 (OPEN, THON01+THON02), REQ002 (COMPLETED), REQ003 (OPEN, THON02 only)

## Firestore paths (from utils/firestore.js paths{})
```
users/{userId}
xa_registry/{xaCode}
communes/{xaCode}/manifests/current
communes/{xaCode}/indicators/{indicatorId}
communes/{xaCode}/requests/{reqId}
communes/{xaCode}/submissions/{submissionId}
audit_logs/  (auto-id)
```

## Submission document structure
```js
{
  submission_id, req_id, thon_code,
  submitted_by: user.id,        // = user.user_id
  submitted_at, device_collected_at,
  values: { [chi_so_id]: value },
  anh_urls: [],
  manifest_version_used,
  status: "PENDING_VERIFY" | "IN_REVIEW" | "VERIFIED" | "NEEDS_REVISION",
  indicator_reviews: {          // added by verifyData
    [chi_so_id]: { status: "pending"|"confirmed"|"needs_review"|"rejected", review_note? }
  },
  verify_mode: "batch" | "per_indicator",
  verified_by, verified_at,
  verify_comment,
  flagged: bool,
  rejection_reason: null,
  resubmitted_by, resubmitted_at,
  year
}
```

## constants.js — key values
```js
ROLES:      ADMIN, LANH_DAO, CB_CHUYEN_MON, CB_THON
NHANH:      UBND, MTTQ, DANG
ACTIONS:    login, logout, pull_manifest, push_data,
            create_indicator, approve_indicator, create_request,
            verify_data, verify_data_resubmit, get_dashboard
ERROR_CODES: AUTH_001/002, PERM_001/002, DATA_001–005, SYNC_001, SYS_001
INDICATOR_STATUS: DRAFT, PENDING, ACTIVE, ARCHIVED
REQUEST_STATUS:   OPEN, IN_PROGRESS, COMPLETED, CANCELLED
SUBMISSION_STATUS: PENDING_VERIFY, IN_REVIEW, VERIFIED, NEEDS_REVISION, REJECTED
```

## PERMISSION_MATRIX — key rules
- push_data:         CB_THON only; user.don_vi ∈ request.danh_sach_thon
- create_indicator:  ADMIN/LANH_DAO/CB_CHUYEN_MON; CB_CM: linh_vuc ∈ linh_vuc_codes
- approve_indicator: ADMIN/LANH_DAO; nhanh match
- create_request:    ADMIN/LANH_DAO/CB_CHUYEN_MON; CB_CM: all linh_vuc ∈ linh_vuc_codes
- verify_data:       ADMIN/LANH_DAO/CB_CHUYEN_MON; nhanh match
- verify_data_resubmit: CB_THON only; submitted_by must match user
- get_dashboard:     ADMIN/LANH_DAO only

## index.js endpoints
POST /login, /logout, /pull_manifest
POST /push_data
POST /create_indicator, /approve_indicator
POST /create_request
POST /verify_data, /resubmit_data
GET  /dashboard
POST /sync_to_sheets  (X-Internal-Secret header required)

## Test file pattern
```js
// plain Node.js https, no external deps
// async function runTests()
// check(label, condition, detail) helper
// SETUP: login → create fixtures → run tests
// node tests/test_xxx.js
```

## Remaining work
1. handlers/dashboard.js — getDashboard (GET /dashboard, LANH_DAO+ADMIN)
2. handlers/sync.js — syncToSheets (POST /sync_to_sheets, Cloud Scheduler)