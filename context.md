# CommuneGovernance — CARE Vietnam
## Full Context Document — V3 (27/05/2026)

---

## 1. HẠ TẦNG & CÔNG NGHỆ

| Item | Value |
|---|---|
| API Live | https://careapi-cx7avsd4pa-as.a.run.app |
| Firebase Project | `communegovernance` — account `ngocdd@thiennhienviet.org.vn` |
| Backend Local | `F:\Developers\CARE\CommuneGovernance\` |
| App Local | `F:\Developers\CARE\CommuneGovernance\app\` |
| Backend Runtime | Node 24, Firebase Functions v2, Cloud Run `asia-southeast1` |
| App Stack | Expo SDK **52** (package.json), EAS Build, project `@paulsteigel/commune-governance` |
| App Build | EAS cloud build — `eas build --platform android --profile preview` (APK) |
| Note | Expo Go không dùng được vì có native module `@react-native-community/netinfo` |

> ⚠️ **Discrepancy**: Context cũ ghi "Expo SDK 56" nhưng `package.json` thực tế là `"expo": "~52.0.0"`. Cần xác nhận lại version đang dùng khi build.

### Test Users (xa: XATEST, password: Test@1234)

| user_id | vai_tro | nhanh | linh_vuc_codes |
|---|---|---|---|
| USR_THON01 | CB_THON | UBND | null |
| USR_CBCM01 | CB_CHUYEN_MON | UBND | [NONG_NGHIEP, XA_HOI] |
| USR_LANHDAO | LANH_DAO | UBND | null |

`INTERNAL_SECRET = "care-commune-sync-2025-secret-key-minimum32chars"`

### Seeded Test Data (XATEST, year 2025)
- **Indicators**: CS001 (NONG_NGHIEP), CS002 (XA_HOI), CS003 (CO_SO_HA_TANG), CS_DRAFT01
- **Requests**: REQ001 (OPEN, THON01+THON02), REQ002 (COMPLETED), REQ003 (OPEN, THON02 only)
- **Submissions**: 28 tổng — 17 verified, 9 pending_verify, 2 needs_attention

---

## 2. KIẾN TRÚC PHÂN LỚP APP (V3 — Mới)

App được tổ chức thành **5 lớp chức năng** thay vì flat theo role:

```
┌─────────────────────────────────────────────────────────────┐
│  LỚP 1 — NGHIỆP VỤ (Business)                              │
│  Phân theo chức năng của từng role                          │
├─────────────────────────────────────────────────────────────┤
│  LỚP 2 — TRÌNH BÀY DỮ LIỆU (Presentation)                  │
│  Báo cáo tabular + biểu đồ theo lịch sử công bố            │
├─────────────────────────────────────────────────────────────┤
│  LỚP 3 — TIỆN ÍCH BỔ SUNG (Utilities) — Làm sau            │
│  Báo cáo tình huống: thiên tai, sạt lở, dịch bệnh + geotag │
├─────────────────────────────────────────────────────────────┤
│  LỚP 4 — HỒ SƠ NGƯỜI DÙNG (Profile)                        │
│  Thông tin user, đổi mật khẩu, cài đặt năm báo cáo         │
├─────────────────────────────────────────────────────────────┤
│  LỚP 5 — QUẢN TRỊ (Admin)                                   │
│  Chỉ ADMIN + LANH_DAO: tạo user, quản lý bộ chỉ số         │
└─────────────────────────────────────────────────────────────┘
```

### Lớp 1 — Nghiệp vụ theo Role

**LANH_DAO:**
- ✅ Dashboard tiến độ nộp số liệu theo yêu cầu
- ✅ Xác minh/xác nhận dữ liệu thôn gửi lên (**bypass** CB_CM nếu CB_CM không làm)
- ⬜ Nhắc nhở CB_CM xác minh / thôn thu thập thông tin (push notification hoặc in-app)
- ✅ Review & duyệt bộ chỉ số do CB_CM trình (PENDING → ACTIVE) — nhằm tránh trùng lặp, pháp lý hóa cơ sở

**CB_CHUYEN_MON:**
- ✅ Xem + xét duyệt submissions (per_indicator hoặc batch mode)
- ⬜ Tạo yêu cầu cung cấp thông tin (FEAT-1) — chọn bộ chỉ số theo ngành, chọn định kỳ, gửi đúng nhánh CB_THON
- ✅ Tạo bộ chỉ số mới → trình LANH_DAO phê duyệt
- ⚠️ Kiểm tra trùng chỉ số khi tạo (tránh 2 ngành thu thập cùng 1 chỉ số)

**CB_THON:**
- ✅ Xem danh sách yêu cầu của thôn mình
- ✅ Thu thập và nộp số liệu (offline-first)
- ✅ Sửa và nộp lại khi bị NEEDS_REVISION (`resubmit_data`)

### Lớp 2 — Trình bày dữ liệu

- **Tabular**: hiển thị số liệu đã được duyệt & công bố (VERIFIED), lọc theo lịch sử công bố để theo dõi tiến trình
- Hiển thị theo cấp: CB_THON thấy thôn mình, CB_CM/LANH_DAO thấy toàn xã
- **Advanced**: biểu đồ / chart cho các chỉ số định lượng (số) để thấy biến động theo thời gian
- ⬜ **Chưa xây dựng** — cần thiết kế screen mới

### Lớp 3 — Tiện ích bổ sung *(Để sau)*

- Báo cáo tình huống khẩn: thiên tai, điểm sạt lở, dịch bệnh, sự cố
- Gắn **geotag** (GPS coordinates) để thể hiện trên bản đồ
- ⬜ **Chưa xây dựng** — cần backend endpoint + app screen mới

### Lớp 4 — Hồ sơ người dùng

- Thông tin cá nhân (ho_ten, vai_tro, xa_code, don_vi, nhanh)
- Đổi mật khẩu
- Cài đặt năm báo cáo (mặc định năm hiện tại; xem lại năm cũ read-only)
- ⬜ **Chưa xây dựng** — liên quan FEAT-3

### Lớp 5 — Quản trị *(ADMIN + LANH_DAO)*

- Tạo / quản lý user (FEAT-4): set vai_tro, nhanh, don_vi, linh_vuc_codes; generate password tạm
- Xem audit log
- Config định kỳ mặc định cho xã
- ⬜ **Chưa xây dựng** — cần backend POST /create_user trước

---

## 3. BACKEND — TRẠNG THÁI HIỆN TẠI

### Deployment
- **Deployed**: Cloud Run `asia-southeast1` ✅
- URL: `https://careapi-cx7avsd4pa-as.a.run.app`

