# CommuneGovernance — CARE Vietnam
## Full Context Document — V3.1 (27/05/2026)

---

## 1. HẠ TẦNG & CÔNG NGHỆ

| Item | Value |
|---|---|
| API Live | https://careapi-cx7avsd4pa-as.a.run.app |
| Firebase Project | `communegovernance` — account `ngocdd@thiennhienviet.org.vn` |
| Backend Local | `F:\Developers\CARE\CommuneGovernance\` |
| App Local | `F:\Developers\CARE\CommuneGovernance\app\` |
| Backend Runtime | Node 24, Firebase Functions v2, Cloud Run `asia-southeast1` |
| App Stack | Expo SDK **52** (confirmed từ package.json `"expo": "~52.0.0"`) |
| EAS Project | `@paulsteigel/commune-governance` |

> ⚠️ Context cũ ghi "Expo SDK 56" là sai — thực tế là SDK 52.

### Build Commands

```powershell
# ── LOCAL DEBUG BUILD (nhanh, dùng khi dev) ─────────────────
# Chạy từ thư mục android/
cd F:\Developers\CARE\CommuneGovernance\app\android
.\gradlew.bat assembleDebug
# APK output: app\android\app\build\outputs\apk\debug\app-debug.apk

# ── EAS CLOUD BUILD (preview APK, dùng trước release) ────────
cd F:\Developers\CARE\CommuneGovernance\app
$env:PATH += ";C:\Users\Administrator\AppData\Roaming\npm"
eas build --platform android --profile preview

# ── BACKEND DEPLOY ────────────────────────────────────────────
cd F:\Developers\CARE\CommuneGovernance
npx firebase use communegovernance --account ngocdd@thiennhienviet.org.vn
npx firebase deploy --only functions

# ── TEST LOGIN (PowerShell) ───────────────────────────────────
Invoke-RestMethod `
  -Uri "https://careapi-cx7avsd4pa-as.a.run.app/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"user_id":"USR_LANHDAO","password":"Test@1234"}' `
  | ConvertTo-Json -Depth 5
```

**Khi nào dùng cái nào:**
- `.\gradlew.bat assembleDebug` → iteration nhanh khi dev, không cần queue cloud
- `eas build --profile preview` → trước khi gửi tester, APK không có dev overhead
- `eas build --profile production` → phát hành chính thức (AAB)

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

## 2. ĐÁNH GIÁ KIẾN TRÚC TỔNG THỂ

### 2.1 Những gì đang làm đúng ✅

**Offline-first manifest pattern** là lựa chọn xuất sắc cho bối cảnh nông thôn Việt Nam. Toàn bộ data cần cho một session được pull 1 lần khi có mạng, lưu vào store, sau đó user nhập liệu hoàn toàn offline. Đây là điểm mạnh nhất của kiến trúc.

**Pre-computed manifest document** (`communes/{xa}/manifests/current`) tiết kiệm 2-3 Firestore reads mỗi lần login. Thay vì đọc 3 collections (indicators + requests + submissions), chỉ đọc 1 document đã assembled sẵn. Rất thông minh về quota.

**Server-side role filtering** đúng chỗ — không bao giờ tin client tự filter. CB_THON chỉ nhận requests của thôn mình, không bao giờ thấy data thôn khác.

**Serverless hoàn toàn** (Cloud Run + Firestore) — zero ops, zero VM maintenance, scale tự động.

**Zustand** là đúng lựa chọn: nhẹ hơn Redux 10x, đủ dùng cho app 1 user/device.

### 2.2 Vấn đề cần cải thiện

**BUG CRASH quan trọng** — xem mục 4 chi tiết. Nguyên nhân: Firestore Timestamp objects không được convert sang ISO string trước khi trả về JSON.

**Navigation architecture** — Kiến trúc routing hiện tại (flat group theo role) phù hợp cho giai đoạn 1 nhưng cần evolve khi xây Lớp 2-5:

```
Hiện tại (flat Stack):         Cần chuyển sang (Tab + Stack):
/(auth)/                       /(auth)/
/(cb-thon)/                    /(app)/(tabs)/
/(cb-cm)/              →         business/  ← role-specific screens
/(lanh-dao)/                     reports/   ← Lớp 2
                                 profile/   ← Lớp 4
                                 admin/     ← Lớp 5 (conditional)
