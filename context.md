# CommuneGovernance — Dev Context V3.3
> Paste toàn bộ file này vào đầu session mới.

---

## 1. Tổng quan dự án

App thu thập số liệu nông thôn mới cho CARE Vietnam / Quảng Trị.
**Pro-bono** — ưu tiên chi phí Firestore thấp nhất, luôn giữ trong free tier (50K reads/day).

| Item | Value |
|---|---|
| **API Live** | https://careapi-cx7avsd4pa-as.a.run.app |
| **Backend path** | `F:\Developers\CARE\CommuneGovernance\` |
| **App path** | `F:\Developers\CARE\CommuneGovernance\app\` |
| **Firebase project** | `communegovernance` |
| **Firebase account** | ngocdd@thiennhienviet.org.vn |
| **Cloud Run region** | asia-southeast1 |
| **Runtime** | Node 24, Firebase Functions v2, Expo SDK 52 (expo-router ~4.0) |
| **Build output** | `app\android\app\build\outputs\apk\release\app-release.apk` |

---

## 2. Test Users (xã XATEST, password: Test@1234)

| user_id | vai_tro | don_vi / scope |
|---|---|---|
| USR_THON01 | CB_THON | THON01 |
| USR_CBCM01 | CB_CHUYEN_MON | PHONG_NONG_NGHIEP · linh_vuc: [NONG_NGHIEP, XA_HOI] |
| USR_LANHDAO | LANH_DAO | XA |

---

## 3. Kiến trúc hệ thống

### 3.1 Backend (Express + Firebase Functions v2)

```
index.js                   ← Express router, lazy-load handlers
handlers/
  auth.js                  ← login, logout, pullManifest
  data.js                  ← pushData (CB_THON)
  verify.js                ← verifyData, resubmitData
  indicators.js            ← createIndicator, submitIndicator, approveIndicator, rejectIndicator
  requests.js              ← createRequest
  report.js                ← getReportData (GET /report_data)
  dashboard.js             ← getDashboard
  sync.js                  ← syncToSheets (Cloud Scheduler)
utils/
  constants.js             ← ROLES, ACTIONS, ERROR_CODES, INDICATOR_STATUS, PERMISSION_MATRIX
  manifest.js              ← buildManifest, rebuildManifest
  firestore.js             ← db, paths, queryAll, serverTimestamp
  response.js              ← successResponse, errorResponse, asyncHandler
middleware/
  validateToken.js
  checkPermission.js
  logAudit.js
```

### 3.2 App (Expo Router ~4.0)

```
app/
  _layout.jsx              ← root layout, auth redirect
  login.jsx
  (cb-thon)/
    _layout.jsx            ← Tabs: Yêu cầu | Số liệu
    index.jsx              ← danh sách request + submission status
    report.jsx             ← số liệu thôn mình
    submit/[reqId].jsx     ← nộp / xem lại / resubmit
  (cb-cm)/
    _layout.jsx            ← Tabs: Nghiệp vụ | Chỉ số | Số liệu
    index.jsx              ← danh sách submission cần xét duyệt
    verify/[subId].jsx     ← xét duyệt submission
    indicators.jsx         ← quản lý chỉ số của mình
    indicator-create.jsx   ← tạo / chỉnh sửa chỉ số
    report.jsx             ← số liệu theo lĩnh vực mình
  (lanh-dao)/
    _layout.jsx            ← Tabs: Nghiệp vụ | Chỉ số | Số liệu
    index.jsx              ← bypass queue + tiến độ
    verify/[subId].jsx     ← xác nhận bypass
    indicators.jsx         ← duyệt / từ chối PENDING indicators
    report.jsx             ← số liệu toàn xã
services/
  api.js                   ← tất cả API calls
store/
  authStore.js             ← Zustand: user, manifest, token, xa_code, year
constants/
  theme.js                 ← COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET
  config.js                ← API_BASE_URL, API_TIMEOUT
components/
  LoadingOverlay.jsx