### Endpoints đã có

| Endpoint | Handler | Status |
|---|---|---|
| POST /login | auth.login | ✅ Deployed |
| POST /logout | auth.logout | ✅ Deployed |
| POST /pull_manifest | auth.pullManifest | ✅ Deployed |
| POST /push_data | data.pushData | ✅ Deployed |
| POST /resubmit_data | verify.resubmitData | ✅ Deployed |
| POST /create_indicator | indicators.createIndicator | ✅ Deployed |
| POST /approve_indicator | indicators.approveIndicator | ✅ Deployed |
| POST /create_request | requests.createRequest | ✅ Deployed |
| POST /verify_data | verify.verifyData | ✅ Deployed |
| GET /dashboard | dashboard.getDashboard | ✅ Deployed |
| POST /sync_to_sheets | sync.syncToSheets | ✅ Deployed |
| GET /health | — | ✅ Deployed |

### Endpoint cần thêm

| Endpoint | Handler | Status |
|---|---|---|
| POST /create_user | handlers/users.js (mới) | ⬜ FEAT-4 |
| POST /speech_token | handlers/transcribe.js | ⬜ FEAT-5 (sau cùng) |
| POST /report_incident | handlers/incidents.js | ⬜ Lớp 3 — sau cùng |

### Project Structure (Backend)

