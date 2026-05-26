# CommuneGovernance — CARE Vietnam
## Quick Status
- API: https://careapi-cx7avsd4pa-as.a.run.app
- Firebase: communegovernance (ngocdd@thiennhienviet.org.vn)
- Local: F:\Developers\CARE\CommuneGovernance\
- Node 24, Firebase Functions v2, Cloud Run asia-southeast1
- Expo App: F:\Developers\CARE\CommuneGovernance\app\ (SDK 56, EAS Build)
- EAS Project: @paulsteigel/commune-governance

## All Handlers — Status
| Handler | Functions | Tests |
|---|---|---|
| auth.js | login, logout, pullManifest | ✅ |
| data.js | pushData | ✅ 19/19 |
| indicators.js | createIndicator, approveIndicator | ✅ 23/23 |
| requests.js | createRequest | ✅ 25/25 |
| verify.js | verifyData, resubmitData | ✅ 34/34 |
| dashboard.js | getDashboard | ✅ |
| sync.js | syncToSheets | ✅ 15/15 |

## App — Status
- Stack: React Native + Expo SDK 56, Expo Router, Zustand, React Native Paper
- Build: EAS Build (cloud) → APK preview
- Screens hoàn thiện:
  - (auth)/login.jsx ✅
  - (cb-thon)/index.jsx ✅
  - (cb-thon)/submit/[reqId].jsx ✅
  - (cb-cm)/index.jsx ✅ (UI xong, data chờ backend fix)
  - (cb-cm)/verify/[subId].jsx ✅
  - (lanh-dao)/index.jsx ✅

## Bugs Cần Fix — Backend

### BUG-B1: manifest CB_CM trả về string thay vì array
Manifest của CB_CHUYEN_MON trả về:
  "chi_so_ids": "CS001 CS002"      ❌ phải là ["CS001", "CS002"]
  "danh_sach_thon": "THON01 THON02" ❌ phải là ["THON01", "THON02"]
File cần fix: utils/manifest.js
Ảnh hưởng: CB_CM không filter được requests, submit/verify sai

### BUG-B2: manifest CB_CM thiếu pending_verifications
CB_CHUYEN_MON cần thấy submissions đang chờ duyệt của mình.
Cần thêm vào manifest CB_CM:
  "pending_verifications": [
    {
      submission_id, req_id, thon_code, status,
      submitted_by, submitted_at, values,
      tieu_de (từ request)
    }
  ]
File cần fix: utils/manifest.js

### BUG-B3: Thiếu field dinh_ky trong request
Request cần có field định kỳ: THANG | QUY | ADHOC
Cần thêm vào:
  - createRequest: validate + save dinh_ky
  - manifest: trả về dinh_ky trong requests
  - Quy tắc: không tạo request định kỳ cho năm quá khứ

## Bugs Cần Fix — App

### BUG-A1: Login form thừa xa_code và year
Hiện tại: form có 4 fields (user_id, password, xa_code, year)
Đúng: chỉ cần user_id + password
Fix: sau login lấy xa_code từ manifest.user.xa_code
     lấy year từ manifest.config.current_year
File: app/app/(auth)/login.jsx

### BUG-A2: Tên hiển thị dùng user_id thay vì ho_ten
Hiện tại: header hiện "USR_THON01", "USR_LANHDAO"
Đúng: hiện "Nguyễn Văn Test", "Lê Thị Chuyên Môn"
Lý do: file login.jsx cũ chưa được copy đúng vào app/(auth)/
Fix: copy login.jsx đã fix vào đúng đường dẫn
Files: tất cả screens dùng user?.ho_ten thay vì user?.ten

### BUG-A3: Chọn năm báo cáo nên ở trong app, không phải login
Đúng: mặc định năm hiện tại từ manifest.config.current_year
      user có thể đổi năm trong Settings (không cho chọn tương lai)
      định kỳ thì không cho chọn quá khứ

## Features Cần Build

### FEAT-1: CB_CM tạo yêu cầu số liệu
Flow:
  CB_CM chọn bộ chỉ tiêu → chọn định kỳ (THANG/QUY/ADHOC)
  → tự động gửi đến đúng CB_THON theo nhanh:
    nhanh=UBND  → CB_THON thuộc UBND (trưởng thôn)
    nhanh=DANG  → CB_THON thuộc DANG
    nhanh=MTTQ  → CB_THON thuộc MTTQ (Mặt trận, Phụ nữ, Thanh niên...)
Backend: createRequest đã có, cần app UI

### FEAT-2: LANH_DAO verify trực tiếp (bypass CB_CM)
LANH_DAO có thể verify bất kỳ submission nào (không cần qua CB_CM)
Backend: đã hỗ trợ (PERMISSION_MATRIX cho phép LANH_DAO verify)
App: cần thêm màn verify cho LANH_DAO (hiện chỉ có dashboard)

