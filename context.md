# CommuneGovernance — CARE Vietnam
## Full Context Document — V3.2 (29/05/2026)

---

## CHANGELOG V3.2 (29/05/2026)

### Bugs đã fix trong session này
| ID | File | Fix |
|---|---|---|
| B1 | `handlers/verify.js` | Backend đọc cả `comment` và `verify_comment` (alias). App gửi `comment`. |
| B2 | `utils/manifest.js` | LANH_DAO/CB_CM: split `pending_verifications` (actionable) + `waiting_revision` (informational). NEEDS_REVISION không còn xuất hiện như actionable. |
| B3 | `utils/manifest.js` | CB_THON manifest mỗi request nay có: `submission_id`, `submission_status`, `verify_comment`, `indicator_reviews`, `submitted_values` |
| B4 | `handlers/requests.js` | `tao_boi: user.user_id` (thay vì `user.id`) |
| A1 | `(cb-thon)/index.jsx` | Show đúng status badge: Chưa nộp / Đang chờ duyệt / Đang xem xét / ⚠ Cần sửa lại / Đã xác nhận ✓ |
| A2 | `(cb-thon)/submit/[reqId].jsx` | Resubmit mode: show lý do từ chối, pre-fill giá trị cũ, gọi `resubmit_data` |
| A3 | `(cb-thon)/submit/[reqId].jsx` | Boolean field (kieu_du_lieu="boolean") render Switch toggle thay vì TextInput số |
| A4 | `(cb-cm)/index.jsx` | SectionList: "Cần xét duyệt" (PENDING_VERIFY + IN_REVIEW) + "Chờ thôn sửa" (NEEDS_REVISION, read-only) |
| A5 | `(lanh-dao)/index.jsx` | SectionList: "Cần xác nhận bypass" (PENDING_VERIFY only) + "Đang xử lý" (IN_REVIEW + NEEDS_REVISION) + "Tiến độ" |
| A6 | `(cb-cm)/verify/[subId].jsx` | Gửi `comment` (đã fix từ `verify_comment`) |
| A7 | `(lanh-dao)/verify/[subId].jsx` | Gửi `comment` (đã fix từ `verify_comment`) |
| A8 | `services/api.js` | Cần thêm hàm `resubmitData` (snippet có sẵn trong `api_resubmitData_snippet.js`) |
| Bug-A3 | `(cb-cm)/verify/[subId].jsx` | `ind.chi_so_id` (đã fix từ `ind.id`) |

### Seed script cập nhật
`tests/seed_test_data.js` v2: xóa submissions cũ trước khi seed, tạo sẵn:
- `SUB001` THON01/REQ001 → `PENDING_VERIFY` (CB_CM + LANH_DAO thấy ngay để verify)
- `SUB002` THON02/REQ001 → `NEEDS_REVISION` (test "chờ sửa" flow)

---

## 1. HẠ TẦNG & CÔNG NGHỆ

| Item | Value |
|---|---|
| API Live | https://careapi-cx7avsd4pa-as.a.run.app |
| Firebase Project | `communegovernance` — account `ngocdd@thiennhienviet.org.vn` |
| Backend Local | `F:\Developers\CARE\CommuneGovernance\` |
| App Local | `F:\Developers\CARE\CommuneGovernance\app\` |
| Backend Runtime | Node 24, Firebase Functions v2, Cloud Run `asia-southeast1` |
| App Stack | Expo SDK **52** (`"expo": "~52.0.0"`) |
| EAS Project | `@paulsteigel/commune-governance` |

### Build Commands
```powershell
# LOCAL DEBUG
cd F:\Developers\CARE\CommuneGovernance\app\android
.\gradlew.bat assembleDebug

# EAS PREVIEW APK
cd F:\Developers\CARE\CommuneGovernance\app
$env:PATH += ";C:\Users\Administrator\AppData\Roaming\npm"
eas build --platform android --profile preview

# BACKEND DEPLOY
cd F:\Developers\CARE\CommuneGovernance
npx firebase use communegovernance --account ngocdd@thiennhienviet.org.vn
npx firebase deploy --only functions