```

**Refactor này nên làm TRƯỚC khi xây Lớp 2-5** để tránh đập đi làm lại navigation.

**State management** — `authStore` hiện đang chứa cả auth (token, user) lẫn data (manifest, xa_code, year). Khi features nhiều hơn nên tách ra `authStore` + `appStore` (manifest, settings).

### 2.3 Kiến trúc 5 lớp — Đánh giá

Mô hình 5 lớp cụ đề xuất là **đúng về mặt UX** và phản ánh đúng mental model của người dùng. Tuy nhiên cần làm rõ một điều quan trọng:

> **5 lớp là cách tổ chức UX/navigation, KHÔNG phải cách tổ chức code backend.** Backend vẫn giữ nguyên structure handler-based hiện tại. Thay đổi chỉ ở phía app navigation.

Mapping cụ thể từ lớp → Expo Router:

| Lớp | Tên | Tab Icon | Roles thấy | Route prefix |
|---|---|---|---|---|
| 1 | Nghiệp vụ | briefcase | Tất cả (content khác nhau) | /business/ |
| 2 | Báo cáo | bar-chart | Tất cả (scope khác nhau) | /reports/ |
| 3 | Tiện ích | map | Tất cả | /incidents/ |
| 4 | Hồ sơ | person | Tất cả | /profile/ |
| 5 | Quản trị | settings | ADMIN + LANH_DAO | /admin/ |

---

## 3. BACKEND — TRẠNG THÁI

### Deployment
- **Deployed & Live** ✅ — https://careapi-cx7avsd4pa-as.a.run.app

### Endpoints hiện có

| Endpoint | Handler | Tests | Status |
|---|---|---|---|
| POST /login | auth.login | ✅ | Live |
| POST /logout | auth.logout | ✅ | Live |
| POST /pull_manifest | auth.pullManifest | ✅ | Live |
| POST /push_data | data.pushData | 19/19 ✅ | Live |
| POST /resubmit_data | verify.resubmitData | ✅ | Live |
| POST /create_indicator | indicators.createIndicator | 23/23 ✅ | Live |
| POST /approve_indicator | indicators.approveIndicator | 23/23 ✅ | Live |
| POST /create_request | requests.createRequest | 25/25 ✅ | Live |
| POST /verify_data | verify.verifyData | 34/34 ✅ | Live |
| GET /dashboard | dashboard.getDashboard | ✅ | Live |
| POST /sync_to_sheets | sync.syncToSheets | 15/15 ✅ | Live |
| GET /health | inline | — | Live |

### Endpoints cần thêm

| Endpoint | Handler | FEAT | Priority |
|---|---|---|---|
| POST /create_user | handlers/users.js (mới) | FEAT-4 | 🟡 |
| POST /speech_token | handlers/transcribe.js | FEAT-5 | 🟢 |
| POST /report_incident | handlers/incidents.js | Lớp 3 | 🟢 |

### Project Structure (Backend)

```
F:\Developers\CARE\CommuneGovernance\
├── index.js                    ✅
├── handlers/
│   ├── auth.js                 ✅ login/logout/pullManifest
│   ├── data.js                 ✅ pushData
│   ├── indicators.js           ✅ createIndicator, approveIndicator
│   ├── requests.js             ✅ createRequest
│   ├── verify.js               ✅ verifyData (batch+per_indicator), resubmitData
│   ├── dashboard.js            ✅ getDashboard
│   └── sync.js                 ✅ syncToSheets
├── middleware/
│   ├── validateToken.js        ✅
│   ├── checkPermission.js      ✅
│   └── logAudit.js             ✅
└── utils/
    ├── firestore.js            ✅
    ├── crypto.js               ✅
    ├── manifest.js             ⚠️ BUG-B5: Timestamp không convert sang ISO string
    ├── response.js             ✅
    └── constants.js            ✅ ROLES, NHANH, SUBMISSION_STATUS, ERROR_CODES, PERMISSION_MATRIX