### FEAT-3: Settings / chọn năm báo cáo
- Hiện năm hiện tại mặc định
- Cho phép xem lại năm cũ (read-only, không tạo request mới)
- LANH_DAO/ADMIN có thể config định kỳ mặc định cho xã

### FEAT-4: Admin tạo user (chưa có backend)
Cần endpoint mới: POST /create_user
  - ADMIN tạo tài khoản cho CB_THON, CB_CM, LANH_DAO
  - Set vai_tro, nhanh, don_vi, linh_vuc_codes
  - Generate password tạm, user đổi lần đầu login
Chưa build backend lẫn app

### FEAT-5: Voice transcription (Azure Speech) — để sau
Architecture: Token endpoint
  POST /speech_token → Azure auth token (10 min)
  Client dùng Azure SDK trực tiếp (mic → text on device)
Env vars: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION=southeastasia
Files cần tạo: handlers/transcribe.js, tests/test_transcribe.js

## Manifest Structure (confirmed từ API)

### CB_THON manifest
```json
{
  "manifest_version": "v...",
  "user": {
    "user_id": "USR_THON01",
    "ho_ten": "Nguyễn Văn Test",
    "vai_tro": "CB_THON",
    "don_vi": "THON01",
    "nhanh": "UBND",
    "xa_code": "XATEST",
    "xa_name": "XATEST"
  },
  "indicators": [
    { "chi_so_id": "CS001", "ten_chi_so": "...", "don_vi_do": "ha", "linh_vuc": "NONG_NGHIEP", "kieu_du_lieu": "so" }
  ],
  "requests": [
    {
      "req_id": "REQ001", "tieu_de": "...", "deadline": "2025-12-31",
      "chi_so_ids": ["CS001", "CS002"],        ← array ✅
      "danh_sach_thon": ["THON01", "THON02"],  ← array ✅
      "has_submitted": true,
      "tao_boi": "USR_LANHDAO"
    }
  ],
  "config": { "current_year": 2025, "drive_folder_id": null }
}
```

### CB_CM manifest (BUG: arrays thành strings)
```json
{
  "user": { "vai_tro": "CB_CHUYEN_MON", "ho_ten": "Lê Thị Chuyên Môn", ... },
  "requests": [
    {
      "chi_so_ids": "CS001 CS002",       ← ❌ BUG: phải là array
      "danh_sach_thon": "THON01 THON02", ← ❌ BUG: phải là array
    }
  ]
  // ❌ THIẾU: pending_verifications
}
```

## Key Paths (firestore.js)
```
users/{userId}
communes/{xaCode}/indicators/{id}
communes/{xaCode}/requests/{id}
communes/{xaCode}/submissions/{id}
communes/{xaCode}/manifests/current
communes/{xaCode}/config/sync_state
xa_registry/{xaCode}  ← has sheets_id, status
audit_logs/{auto-id}
```

## Handler Pattern (luôn follow)
```js
async function myHandler(req, res) {
  const user = await validateToken(req);
  // validate → errorResponse(res, ERROR_CODES.DATA_001, "...")
  checkPermission(user, ACTIONS.MY_ACTION, { nhanh, ... });
  await logAudit(user, ACTIONS.MY_ACTION, { ... }, req);
  return successResponse(res, { ... });
}
```

## Test Users (xa: XATEST, password: Test@1234)
| user_id | vai_tro | nhanh | linh_vuc_codes |
|---|---|---|---|
| USR_THON01 | CB_THON | UBND | null |
| USR_CBCM01 | CB_CHUYEN_MON | UBND | [NONG_NGHIEP, XA_HOI] |
| USR_LANHDAO | LANH_DAO | UBND | null |

INTERNAL_SECRET = "care-commune-sync-2025-secret-key-minimum32chars"

## Seeded Test Data (XATEST, year 2025)
- Indicators: CS001 (NONG_NGHIEP), CS002 (XA_HOI), CS003 (CO_SO_HA_TANG), CS_DRAFT01
- Requests: REQ001 (OPEN, THON01+THON02), REQ002 (COMPLETED), REQ003 (OPEN, THON02 only)
- Submissions: 28 tổng, 17 verified, 9 pending_verify, 2 needs_attention

## Thứ Tự Ưu Tiên
1. Fix BUG-B1 + BUG-B2 (backend manifest) → deploy
2. Fix BUG-A1 + BUG-A2 (login form, ho_ten) → 
3. Build FEAT-2 (LANH_DAO verify) →
4. Build FEAT-1 (CB_CM tạo request) →
5. Build FEAT-3 (Settings/năm) →
6. Build FEAT-4 (Admin tạo user) → backend trước
7. FEAT-5 (Voice) → sau cùng