# RESET TEST DATA (chạy khi cần demo lại từ đầu)
node tests/seed_test_data.js
```

### Test Users (xa: XATEST, password: Test@1234)
| user_id | vai_tro | don_vi | linh_vuc_codes |
|---|---|---|---|
| USR_THON01 | CB_THON | THON01 | null |
| USR_CBCM01 | CB_CHUYEN_MON | PHONG_NONG_NGHIEP | [NONG_NGHIEP, XA_HOI] |
| USR_LANHDAO | LANH_DAO | XA | null |

`INTERNAL_SECRET = "care-commune-sync-2025-secret-key-minimum32chars"`

### Seeded Test Data (XATEST, năm 2025)
- **Indicators**: CS001 (NONG_NGHIEP), CS002 (XA_HOI), CS003 (CO_SO_HA_TANG, boolean), CS_DRAFT01
- **Requests**: REQ001 (OPEN, THON01+THON02), REQ002 (COMPLETED), REQ003 (OPEN, THON02 only)
- **Submissions** (sau seed v2):
  - SUB001: THON01/REQ001 → PENDING_VERIFY ← demo luồng verify
  - SUB002: THON02/REQ001 → NEEDS_REVISION ← demo luồng từ chối/sửa lại

---

## 2. BUSINESS FLOW — LUỒNG NGHIỆP VỤ CHÍNH

```
LANH_DAO / CB_CM
   │ createRequest (tieu_de, chi_so_ids, danh_sach_thon, deadline)
   ▼
CB_THON nhận trong manifest
   │ pushData (submit số liệu)
   ▼
PENDING_VERIFY  ←─────────────────────────────┐
   │                                          │ resubmitData
   ├── CB_CM verify (confirm) ──► VERIFIED    │
   ├── CB_CM verify (reject)  ──► NEEDS_REVISION ─► CB_THON sửa
   ├── CB_CM save progress    ──► IN_REVIEW   │
   │                                          │
   └── LANH_DAO bypass verify ──► VERIFIED    │
       (khi CB_CM chưa xử lý)                │
                                              │
IN_REVIEW                                    │
   ├── CB_CM verify (confirm) ──► VERIFIED    │
   └── CB_CM verify (reject)  ──► NEEDS_REVISION ─┘

VERIFIED: LANH_DAO thấy trong dashboard (summary.verified++)
```

### Quy tắc trạng thái
| Trạng thái | CB_THON thấy | CB_CM thấy | LANH_DAO thấy |
|---|---|---|---|
| PENDING_VERIFY | "Đang chờ duyệt" | `pending_verifications` (actionable) | `pending_verifications` (bypass-able) |
| IN_REVIEW | "Đang xem xét" | `pending_verifications` (actionable) | `waiting_revision` (informational) |
| NEEDS_REVISION | "⚠ Cần sửa lại" | `waiting_revision` (informational) | `waiting_revision` (informational) |
| VERIFIED | "Đã xác nhận ✓" | (không hiện) | dashboard summary |

---

## 3. BACKEND — TRẠNG THÁI

### Deployment
- **Deployed & Live** ✅ — https://careapi-cx7avsd4pa-as.a.run.app

### Endpoints
| Endpoint | Handler | Status |
|---|---|---|
| POST /login | auth.login | ✅ Live |
| POST /logout | auth.logout | ✅ Live |
| POST /pull_manifest | auth.pullManifest | ✅ Live |
| POST /push_data | data.pushData | ✅ Live |
| POST /resubmit_data | verify.resubmitData | ✅ Live |
| POST /create_indicator | indicators.createIndicator | ✅ Live |
| POST /approve_indicator | indicators.approveIndicator | ✅ Live |
| POST /create_request | requests.createRequest | ✅ Live |
| POST /verify_data | verify.verifyData | ✅ Live |
| GET /dashboard | dashboard.getDashboard | ✅ Live |
| POST /sync_to_sheets | sync.syncToSheets | ✅ Live |
| GET /health | inline | ✅ Live |

### Endpoints cần thêm (chưa làm)
| Endpoint | Handler | Priority |
|---|---|---|
| POST /create_user | handlers/users.js | 🟡 FEAT-4 |
| POST /speech_token | handlers/transcribe.js | 🟢 FEAT-5 |
| POST /report_incident | handlers/incidents.js | 🟢 Lớp 3 |

### Project Structure (Backend)
```
F:\Developers\CARE\CommuneGovernance\
├── index.js
├── handlers/
│   ├── auth.js           ✅ login/logout/pullManifest
│   ├── data.js           ✅ pushData
│   ├── indicators.js     ✅ createIndicator, approveIndicator
│   ├── requests.js       ✅ createRequest (fixed: tao_boi uses user.user_id)
│   ├── verify.js         ✅ verifyData, resubmitData (fixed: comment alias)
│   ├── dashboard.js      ✅ getDashboard
│   └── sync.js           ✅ syncToSheets
├── middleware/
│   ├── validateToken.js  ✅
│   ├── checkPermission.js✅
│   └── logAudit.js       ✅
└── utils/
    ├── firestore.js      ✅
    ├── crypto.js         ✅
    ├── manifest.js       ✅ v2: pending_verifications/waiting_revision split, CB_THON submission enrichment
    ├── response.js       ✅
    └── constants.js      ✅