```

---

## 4. Data Model (Firestore)

```
communes/{xa_code}/
  indicators/{chi_so_id}
    chi_so_id, ten_chi_so, don_vi_do, mo_ta
    kieu_du_lieu: "so" | "text" | "boolean" | "anh"
    linh_vuc: string
    status: DRAFT | PENDING | ACTIVE | REJECTED | ARCHIVED
    created_by, nhanh, year
    rejection_reason, rejected_by, rejected_at
    approved_by, approved_at
    validation: { required, min?, max? }

  requests/{req_id}
    req_id, tieu_de, chi_so_ids[], danh_sach_thon[]
    status: OPEN | IN_PROGRESS | COMPLETED | CANCELLED
    year, dinh_ky, deadline, tao_boi, ghi_chu

  submissions/{submission_id}
    submission_id, req_id, thon_code, year
    status: PENDING_VERIFY | IN_REVIEW | VERIFIED | NEEDS_REVISION | REJECTED
    values: { [chi_so_id]: value }
    submitted_by, submitted_at, verified_at
    verify_comment, indicator_reviews
    device_collected_at

  manifest/{xa_code}
    version, generated_at, xa_code, xa_name, year
    indicators[], requests[]

users/{user_id}
  user_id, ho_ten, vai_tro, don_vi, nhanh, xa_code
  linh_vuc_codes[]   ← CB_CM only
  sessions[]
```

---

## 5. API Endpoints (tất cả prefix: https://careapi-cx7avsd4pa-as.a.run.app)

| Method | Path | Ai dùng | Mô tả |
|---|---|---|---|
| POST | /login | ALL | Trả về token + manifest |
| POST | /logout | ALL | Xóa session |
| POST | /pull_manifest | ALL | Lấy manifest mới / check version |
| POST | /push_data | CB_THON | Nộp số liệu lần đầu |
| POST | /resubmit_data | CB_THON | Nộp lại sau NEEDS_REVISION |
| POST | /create_indicator | CB_CM, LANH_DAO | Tạo chỉ số → DRAFT |
| POST | /submit_indicator | CB_CM | DRAFT/REJECTED → PENDING |
| POST | /approve_indicator | LANH_DAO | PENDING → ACTIVE + rebuild manifest |
| POST | /reject_indicator | LANH_DAO | PENDING → REJECTED + lý do |
| POST | /create_request | CB_CM, LANH_DAO | Tạo yêu cầu thu thập |
| POST | /verify_data | CB_CM, LANH_DAO | Xét duyệt submission |
| GET | /report_data | ALL | Aggregate VERIFIED data, hỗ trợ compare_year |
| GET | /dashboard | LANH_DAO, ADMIN | Dashboard tổng quan |
| POST | /sync_to_sheets | Internal | Cloud Scheduler → Google Sheets |
| GET | /health | ALL | Health check |

### Request body pattern (tất cả POST cần):
```json
{ "token": "...", "user_id": "...", "xa_code": "XATEST", "year": 2025, ...payload }
```

### GET /report_data params:
```
?token=...&user_id=...&xa_code=XATEST&year=2025&compare_year=2024
```
Response:
```json
{
  "xa_code": "XATEST", "year": 2025, "compare_year": 2024,
  "data": {
    "CS_XXXXXXXX": {
      "by_thon": { "THON01": 120, "THON02": 85 },
      "total": 205,
      "count_true": null,
      "thon_count": 2
    }
  },
  "compare": { ... }
}
```

---

## 6. Manifest Response Structure (V3)

### Tất cả roles nhận:
```json
{
  "manifest_version": "v20250529...",
  "user": { "user_id", "ho_ten", "vai_tro", "don_vi", "nhanh", "xa_code" },
  "indicators": [...],   // ACTIVE only
  "requests": [...],
  "config": { "current_year": 2025 }
}
```

### CB_THON thêm (mỗi request):
```json
{
  "submission_id": "SUB_...",
  "submission_status": "PENDING_VERIFY | NEEDS_REVISION | VERIFIED | null",
  "verify_comment": "...",
  "indicator_reviews": { "CS_X": { "status": "NEEDS_REVISION", "comment": "..." } },
  "submitted_values": { "CS_X": 120 }
}
```

### CB_CM thêm:
```json
{
  "pending_verifications": [...],   // PENDING_VERIFY + IN_REVIEW → actionable
  "waiting_revision":      [...],   // NEEDS_REVISION → informational
  "my_indicators":         [...]    // tất cả status của indicators mình tạo
}
```

### LANH_DAO thêm:
```json
{
  "pending_verifications": [...],   // PENDING_VERIFY only → bypass action
  "waiting_revision":      [...],   // IN_REVIEW + NEEDS_REVISION
  "pending_indicators":    [...]    // indicators PENDING chờ approve/reject
}
```

---

## 7. Indicator Lifecycle

```
CB_CM tạo  →  DRAFT
CB_CM gửi  →  PENDING    (POST /submit_indicator)
LANH_DAO   →  ACTIVE     (POST /approve_indicator) → rebuildManifest()
           →  REJECTED   (POST /reject_indicator)  → có rejection_reason