```

### Submission Status Flow

```
PENDING_VERIFY → IN_REVIEW     (CB_CM/LANH_DAO đang xem, save progress)
              → VERIFIED        (confirmed all)
              → NEEDS_REVISION  (CB_THON phải sửa lại)
NEEDS_REVISION → PENDING_VERIFY (sau khi CB_THON resubmit)
```

---

## 4. BUGS — ĐẦY ĐỦ VÀ PHÂN TÍCH

### 🔴 BUG-B5 (CRASH) — Firestore Timestamp không được convert sang ISO string

**File**: `utils/manifest.js`, line ~200  
**Mô tả**: `queryAll()` trả về Firestore documents với các Timestamp fields nguyên dạng (`admin.firestore.Timestamp` object). Khi đi qua `JSON.stringify` (trong `res.json()`), chúng serialize thành `{ "_seconds": N, "_nanoseconds": N }` — không phải ISO string.

**Tại sao crash**: Trong `(cb-cm)/index.jsx` line 84:
```js
// item.submitted_at = { _seconds: 1748390400, _nanoseconds: 0 }
item.submitted_at?.slice(0, 10)   // ❌ CRASH: .slice is not a function
// Ghi chú: ?. chỉ guard null/undefined, không guard wrong type
// Object {} là truthy nên ?. không short-circuit → gọi .slice trên object → crash
```

**Proof**:
```js
const ts = { _seconds: 1748390400, _nanoseconds: 0 };
ts?.slice(0, 10)   // → TypeError: ts?.slice is not a function ✓ confirmed
ts?.slice?.(0, 10) // → undefined (safe, nếu dùng form này)
```

**Ảnh hưởng**:
- CB_CM login → manifest có `pending_verifications[]` với `submitted_at` là Timestamp object
- `(cb-cm)/index.jsx` render FlatList → gọi `.slice(0, 10)` → crash ngay khi login
- CB_THON và LANH_DAO không crash vì screens của họ không access `submitted_at` theo cách này

**Fix backend** (đúng chỗ — `utils/manifest.js`):
```js
// Thêm helper ở cuối file:
function _toIso(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  return null;
}