```

### Submission Status Flow
```
PENDING_VERIFY → IN_REVIEW     (CB_CM/LANH_DAO đang xem, save progress)
              → VERIFIED        (confirmed all — CB_CM hoặc LANH_DAO bypass)
              → NEEDS_REVISION  (CB_THON phải sửa lại)
NEEDS_REVISION → PENDING_VERIFY (sau khi CB_THON resubmit)
```

---

## 4. APP — TRẠNG THÁI

### Màn hình
| Screen | Route | Trạng thái |
|---|---|---|
| Login | /(auth)/login | ✅ |
| CB_THON Dashboard | /(cb-thon)/ | ✅ Show đúng submission status per request |
| CB_THON Submit/Resubmit | /(cb-thon)/submit/[reqId] | ✅ New + Resubmit mode + Boolean field |
| CB_CM Dashboard | /(cb-cm)/ | ✅ 2 sections: actionable + waiting_revision |
| CB_CM Verify | /(cb-cm)/verify/[subId] | ✅ Fixed comment field |
| LANH_DAO Dashboard | /(lanh-dao)/ | ✅ 3 sections: bypass + waiting + progress |
| LANH_DAO Verify (bypass) | /(lanh-dao)/verify/[subId] | ✅ Fixed comment field + bypass banner |

### Project Structure (App)
```
F:\Developers\CARE\CommuneGovernance\app\
├── app/
│   ├── _layout.jsx               ✅ Root + AuthGuard + role redirect
│   ├── (auth)/login.jsx          ✅
│   ├── (cb-thon)/
│   │   ├── index.jsx             ✅ Status-aware request list
│   │   └── submit/[reqId].jsx   ✅ New + Resubmit + Boolean field
│   ├── (cb-cm)/
│   │   ├── index.jsx             ✅ SectionList (actionable + waiting)
│   │   └── verify/[subId].jsx   ✅
│   └── (lanh-dao)/
│       ├── index.jsx             ✅ SectionList (bypass + waiting + progress)
│       └── verify/[subId].jsx   ✅
│
├── store/authStore.js            ✅ token, user, xa_code, year, manifest, offlineQueue
├── services/api.js               ✅ + resubmitData (cần thêm từ snippet)
├── constants/theme.js            ✅
├── constants/config.js           ✅
└── components/
    ├── StatusBadge.jsx           ✅
    ├── LoadingOverlay.jsx        ✅
    └── OfflineBanner.jsx         ✅