```
F:\Developers\CARE\CommuneGovernance\
├── index.js                    ✅ Router Express + Cloud Function export
├── package.json                ✅ Node 24, express, firebase-admin, googleapis
├── firebase.json               ✅
├── firestore.rules             ✅ deny all from client
│
├── handlers/
│   ├── auth.js                 ✅ login (BUG-A1 fixed), logout, pullManifest
│   ├── data.js                 ✅ pushData (19 tests pass)
│   ├── indicators.js           ✅ createIndicator, approveIndicator (23 tests pass)
│   ├── requests.js             ✅ createRequest (25 tests pass)
│   ├── verify.js               ✅ verifyData (batch+per_indicator), resubmitData (34 tests pass)
│   ├── dashboard.js            ✅ getDashboard
│   └── sync.js                 ✅ syncToSheets (15 tests pass)
│
├── middleware/
│   ├── validateToken.js        ✅
│   ├── checkPermission.js      ✅ PERMISSION_MATRIX đầy đủ
│   └── logAudit.js             ✅
│
├── utils/
│   ├── firestore.js            ✅ db, paths, queryAll, serverTimestamp
│   ├── crypto.js               ✅ hashPassword, generateToken, generateSalt
│   ├── manifest.js             ✅ buildManifest, rebuildManifest, filterManifestForUser
│   ├── response.js             ✅ successResponse, errorResponse, asyncHandler
│   └── constants.js            ✅ ROLES, NHANH, ACTIONS, SUBMISSION_STATUS, ERROR_CODES, PERMISSION_MATRIX
│
└── tests/
    ├── seed_test_data.js
    ├── test_dashboard.js
    ├── test_indicators.js
    ├── test_push_data.js
    ├── test_requests.js
    ├── test_sync.js
    └── test_verify.js
```

### Manifest Logic (utils/manifest.js) — Key Details

**buildManifest()** — filter theo role:
- CB_THON: requests của thôn mình + `has_submitted` flag. Read: manifest + submissions (2 reads)
- CB_CM: requests thuộc linh_vuc của mình + `pending_verifications[]` (submissions chờ duyệt). Read: manifest + submissions (2 reads)
- LANH_DAO/ADMIN: tất cả requests. Read: manifest (1 read)

> ⚠️ **Cần kiểm tra**: File `manifest.js` trong zip hiện tại chỉ có `pending_verifications` cho `CB_CHUYEN_MON`. Context3.md nói đã thêm cho `LANH_DAO` nhưng code trong zip chưa phản ánh. Cần verify file thực tế trên server (có thể deploy đã include bản mới hơn zip).

**rebuildManifest()** — BUG-B1 đã fix:
- Normalize `chi_so_ids` và `danh_sach_thon` từ string thành array qua `_toArray()`
- Được gọi sau mỗi create/approve indicator, create request

### Submission Status Flow

```
PENDING_VERIFY → IN_REVIEW (CB_CM đang xem, save progress)
              → VERIFIED   (confirmed all)
              → NEEDS_REVISION (CB_THON phải sửa lại)
NEEDS_REVISION → PENDING_VERIFY (sau khi CB_THON resubmit)
```

### Roles & NHANH

```
ROLES:  ADMIN | LANH_DAO | CB_CHUYEN_MON | CB_THON
NHANH:  UBND  | MTTQ     | DANG
```

LANH_DAO/CB_CM chỉ tạo request/indicator cho nhánh của mình (scope check theo nhanh).

---

## 4. APP — TRẠNG THÁI HIỆN TẠI

### Tech Stack
- React Native + Expo SDK 52 (confirmed từ package.json)
- Expo Router (file-based routing)
- Zustand (state management — `store/authStore`)
- React Native Paper (UI components)
- `@react-native-community/netinfo` (native — lý do phải EAS build)
- `@expo/vector-icons` (Ionicons)

