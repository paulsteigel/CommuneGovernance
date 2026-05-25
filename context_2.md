# CommuneGovernance — CARE Vietnam
## Quick Status
- API: https://careapi-cx7avsd4pa-as.a.run.app
- Firebase: communegovernance (ngocdd@thiennhienviet.org.vn)
- Local: F:\Developers\CARE\CommuneGovernance\
- Node 24, Firebase Functions v2, Cloud Run asia-southeast1

## All Handlers — Status
| Handler | Functions | Tests |
|---|---|---|
| auth.js | login, logout, pullManifest | ✅ |
| data.js | pushData | ✅ 19/19 |
| indicators.js | createIndicator, approveIndicator | ✅ 23/23 |
| requests.js | createRequest | ✅ 25/25 |
| verify.js | verifyData, resubmitData | ✅ 34/34 |
| dashboard.js | getDashboard | ✅ test_dashboard.js passed |
| sync.js | syncToSheets | ⏳ 12/15 — deploy fix pending |

## sync.js — Pending Fix (deploy before testing tomorrow)
Two bugs fixed in latest sync.js output:
1. Compound query `.where("verified_at", ">", timestamp)` needed composite
   Firestore index → removed, now filters in memory instead
2. `new admin.firestore.Timestamp(0, 0)` unreliable in firebase-admin v12
   → replaced with plain `toMillis()` ms comparison

Deploy command:
  npx firebase-tools deploy --only functions

Test command:
  $env:INTERNAL_SECRET = "care-commune-sync-2025-secret-key-minimum32chars"
  node tests/test_sync.js

Expected: 15/15 after deploy

## Next Big Feature — Voice Transcription (Azure Speech)
Architecture decided: Token endpoint (NOT audio proxy)
- POST /speech_token → short-lived Azure auth token (10 min)
- Client uses Azure Speech SDK directly (mic → text on device)
- No audio through backend → low latency, privacy-friendly
- Azure region: southeastasia (Singapore)

Env vars needed:
  AZURE_SPEECH_KEY=...
  AZURE_SPEECH_REGION=southeastasia

New files to build:
  handlers/transcribe.js  — getSpeechToken(req, res)
  tests/test_transcribe.js

Client app: to be built together (stack TBD)

## Test Users (xa: XATEST, password: Test@1234)
| user_id | vai_tro | nhanh | linh_vuc_codes |
|---|---|---|---|
| USR_THON01 | CB_THON | UBND | null |
| USR_CBCM01 | CB_CHUYEN_MON | UBND | [NONG_NGHIEP, XA_HOI] |
| USR_LANHDAO | LANH_DAO | UBND | null |

INTERNAL_SECRET = "care-commune-sync-2025-secret-key-minimum32chars"

## Handler Pattern (always follow)
```js
async function myHandler(req, res) {
  const user = await validateToken(req);
  // validate → errorResponse(res, ERROR_CODES.DATA_001, "...")
  // fetch → paths.xxx(xa_code, id).get()
  checkPermission(user, ACTIONS.MY_ACTION, { nhanh, ... });
  await logAudit(user, ACTIONS.MY_ACTION, { ... }, req);
  return successResponse(res, { ... });
}
```

## Key Paths (firestore.js)
```
users/{userId}
communes/{xaCode}/indicators/{id}
communes/{xaCode}/requests/{id}
communes/{xaCode}/submissions/{id}
communes/{xaCode}/manifests/current
communes/{xaCode}/config/sync_state    ← NEW (sync checkpoint)
xa_registry/{xaCode}                   ← has sheets_id, status
audit_logs/{auto-id}
```

## Seeded Test Data (XATEST, year 2025)
- Indicators: CS001 (NONG_NGHIEP), CS002 (XA_HOI), CS003 (CO_SO_HA_TANG), CS_DRAFT01
- Requests: REQ001 (OPEN, THON01+THON02), REQ002 (COMPLETED), REQ003 (OPEN, THON02 only)