CB_CM sửa + gửi lại → PENDING lại
```

**Uniqueness rule**: `normalize(ten_chi_so) + normalize(don_vi_do)` per xa+year.
Chỉ check trong DRAFT/PENDING/ACTIVE. REJECTED/ARCHIVED được phép tạo lại.
Cross-lĩnh vực: không được duplicate (1 chỉ số dùng chung cho nhiều lĩnh vực).

---

## 8. Submission / Verify Lifecycle

```
CB_THON push_data          → PENDING_VERIFY
CB_CM verify (IN_REVIEW)   → PENDING_VERIFY → IN_REVIEW (đánh từng chỉ số)
CB_CM verify (APPROVE)     → IN_REVIEW → VERIFIED
CB_CM verify (REVISION)    → IN_REVIEW → NEEDS_REVISION (kèm verify_comment)
CB_THON resubmit           → NEEDS_REVISION → PENDING_VERIFY
LANH_DAO bypass            → PENDING_VERIFY → VERIFIED (bỏ qua CB_CM)
```

---

## 9. Tab "Số liệu" — Design Decisions

- **Fetch on-demand**: không nhét historical data vào manifest. Gọi `/report_data` khi mở tab, cache trong component state.
- **So sánh kỳ**: combo dropdown chọn năm (currentYear-2, currentYear-1, currentYear). Không phải "Q1 vs Q2" — chỉ so năm.
- **Tăng/giảm**: hiển thị % thay đổi + arrow icon (↑/↓). Không phán "tốt/xấu" — chỉ quan sát.
- **Scope filter**:
  - CB_THON: backend đã lọc theo thôn
  - CB_CM: app filter theo `linh_vuc_codes`
  - LANH_DAO: thấy tất cả

---

## 10. Seed Data (sau khi chạy seed script)

```
SUB001: THON01/REQ001 → PENDING_VERIFY
SUB002: THON02/REQ001 → NEEDS_REVISION
```

Reset:
```powershell
node tests/seed_test_data.js
```

---

## 11. Deploy Commands

```powershell
# Backend
cd F:\Developers\CARE\CommuneGovernance
npx firebase deploy --only functions