// Trong pending_verifications map:
return {
  submission_id: s.submission_id || s.id,
  req_id:        s.req_id,
  thon_code:     s.thon_code,
  status:        s.status,
  submitted_by:  s.submitted_by,
  submitted_at:  _toIso(s.submitted_at),   // ← FIX: convert to ISO string
  values:        s.values || {},
  tieu_de:       req?.tieu_de || s.req_id,
  deadline:      req?.deadline || null,
};
```

**Fix frontend** (safety net — thêm vào `constants/theme.js` hoặc `utils/dateHelper.js`):
```js
// App-side safety: handle cả string lẫn Timestamp object
export function toDateStr(val) {
  if (!val) return null;
  if (typeof val === "string") return val.slice(0, 10);
  if (val._seconds !== undefined)
    return new Date(val._seconds * 1000).toISOString().slice(0, 10);
  return null;
}
// Dùng: {toDateStr(item.submitted_at) || "—"}
```

> **Lưu ý**: Cần apply `_toIso()` cho TẤT CẢ Timestamp fields bất kỳ nơi nào trả về cho client: `submitted_at`, `verified_at`, `created_at`, `deadline` (nếu lưu là Timestamp), `device_collected_at`.

---

### 🟡 BUG-A3 — CB_CM verify: indicatorMap dùng ind.id thay vì ind.chi_so_id

**File**: `(cb-cm)/verify/[subId].jsx`, line 45  
**Fix**:
```js
// Sai:
(manifest?.indicators || []).forEach(ind => { map[ind.id] = ind; });
// Đúng:
(manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
```
**Ảnh hưởng**: Tên chỉ tiêu hiện `undefined` trong verify screen. Không crash, chỉ xấu.

---

### 🟡 BUG-B4 — LANH_DAO không nhận pending_verifications

**File**: `utils/manifest.js`  
**Mô tả**: Hiện tại chỉ có CB_CM nhận `pending_verifications[]`. LANH_DAO cần nhận toàn bộ (không lọc linh_vuc) để có thể bypass.  
**Fix**: Thêm block tương tự sau block CB_CM, không filter theo linh_vuc.

---

### 🟡 BUG-B3 — Thiếu field dinh_ky trong Request

**File**: `handlers/requests.js`, `utils/manifest.js`  
**Mô tả**: Request cần có `dinh_ky: "THANG" | "QUY" | "ADHOC"`. Cần validate + save trong createRequest, trả về trong manifest.  
**Rule**: Không tạo request định kỳ cho năm quá khứ.

---

### 🔵 BUG-A4, A5, A6 — LANH_DAO verify screens chưa tồn tại

| ID | File | Việc cần làm |
|---|---|---|
| BUG-A4 | `(lanh-dao)/index.jsx` | Rewrite: thêm SectionList với section "Cần xử lý" (pending_verifications) |
| BUG-A5 | `(lanh-dao)/_layout.jsx` | Thêm `Stack.Screen name="verify/[subId]"` |
| BUG-A6 | `(lanh-dao)/verify/[subId].jsx` | Tạo mới — batch mode only (đơn giản hơn CB_CM) |

---

## 5. APP — TRẠNG THÁI

### Màn hình hiện có

| Screen | Route | Trạng thái |
|---|---|---|
| Login | /(auth)/login | ✅ |
| CB_THON Dashboard | /(cb-thon)/ | ✅ |
| CB_THON Submit | /(cb-thon)/submit/[reqId] | ✅ |
| CB_CM Dashboard | /(cb-cm)/ | 🔴 Crash khi login (BUG-B5) |
| CB_CM Verify | /(cb-cm)/verify/[subId] | ⚠️ Bug A3 (indicator name undefined) |
| LANH_DAO Dashboard | /(lanh-dao)/ | ⚠️ Cần rewrite (BUG-A4) |

### Project Structure (App)

```
F:\Developers\CARE\CommuneGovernance\app\
├── app/
│   ├── _layout.jsx             ✅ Root + AuthGuard + role redirect
│   ├── (auth)/login.jsx        ✅ 2-field form, lấy xa_code/year từ manifest
│   ├── (cb-thon)/
│   │   ├── index.jsx           ✅
│   │   └── submit/[reqId].jsx  ✅
│   ├── (cb-cm)/
│   │   ├── index.jsx           🔴 Crash (BUG-B5)
│   │   └── verify/[subId].jsx  ⚠️ Bug A3
│   └── (lanh-dao)/
│       ├── index.jsx           ⚠️ Cần rewrite (BUG-A4)
│       └── verify/[subId].jsx  ⬜ Chưa tồn tại (BUG-A6)
│
├── store/authStore.js          ✅ Zustand: token, user, xa_code, year, manifest
├── services/api.js             ✅ login, pullManifest, pushData, verifyData, getDashboard
├── constants/theme.js          ✅ COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW
├── constants/config.js         ✅ ROLES, CURRENT_YEAR, API_BASE_URL
└── components/
    ├── StatusBadge.jsx         ✅
    ├── LoadingOverlay.jsx      ✅
    └── OfflineBanner.jsx       ✅
```

---

## 6. KIẾN TRÚC 5 LỚP — KẾ HOẠCH THỰC HIỆN

### Lớp 1 — Nghiệp vụ (Business)

**LANH_DAO:**
- ✅ Dashboard tiến độ nộp số liệu
- ⬜ Xác minh bypass (FEAT-2) — cần BUG-B4 + BUG-A4/A5/A6
- ⬜ Nhắc nhở CB_CM/CB_THON (FEAT-nhắc)
- ⬜ Duyệt bộ chỉ số PENDING → ACTIVE

**CB_CHUYEN_MON:**
- ✅ Xem + xét duyệt submissions
- ⬜ Tạo yêu cầu thu thập thông tin (FEAT-1) — cần BUG-B3 trước
- ⬜ Tạo + trình bộ chỉ số

**CB_THON:**
- ✅ Xem yêu cầu, nộp số liệu, offline queue
- ✅ Sửa và nộp lại (resubmit_data)

### Lớp 2 — Trình bày dữ liệu (Presentation)

- **Tabular**: số liệu VERIFIED, lọc theo req/năm/thôn, theo role scope
- **Chart**: trend time-series cho chỉ số dạng `so` (kieu_du_lieu = "so")
- Backend: `GET /dashboard` có thể extend, hoặc endpoint mới `GET /report_data`
- ⬜ Chưa xây dựng

### Lớp 3 — Tiện ích sự cố *(Để sau cùng)*

- Báo cáo: thiên tai, sạt lở, dịch bệnh + GPS geotag
- Cần: `POST /report_incident`, Firestore collection `incidents/`, map rendering
- ⬜ Chưa xây dựng

### Lớp 4 — Hồ sơ người dùng (Profile)

- Thông tin user, đổi mật khẩu
- Chọn năm báo cáo (FEAT-3): mặc định năm hiện tại, xem lại năm cũ read-only
- ⬜ Chưa xây dựng

### Lớp 5 — Quản trị (Admin)

- Tạo/quản lý user (FEAT-4): cần `POST /create_user` backend trước
- Config định kỳ cho xã
- ⬜ Chưa xây dựng

---

## 7. THỨ TỰ THỰC HIỆN (Recommended)

### Giai đoạn 1 — Fix crash & hoàn thiện core (Ưu tiên NGAY)

```
1. BUG-B5 (backend): Thêm _toIso() helper vào manifest.js
   → Convert submitted_at + tất cả Timestamp fields sang ISO string
   → Deploy backend

2. BUG-A3 (app): ind.id → ind.chi_so_id trong (cb-cm)/verify/[subId].jsx
   → Build + test CB_CM login → không crash → verify screen hiện tên đúng

3. BUG-B4 (backend): Thêm pending_verifications cho LANH_DAO trong manifest.js
   → Deploy backend

4. BUG-A4/A5/A6 (app): FEAT-2 — tạo LANH_DAO verify screens
   → (lanh-dao)/index.jsx rewrite
   → (lanh-dao)/_layout.jsx update
   → (lanh-dao)/verify/[subId].jsx tạo mới
   → Build + test LANH_DAO verify

5. BUG-B3 + FEAT-1 (backend+app): dinh_ky + CB_CM tạo yêu cầu
```

### Giai đoạn 2 — Navigation refactor (Trước khi xây Lớp 2+)

```
6. Refactor navigation sang Tab + Stack
   → Thêm bottom tab bar với tabs: Nghiệp vụ / Báo cáo / Hồ sơ (/ Admin nếu role cho phép)
   → Move existing role screens vào tab "Nghiệp vụ"
```

### Giai đoạn 3 — Lớp 2 Presentation

```
7. FEAT-6: Báo cáo tabular (data đã VERIFIED)
8. FEAT-6: Biểu đồ time-series
```

### Giai đoạn 4 — Lớp 4 & 5

```
9.  FEAT-3: Profile + Settings + chọn năm
10. FEAT-4: POST /create_user (backend trước)
11. FEAT-4: Admin create user screen (app)
```

### Giai đoạn 5 — Lớp 3 & Voice *(Để sau cùng)*

```
12. FEAT-5: Voice (Azure Speech)
13. FEAT-7: Incident reporting + geotag
```

---

## 8. FIRESTORE SCHEMA

```
users/{user_id}
  user_id, xa_code, ho_ten, vai_tro, don_vi, nhanh,
  linh_vuc_codes[], password_hash, password_salt,
  session_token, token_expires_at, status, last_login_at

communes/{xa_code}/indicators/{chi_so_id}
  chi_so_id, ten_chi_so, mo_ta, don_vi_do, kieu_du_lieu,
  linh_vuc, validation{}, status(DRAFT→PENDING→ACTIVE→ARCHIVED),
  created_by, approved_by, year

communes/{xa_code}/requests/{req_id}
  req_id, tieu_de, tao_boi, danh_sach_thon[], chi_so_ids[],
  deadline, dinh_ky(THANG/QUY/ADHOC)*, ghi_chu,
  status(OPEN/IN_PROGRESS/COMPLETED/CANCELLED), year
  * dinh_ky: cần thêm (BUG-B3)

communes/{xa_code}/submissions/{submission_id}
  submission_id, req_id, thon_code, submitted_by,
  submitted_at(Timestamp), device_collected_at(Timestamp),
  values{}, anh_urls[],
  status(PENDING_VERIFY/IN_REVIEW/VERIFIED/NEEDS_REVISION/REJECTED),
  verified_by, verified_at, indicator_reviews{},
  rejection_reason, year

communes/{xa_code}/manifests/current
  Pre-computed document, rebuilt on every indicator/request change

xa_registry/{xa_code}
  xa_code, xa_name, tinh, sheets_id, drive_folder_id, status

audit_logs/{auto-id}
  user_id, xa_code, action, timestamp, detail{}, ip
```

---

## 9. MANIFEST RESPONSE (confirmed from API)

### CB_THON
```json
{
  "manifest_version": "v...",
  "user": { "user_id", "ho_ten", "vai_tro", "don_vi", "nhanh", "xa_code", "xa_name" },
  "indicators": [{ "chi_so_id", "ten_chi_so", "don_vi_do", "linh_vuc", "kieu_du_lieu" }],
  "requests": [
    {
      "req_id", "tieu_de", "deadline",
      "chi_so_ids": ["CS001"],        ← array ✅ (BUG-B1 fixed)
      "danh_sach_thon": ["THON01"],   ← array ✅ (BUG-B1 fixed)
      "has_submitted": true,
      "tao_boi": "USR_LANHDAO"
    }
  ],
  "config": { "current_year": 2025, "drive_folder_id": null }
}
```

### CB_CM (sau khi fix BUG-B5)
```json
{
  "user": { "vai_tro": "CB_CHUYEN_MON", ... },
  "requests": [...],
  "pending_verifications": [
    {
      "submission_id", "req_id", "thon_code", "status",
      "submitted_by",
      "submitted_at": "2025-06-15T09:00:00.000Z",  ← ISO string ✅ (sau fix)
      "values": {},
      "tieu_de", "deadline"
    }
  ]
}
```

### LANH_DAO (sau khi fix BUG-B4)
```json
{
  "user": { "vai_tro": "LANH_DAO", ... },
  "requests": [...],
  "pending_verifications": [...]  ← TẤT CẢ submissions, không lọc linh_vuc
}
```

---

## 10. PRINCIPLES & CONSTRAINTS (bất biến)

```
OFFLINE-FIRST:  1 pull khi có mạng → nhập liệu offline → 1 push khi có mạng lại
ZERO VM:        Serverless hoàn toàn. Cloud Functions + Firestore. Zero maintenance.
SHEETS OUTPUT:  Google Sheets chỉ để CARE staff đọc — không phải database.
SCALE:          4 → 500 xã: chỉ thêm data, không đổi code/architecture.

R1: CHỈ LANH_DAO được approve indicator (PENDING → ACTIVE)
R2: CHỈ CB_THON được push_data — bypass không được phép
R3: CB_CM chỉ tạo/verify indicators thuộc linh_vuc_codes của mình
R4: CB_THON KHÔNG BAO GIỜ thấy data thôn khác
R5: push_data verify user.don_vi ∈ request.danh_sach_thon (anti-forge)
R6: Manifest filter server-side — không tin client
R7: (req_id, thon_code) chỉ submit 1 lần — check duplicate trước write
```

---

## 11. HANDLER PATTERN (luôn follow)

```js
async function myHandler(req, res) {
  const user = await validateToken(req);
  const { xa_code, year, ...data } = req.body;

  // 1. Validate input
  if (!xa_code || !year)
    return errorResponse(res, ERROR_CODES.DATA_001, "...");

  // 2. Check permission (TRƯỚC mọi business logic)
  checkPermission(user, ACTIONS.MY_ACTION, { nhanh: user.nhanh });

  // 3. Business logic...
  
  // 4. Audit log (sau mọi write)
  await logAudit(user, ACTIONS.MY_ACTION, { ... }, req);

  return successResponse(res, { ... });
}
```

---

*Context V3.1 — CommuneGovernance CARE Vietnam*
*Updated: 27/05/2026*