### Project Structure (App)

```
F:\Developers\CARE\CommuneGovernance\app\
├── app/
│   ├── _layout.jsx             ✅ Root layout, AuthGuard, role-based redirect
│   ├── (auth)/
│   │   ├── _layout.jsx         ✅
│   │   └── login.jsx           ✅ BUG-A1+A2 fixed: 2 fields only, lưu ho_ten
│   ├── (cb-thon)/
│   │   ├── _layout.jsx         ✅
│   │   ├── index.jsx           ✅ Danh sách yêu cầu, offline banner
│   │   └── submit/[reqId].jsx  ✅ Nhập số liệu, offline queue
│   ├── (cb-cm)/
│   │   ├── _layout.jsx         ✅
│   │   ├── index.jsx           ✅ Danh sách pending_verifications + filter
│   │   └── verify/[subId].jsx  ⚠️ BUG: indicatorMap dùng ind.id thay vì ind.chi_so_id
│   └── (lanh-dao)/
│       ├── _layout.jsx         ⬜ Cần thêm Stack.Screen verify/[subId]
│       ├── index.jsx           ⬜ Cần rewrite: thêm Section "Cần xử lý" + pending_verifications
│       └── verify/[subId].jsx  ⬜ CHƯA TẠO — FEAT-2
│
├── store/
│   └── authStore.js            ✅ Zustand: token, user, xa_code, year, manifest, offlineQueue
│
├── services/
│   └── api.js                  ✅ login, logout, pullManifest, pushData, verifyData, getDashboard, ...
│
├── constants/
│   ├── theme.js                ✅ COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET
│   └── config.js               ✅ ROLES, CURRENT_YEAR, API_BASE_URL
│
├── components/
│   ├── StatusBadge.jsx         ✅
│   ├── LoadingOverlay.jsx      ✅
│   └── OfflineBanner.jsx       ✅
│
├── app.json                    ✅ scheme: communegovernance, pkg: org.care.communegovernance
└── eas.json                    ✅ preview: APK internal; production: AAB
```

### Auth Flow (Root Layout)

```
App start → hydrate() từ AsyncStorage/SecureStore
         → isLoading=true → splash screen
         → isLoading=false:
           - isLoggedIn=false → /(auth)/login
           - isLoggedIn=true  → /(cb-thon)/ | /(cb-cm)/ | /(lanh-dao)/
```

### Màn hình hoàn thiện ✅

| Screen | Route | Status |
|---|---|---|
| Login | /(auth)/login | ✅ |
| CB_THON Dashboard | /(cb-thon)/ | ✅ |
| CB_THON Submit | /(cb-thon)/submit/[reqId] | ✅ |
| CB_CM Dashboard | /(cb-cm)/ | ✅ |
| CB_CM Verify | /(cb-cm)/verify/[subId] | ⚠️ Bug nhỏ |
| LANH_DAO Dashboard | /(lanh-dao)/ | ⚠️ Cần rewrite |

### Màn hình cần xây dựng (ưu tiên theo lớp)

#### Lớp 1 — Nghiệp vụ còn thiếu
| Screen | Route | FEAT | Priority |
|---|---|---|---|
| LANH_DAO Verify | /(lanh-dao)/verify/[subId] | FEAT-2 | 🔴 Cao |
| CB_CM Tạo yêu cầu | /(cb-cm)/create-request | FEAT-1 | 🔴 Cao |
| LANH_DAO Duyệt chỉ số | /(lanh-dao)/indicators | — | 🟡 Trung |
| CB_CM Tạo chỉ số | /(cb-cm)/create-indicator | — | 🟡 Trung |

#### Lớp 2 — Trình bày dữ liệu
| Screen | Route | Priority |
|---|---|---|
| Báo cáo tabular | /reports/table | 🟡 Trung |
| Biểu đồ thời gian | /reports/chart/[chiSoId] | 🟢 Sau |