```

---

## 5. MANIFEST RESPONSE (sau V3.2)

### CB_THON — enriched requests
```json
{
  "manifest_version": "v...",
  "user": { "vai_tro": "CB_THON", "don_vi": "THON01", ... },
  "indicators": [...],
  "requests": [
    {
      "req_id": "REQ001",
      "tieu_de": "Báo cáo nông nghiệp Q2/2025",
      "chi_so_ids": ["CS001", "CS002", "CS003"],
      "danh_sach_thon": ["THON01", "THON02"],
      "deadline": "2025-12-31",
      "has_submitted": true,
      "submission_id": "SUB001",
      "submission_status": "NEEDS_REVISION",
      "verify_comment": "Số liệu diện tích lúa có vẻ thấp bất thường",
      "indicator_reviews": { "CS001": { "status": "rejected", "review_note": "Cần xác minh" } },
      "submitted_values": { "CS001": 45.5, "CS002": 12, "CS003": true }
    }
  ]
}
```

### CB_CM — split verifications
```json
{
  "user": { "vai_tro": "CB_CHUYEN_MON", ... },
  "pending_verifications": [
    {
      "submission_id": "SUB001", "req_id": "REQ001",
      "thon_code": "THON01", "status": "PENDING_VERIFY",
      "submitted_at": "2026-05-29T...",
      "values": { "CS001": 45.5, "CS002": 12, "CS003": true },
      "verify_comment": null, "indicator_reviews": null,
      "tieu_de": "Báo cáo nông nghiệp Q2/2025"
    }
  ],
  "waiting_revision": [
    {
      "submission_id": "SUB002", "status": "NEEDS_REVISION",
      "verify_comment": "Số liệu diện tích lúa có vẻ thấp bất thường",
      ...
    }
  ]
}
```

### LANH_DAO — bypass only
```json
{
  "user": { "vai_tro": "LANH_DAO", ... },
  "pending_verifications": [
    // PENDING_VERIFY only — LANH_DAO có thể bypass
  ],
  "waiting_revision": [
    // IN_REVIEW + NEEDS_REVISION — chỉ xem, không action được
  ]
}
```

---

## 6. KIẾN TRÚC 5 LỚP — KẾ HOẠCH THỰC HIỆN

### Lớp 1 — Nghiệp vụ (Business) — TRẠNG THÁI HIỆN TẠI
| Feature | Status |
|---|---|
| CB_THON: nhận yêu cầu, submit, resubmit | ✅ Done |
| CB_CM: xem + xét duyệt (batch + per-indicator) | ✅ Done |
| LANH_DAO: xem dashboard + bypass verify | ✅ Done |
| LANH_DAO: tạo request | ✅ API done, app chưa có UI |
| CB_CM: tạo request | ✅ API done, app chưa có UI |
| CB_CM: tạo + trình bộ chỉ số | ✅ API done, app chưa có UI |
| LANH_DAO: duyệt bộ chỉ số (PENDING→ACTIVE) | ✅ API done, app chưa có UI |
| Nhắc nhở CB_CM (timeout bypass) | ⬜ Chưa làm |

### Lớp 2 — Báo cáo | Lớp 3 — Sự cố | Lớp 4 — Hồ sơ | Lớp 5 — Admin
⬜ Chưa làm — xem phần 7 (thứ tự thực hiện)

---

## 7. THỨ TỰ THỰC HIỆN (Recommended)

### Giai đoạn 1 — DONE ✅
Core flow hoạt động end-to-end: submit → verify/reject → resubmit

### Giai đoạn 2 — Navigation refactor (Trước khi xây Lớp 2+)
```
Refactor sang Tab + Stack:
  Tab: Nghiệp vụ / Báo cáo / Hồ sơ / Admin (conditional)
  Move existing role screens vào tab "Nghiệp vụ"
```

### Giai đoạn 3 — Hoàn thiện Lớp 1
```
- UI tạo request (CB_CM + LANH_DAO)
- UI tạo chỉ số (CB_CM)
- UI duyệt chỉ số (LANH_DAO)
- Nhắc nhở timeout bypass
- Nút "Hoàn thành thu thập" / xuất bản request
```

### Giai đoạn 4 — Lớp 2 Báo cáo
```
- Tabular: VERIFIED data lọc theo req/năm/thôn
- Chart: time-series cho chỉ số dạng "so"
```

### Giai đoạn 5 — Lớp 4 & 5
```
- Profile + Settings + chọn năm
- POST /create_user + Admin UI
```

### Giai đoạn 6 — Lớp 3 & Voice
```
- FEAT-5: Voice (Azure Speech)
- FEAT-7: Incident reporting + geotag
```

---

## 8. FIRESTORE SCHEMA

```
users/{user_id}
  user_id, xa_code, ho_ten, vai_tro, don_vi, nhanh,
  linh_vuc_codes[], password_hash, password_salt,
  session_token, token_expires_at, status, last_login_at

communes/{xa_code}/indicators/{chi_so_id}
  chi_so_id, ten_chi_so, mo_ta, don_vi_do,
  kieu_du_lieu ("so" | "boolean" | "text"),
  linh_vuc, validation{}, status(DRAFT→PENDING→ACTIVE→ARCHIVED),
  created_by, approved_by, year