# App (release APK)
cd F:\Developers\CARE\CommuneGovernance\app\android
.\gradlew.bat assembleRelease
# Output: app\build\outputs\apk\release\app-release.apk
```

---

## 12. Files đã deliver (session này)

### backend_v3.zip → extract vào `F:\Developers\CARE\CommuneGovernance\`
| File | Thay đổi |
|---|---|
| `utils/constants.js` | + REJECTED status, + SUBMIT/REJECT/GET_REPORT actions |
| `utils/manifest.js` | + my_indicators (CB_CM), + pending_indicators (LANH_DAO), parallel reads |
| `handlers/indicators.js` | + uniqueness check, + submitIndicator, + rejectIndicator |
| `handlers/report.js` | MỚI: GET /report_data aggregate VERIFIED |
| `index.js` | + /submit_indicator, /reject_indicator, /report_data routes |

### app_v3.zip → extract vào `F:\Developers\CARE\CommuneGovernance\app\`
| File | Thay đổi |
|---|---|
| `(cb-cm)/_layout.jsx` | Stack → Tabs (Nghiệp vụ / Chỉ số / Số liệu) |
| `(cb-cm)/indicators.jsx` | MỚI: list chỉ số, gửi duyệt, badge status |
| `(cb-cm)/indicator-create.jsx` | MỚI: form tạo/sửa + realtime duplicate warning |
| `(cb-cm)/report.jsx` | MỚI: Số liệu tab, compare year |
| `(lanh-dao)/_layout.jsx` | Stack → Tabs |
| `(lanh-dao)/indicators.jsx` | MỚI: approve/reject PENDING indicators |
| `(lanh-dao)/report.jsx` | MỚI: Số liệu toàn xã + breakdown theo thôn |
| `(cb-thon)/_layout.jsx` | Stack → Tabs (Yêu cầu / Số liệu) |
| `(cb-thon)/report.jsx` | MỚI: Số liệu thôn mình |
| `services/api.js` | + submitIndicator, approveIndicator, rejectIndicator, getReportData |

---

## 13. Các files KHÔNG thay đổi (vẫn dùng bản cũ)

- `handlers/auth.js`
- `handlers/data.js`
- `handlers/verify.js`
- `handlers/requests.js`
- `handlers/dashboard.js`
- `utils/firestore.js`
- `utils/response.js`
- `middleware/validateToken.js`
- `middleware/checkPermission.js`
- `middleware/logAudit.js`
- `app/(cb-cm)/index.jsx`
- `app/(cb-cm)/verify/[subId].jsx`
- `app/(cb-thon)/index.jsx`
- `app/(cb-thon)/submit/[reqId].jsx`
- `app/(lanh-dao)/index.jsx`
- `app/(lanh-dao)/verify/[subId].jsx`
- `app/store/authStore.js`
- `app/constants/theme.js`
- `app/constants/config.js`
- `app/components/LoadingOverlay.jsx`

---

## 14. Pending / Roadmap (chưa làm)

### Ưu tiên cao (cần thiết để app hoàn chỉnh):
- [ ] **Request creation UI** — API đã có (`/create_request`), chỉ thiếu screen
- [ ] **"Hoàn thành thu thập"** — nút publish request sau khi đủ submissions
- [ ] **Notification timeout bypass** — CB_CM không xét duyệt trong X ngày → LANH_DAO tự động nhận

### Ưu tiên trung bình:
- [ ] **Admin role** — user management screen, tạo xã mới, tạo user
- [ ] **Admin setting**: show/hide DRAFT indicators của người khác
- [ ] **Tab bar behavior**: verify/submit screens hiện vẫn thấy tab bar khi push (acceptable)

### Ưu tiên thấp:
- [ ] **Multi-year seed data** — test compare_year cần có data ở 2025 và 2024
- [ ] Google Sheets sync UI/status

---

## 15. Quota & Cost Tracking

| Hành động | Reads | Writes | Ghi chú |
|---|---|---|---|
| login | 2 | 1 | validateToken + user + session |
| pull_manifest (CB_CM) | 3–4 | 0 | manifest + subs + indicators (parallel) |
| pull_manifest (LANH_DAO) | 3–4 | 0 | manifest + subs + pending_inds (parallel) |
| push_data | 3 | 2 | token + request + manifest / sub + audit |
| verify_data | 3 | 2 | token + sub + manifest / sub + audit |
| approve_indicator | 4 | 3 | token + ind + subs + reqs / ind + audit + manifest |
| report_data | 2–3 | 1 | token + subs(current) + subs(compare)? + audit |

**Ước tính 500 xã × 3 users: ~7,700 reads/day → 15% free tier quota**