#### Lớp 4 — Profile
| Screen | Route | FEAT | Priority |
|---|---|---|---|
| Profile / Settings | /profile | FEAT-3 | 🟡 Trung |
| Đổi mật khẩu | /profile/change-password | — | 🟢 Sau |

#### Lớp 5 — Admin
| Screen | Route | FEAT | Priority |
|---|---|---|---|
| Tạo user | /admin/create-user | FEAT-4 | 🟢 Sau |
| Quản lý users | /admin/users | — | 🟢 Sau |

#### Lớp 3 — Tiện ích (để sau cùng)
| Screen | Route | Priority |
|---|---|---|
| Báo cáo sự cố | /incidents/report | ⚪ Cuối |
| Bản đồ sự cố | /incidents/map | ⚪ Cuối |

---

## 5. BUGS CÒN TỒN ĐỌNG

### Backend

| ID | File | Mô tả | Status |
|---|---|---|---|
| BUG-B3 | handlers/requests.js | Thiếu field `dinh_ky` (THANG/QUY/ADHOC) trong createRequest | ⬜ Chưa fix |
| BUG-B4 | utils/manifest.js | LANH_DAO chưa nhận `pending_verifications[]` (zip hiện tại chưa có) | ⚠️ Cần verify |

> **BUG-B3 rule**: Không tạo request định kỳ cho năm quá khứ. `dinh_ky` cần thêm vào createRequest validation + manifest response.

### App

| ID | File | Mô tả | Status |
|---|---|---|---|
| BUG-A3 | (cb-cm)/verify/[subId].jsx | `indicatorMap` dùng `ind.id` thay vì `ind.chi_so_id` → tên chỉ số hiện undefined | ⬜ Chưa fix |
| BUG-A4 | (lanh-dao)/index.jsx | Cần rewrite: thêm section "Cần xử lý" với pending_verifications | ⬜ Cần làm |
| BUG-A5 | (lanh-dao)/_layout.jsx | Cần thêm Stack.Screen `verify/[subId]` | ⬜ Cần làm |
| BUG-A6 | (lanh-dao)/verify/[subId].jsx | File chưa tồn tại (FEAT-2) | ⬜ Cần tạo |

> **BUG-A3 fix**: Line 45 trong `(cb-cm)/verify/[subId].jsx`:
> ```js
> // Sai:
> (manifest?.indicators || []).forEach(ind => { map[ind.id] = ind; });
> // Đúng:
> (manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
> ```

---

## 6. FEATURES ROADMAP

### FEAT-1: CB_CM Tạo yêu cầu số liệu (App UI)
- Backend `createRequest` đã có ✅
- App cần: form chọn bộ chỉ số (filter theo linh_vuc của CB_CM), chọn định kỳ, chọn danh_sach_thon
- Khi nhánh=UBND → gửi đến CB_THON thuộc UBND; nhánh=MTTQ → CB_THON thuộc MTTQ
- Cần thêm `dinh_ky` vào backend trước (BUG-B3)

### FEAT-2: LANH_DAO Verify trực tiếp (Bypass)
- Backend: đã hỗ trợ — PERMISSION_MATRIX cho phép LANH_DAO verify_data ✅
- Backend: `pending_verifications` cho LANH_DAO cần thêm vào manifest.js (BUG-B4)
- App: cần tạo `(lanh-dao)/verify/[subId].jsx` — UI đơn giản hơn CB_CM (batch mode only: Xác nhận / Yêu cầu sửa)
- App: rewrite `(lanh-dao)/index.jsx` — thêm SectionList với section "Cần xử lý"
- Không có warning popup về bypass (chỉ log backend)

### FEAT-3: Settings / Chọn năm báo cáo
- Mặc định năm hiện tại từ `manifest.config.current_year`
- Cho phép xem lại năm cũ (read-only, không tạo request mới)
- LANH_DAO/ADMIN có thể config định kỳ mặc định cho xã
- Nằm ở **Lớp 4 — Profile/Settings**