communes/{xa_code}/requests/{req_id}
  req_id, tieu_de, tao_boi (user_id), danh_sach_thon[],
  chi_so_ids[], linh_vuc_list[], deadline (YYYY-MM-DD),
  dinh_ky (THANG|QUY|ADHOC) [BUG-B3: chưa implement],
  ghi_chu, status (OPEN|IN_PROGRESS|COMPLETED|CANCELLED), year

communes/{xa_code}/submissions/{submission_id}
  submission_id, req_id, thon_code, submitted_by,
  submitted_at (Timestamp), device_collected_at (Timestamp),
  values {chi_so_id: value}, anh_urls[],
  status (PENDING_VERIFY|IN_REVIEW|VERIFIED|NEEDS_REVISION|REJECTED),
  verify_mode ("batch"|"per_indicator"),
  verified_by, verified_at, verify_comment,
  indicator_reviews {chi_so_id: {status, review_note}},
  flagged (bool), rejection_reason,
  resubmitted_by, resubmitted_at, year

communes/{xa_code}/manifests/current
  Pre-computed, rebuilt on every indicator/request change

xa_registry/{xa_code}
  xa_code, xa_name, tinh, sheets_id, drive_folder_id, status

audit_logs/{auto-id}
  user_id, xa_code, action, timestamp, detail{}, ip
```

---

## 9. PRINCIPLES & CONSTRAINTS (bất biến)

```
OFFLINE-FIRST:  CB_THON pull 1 lần → nhập liệu offline → push khi có mạng
                CB_CM/LANH_DAO: manifest offline, verify cần online
ZERO VM:        Serverless. Cloud Functions + Firestore.
SHEETS OUTPUT:  Google Sheets chỉ để CARE staff đọc.
SCALE:          4 → 500 xã: chỉ thêm data, không đổi code.

R1: CHỈ LANH_DAO được approve indicator (PENDING → ACTIVE)
R2: CHỈ CB_THON được push_data
R3: CB_CM chỉ tạo/verify indicators thuộc linh_vuc_codes của mình
R4: CB_THON KHÔNG BAO GIỜ thấy data thôn khác
R5: push_data verify user.don_vi ∈ request.danh_sach_thon
R6: Manifest filter server-side — không tin client
R7: (req_id, thon_code) chỉ submit 1 lần
R8: LANH_DAO bypass chỉ áp dụng cho PENDING_VERIFY (CB_CM chưa xử lý)
    NEEDS_REVISION = CB_CM đã quyết định, CB_THON phải sửa, bypass không hợp lệ
```

---

## 10. HANDLER PATTERN (luôn follow)

```js
async function myHandler(req, res) {
  const user = await validateToken(req);
  const { xa_code, year, ...data } = req.body;

  if (!xa_code || !year)
    return errorResponse(res, ERROR_CODES.DATA_001, "...");

  checkPermission(user, ACTIONS.MY_ACTION, { ... });

  // business logic...

  await logAudit(user, ACTIONS.MY_ACTION, { ... }, req);
  return successResponse(res, { ... });
}
```

---

## 11. FILES THAY ĐỔI TRONG V3.2

| File đích | File nguồn |
|---|---|
| `utils/manifest.js` | `fixes/backend/utils/manifest.js` |
| `handlers/verify.js` | `fixes/backend/handlers/verify.js` |
| `handlers/requests.js` | `fixes/backend/handlers/requests.js` |
| `app/(cb-thon)/index.jsx` | `fixes/app/cb-thon/index.jsx` |
| `app/(cb-thon)/submit/[reqId].jsx` | `fixes/app/cb-thon/submit_reqId.jsx` |
| `app/(cb-cm)/index.jsx` | `fixes/app/cb-cm/index.jsx` |
| `app/(cb-cm)/verify/[subId].jsx` | `fixes/app/cb-cm/verify_subId.jsx` |
| `app/(lanh-dao)/index.jsx` | `fixes/app/lanh-dao/index.jsx` |
| `app/(lanh-dao)/verify/[subId].jsx` | `fixes/app/lanh-dao/verify_subId.jsx` |
| `services/api.js` | Thêm function từ `fixes/app/api_resubmitData_snippet.js` |
| `tests/seed_test_data.js` | Download từ output session trước |

---

*Context V3.2 — CommuneGovernance CARE Vietnam*
*Updated: 29/05/2026*