### FEAT-4: Admin tạo user
- Cần endpoint mới: `POST /create_user`
- Body: `{ vai_tro, nhanh, don_vi, linh_vuc_codes, ho_ten, xa_code }`
- Generate password tạm, user đổi lần đầu login
- Nằm ở **Lớp 5 — Admin**

### FEAT-5: Voice Transcription (Azure Speech) — để sau cùng
- Architecture: Token endpoint
  - `POST /speech_token` → Azure auth token (10 min)
  - Client dùng Azure SDK trực tiếp (mic → text on device)
- Env vars: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION=southeastasia`
- Files cần tạo: `handlers/transcribe.js`

### FEAT-6: Lớp 2 — Báo cáo & Biểu đồ (Presentation)
- Tabular: dữ liệu đã VERIFIED, lọc theo req_id / năm / thôn
- Chart: trend theo thời gian cho chỉ số dạng số (kieu_du_lieu = "so")
- Backend: có thể dùng `GET /dashboard` + query theo chi_so_id

### FEAT-7: Lớp 3 — Tiện ích sự cố (Để sau cùng)
- Báo cáo sự cố với geotag (GPS)
- Cần endpoint mới: `POST /report_incident`
- Cần Firestore collection mới: `communes/{xa_code}/incidents/{incident_id}`
- Map rendering: có thể dùng MapView (cần native module → EAS build)

---

## 7. THỨ TỰ THỰC HIỆN (Recommended)

```
Giai đoạn 1 — Hoàn thiện nghiệp vụ core (Lớp 1)
  1. Fix BUG-A3: CB_CM verify — ind.id → ind.chi_so_id
  2. Fix BUG-B3 (backend): thêm dinh_ky vào createRequest
  3. Fix BUG-B4 (backend): LANH_DAO pending_verifications trong manifest.js
  4. FEAT-2 (app): tạo (lanh-dao)/verify/[subId].jsx + rewrite index.jsx + layout
  5. FEAT-1 (app): CB_CM tạo yêu cầu — UI form
  6. Build + test EAS APK → test với 3 test users

Giai đoạn 2 — Lớp 4 Profile
  7. FEAT-3: Profile/Settings + chọn năm báo cáo

Giai đoạn 3 — Lớp 5 Admin
  8. FEAT-4 backend: POST /create_user
  9. FEAT-4 app: Admin screen tạo user

Giai đoạn 4 — Lớp 2 Presentation
  10. FEAT-6: màn hình báo cáo tabular
  11. FEAT-6: biểu đồ time-series

Giai đoạn 5 — Tính năng nâng cao (để sau)
  12. FEAT-5: Voice Azure Speech
  13. FEAT-7: Lớp 3 sự cố + geotag
```

---

## 8. FIRESTORE SCHEMA (tóm tắt)

```
users/{user_id}
  user_id, xa_code, ho_ten, vai_tro, don_vi, nhanh,
  linh_vuc_codes[], password_hash, password_salt,
  session_token, token_expires_at, status, last_login_at

communes/{xa_code}/indicators/{chi_so_id}
  chi_so_id, ten_chi_so, mo_ta, don_vi_do, kieu_du_lieu,
  linh_vuc, validation{}, status(DRAFT/PENDING/ACTIVE/ARCHIVED),
  created_by, approved_by, year

communes/{xa_code}/requests/{req_id}
  req_id, tieu_de, tao_boi, danh_sach_thon[], chi_so_ids[],
  deadline, dinh_ky(THANG/QUY/ADHOC), ghi_chu,
  status(OPEN/IN_PROGRESS/COMPLETED/CANCELLED), year

communes/{xa_code}/submissions/{submission_id}
  submission_id, req_id, thon_code, submitted_by,
  submitted_at, device_collected_at, values{},
  anh_urls[], status, verified_by, verified_at,
  indicator_reviews{}, rejection_reason, year

communes/{xa_code}/manifests/current
  Pre-computed, rebuilt on every indicator/request change

xa_registry/{xa_code}
  xa_code, xa_name, tinh, sheets_id, drive_folder_id, status

audit_logs/{auto-id}
  user_id, xa_code, action, timestamp, detail{}, ip
```

---

## 9. MANIFEST RESPONSE STRUCTURE (confirmed từ API)

### CB_THON
```json
{
  "manifest_version": "v...",
  "user": { "user_id", "ho_ten", "vai_tro", "don_vi", "nhanh", "xa_code", "xa_name" },
  "indicators": [{ "chi_so_id", "ten_chi_so", "don_vi_do", "linh_vuc", "kieu_du_lieu" }],
  "requests": [
    {
      "req_id", "tieu_de", "deadline",
      "chi_so_ids": ["CS001"],      ← array ✅ (BUG-B1 fixed)
      "danh_sach_thon": ["THON01"], ← array ✅
      "has_submitted": true,
      "tao_boi": "USR_LANHDAO"
    }
  ],
  "config": { "current_year": 2025, "drive_folder_id": null }
}
```

### CB_CM
```json
{
  "user": { "vai_tro": "CB_CHUYEN_MON", ... },
  "requests": [...],  ← requests thuộc linh_vuc của mình
  "pending_verifications": [
    {
      "submission_id", "req_id", "thon_code", "status",
      "submitted_by", "submitted_at", "values": {},
      "tieu_de", "deadline"
    }
  ]
}
```

### LANH_DAO (sau khi fix BUG-B4)
```json
{
  "user": { "vai_tro": "LANH_DAO", ... },
  "requests": [...],  ← tất cả requests
  "pending_verifications": [...]  ← TẤT CẢ submissions (không lọc linh_vuc)
}
```

---

## 10. WORKFLOW DEPLOY

```powershell
# ── Backend ──────────────────────────────────────────────────
cd F:\Developers\CARE\CommuneGovernance
npx firebase use communegovernance --account ngocdd@thiennhienviet.org.vn
npx firebase deploy --only functions

# ── App Build ─────────────────────────────────────────────────
cd F:\Developers\CARE\CommuneGovernance\app
$env:PATH += ";C:\Users\Administrator\AppData\Roaming\npm"
eas build --platform android --profile preview

# ── Test Login ────────────────────────────────────────────────
Invoke-RestMethod `
  -Uri "https://careapi-cx7avsd4pa-as.a.run.app/login" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"user_id":"USR_LANHDAO","password":"Test@1234"}' `
  | ConvertTo-Json -Depth 5

# ── Health Check ──────────────────────────────────────────────
Invoke-RestMethod -Uri "https://careapi-cx7avsd4pa-as.a.run.app/health"
```

---

## 11. PRINCIPLES & CONSTRAINTS (bất biến)

```
OFFLINE-FIRST:  1 read (pull) + 1 write (push) mỗi session. Không call khác khi nhập liệu.
ZERO VM:        Serverless hoàn toàn. Cloud Functions + Firestore + Cloud Run.
SHEETS OUTPUT:  Google Sheets chỉ để CARE staff đọc — không phải database.
SCALE:          4 → 500 xã chỉ thêm data, không đổi code/architecture.

R1: CHỈ LANH_DAO được approve indicator (PENDING → ACTIVE)
R2: CHỈ CB_THON được push_data
R3: CB_CM chỉ tạo/verify indicators thuộc linh_vuc_codes của mình
R4: CB_THON KHÔNG BAO GIỜ thấy data thôn khác
R5: push_data verify user.don_vi ∈ request.danh_sach_thon (anti-forge)
R6: Manifest filter server-side — không tin client
R7: (req_id, thon_code) chỉ submit 1 lần — check duplicate trước write
```

---

*Context V3 — CommuneGovernance CARE Vietnam*
*Updated: 27/05/2026*
*By: Claude Sonnet (working with @paulsteigel)*