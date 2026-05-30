# CommuneGovernance — Dev Context V3.4
> Paste toàn bộ file này vào đầu session mới.
> V3.4: Cập nhật sau session bug-fix + request-create + design workflow.

---

## 1. Tổng quan dự án

App hỗ trợ luông điều hành của cấp xã, thôn, thu thập số liệu phục vụ cho công tác điều hành tại cơ sở, một dự án của CARE Internaional in Vietnam  tại địa ban tỉnh Quảng Trị (mới sau khi sáp nhập Quảng Trị cũ và Quảng Bình).
**Pro-bono** — ưu tiên chi phí Firestore thấp nhất, luôn giữ trong free tier (50K reads/day).

Phương án tiếp cận để giảm tối đã read/write nhe sau
Cloud Run: backend api
+
Firestore: lưu trữ dữ liệu dạng text
+
Drive: lưu trữ dữ liệu dạng ảnh, trả về file id fho FireStore lưu 

Như vậy, logic quyền truy cập sẽ như sau
1.1 Login >> 
1.2 backend xác định quyền .> tạo manifest (dữ liệu cho user này)
1.3 trả về link googledrive của ảnh của nội dung được quyền view/edit và app sẽ render ảnh nếu cần/nếu có thông qua file_id của object


| Item | Value |
|---|---|
| **API Live** | https://careapi-cx7avsd4pa-as.a.run.app |
| **Backend path** | `F:\Developers\CARE\CommuneGovernance\` |
| **App path** | `F:\Developers\CARE\CommuneGovernance\app\` |
| **Firebase project** | `communegovernance` |
| **Firebase account** | ngocdd@thiennhienviet.org.vn |
| **Figma account** | ngocdd@sfdp.net | >> hiện tại đang không đi theo hướng sử dụng figma nữa vì bản free quá giới hạn
| **Cloud Run region** | asia-southeast1 |
| **Runtime** | Node 24, Firebase Functions v2, **Expo SDK 56** (expo-router ~56.2.7, react-native 0.85.3, react ^19.2.3) |
| **Build output** | `app\android\app\build\outputs\apk\release\app-release.apk` |

> ⚠️ **Chú ý SDK version**: Root `package.json` dùng **Expo SDK 56** (không phải SDK 52).
> File `app/package.json` bên trong Expo Router directory là file cũ/orphaned — **không dùng**.

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

### 3.2 App (Expo Router ~56.x / SDK 56)

```
app/                         ← Expo Router directory
  _layout.jsx                ← root layout, auth redirect
  (auth)/
    login.jsx
  (cb-thon)/
    _layout.jsx              ← Tabs: Yêu cầu | Số liệu
    index.jsx                ← danh sách request + submission status
    report.jsx               ← số liệu thôn mình
    submit/[reqId].jsx       ← nộp / xem lại / resubmit
  (cb-cm)/
    _layout.jsx              ← Tabs: Nghiệp vụ | Chỉ số | Số liệu
    index.jsx                ← danh sách submission cần xét duyệt + FAB tạo request
    verify/[subId].jsx       ← xét duyệt submission
    indicators.jsx           ← quản lý chỉ số của mình
    indicator-create.jsx     ← tạo / chỉnh sửa chỉ số
    request-create.jsx       ← [MỚI v3.4] tạo yêu cầu thu thập
    report.jsx               ← số liệu theo lĩnh vực mình
  (lanh-dao)/
    _layout.jsx              ← Tabs: Nghiệp vụ | Chỉ số | Số liệu
    index.jsx                ← bypass queue + tiến độ
    verify/[subId].jsx       ← xác nhận bypass
    indicators.jsx           ← duyệt / từ chối PENDING indicators
    report.jsx               ← số liệu toàn xã
services/
  api.js                     ← tất cả API calls (13 functions)
store/
  authStore.js               ← Zustand: user, manifest, token, xa_code, year
constants/
  theme.js                   ← COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET
  config.js                  ← API_BASE_URL, API_TIMEOUT
components/
  LoadingOverlay.jsx
  OfflineBanner.jsx
  StatusBadge.jsx
```

> ⚠️ **Không có file nào trong `app/app/`** (bên trong Expo Router directory):
> - `app/app/services/api.js` — đã xóa (file thừa gây build crash)
> - `app/app/constants/config.js` — đã xóa (file rỗng, sai vị trí)

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
| POST | /submit_indicator | CB_CM | DRAFT/REJECTED → PENDING + rebuildManifest |
| POST | /approve_indicator | LANH_DAO | PENDING → ACTIVE + rebuildManifest |
| POST | /reject_indicator | LANH_DAO | PENDING → REJECTED + lý do |
| POST | /create_request | CB_CM, LANH_DAO | Tạo yêu cầu thu thập + rebuildManifest |
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
CB_CM tạo  →  DRAFT    (POST /create_indicator) — NO rebuildManifest (DRAFT chỉ CB_CM thấy)
CB_CM gửi  →  PENDING  (POST /submit_indicator) + rebuildManifest → LANH_DAO thấy ngay
LANH_DAO   →  ACTIVE   (POST /approve_indicator) + rebuildManifest
           →  REJECTED (POST /reject_indicator) + lý do
CB_CM sửa + gửi lại   →  PENDING lại
```

**Optimistic update (app-side, không tốn reads):**
- Sau `createIndicator`: append indicator mới vào `manifest.my_indicators` local → tab Chỉ số thấy ngay
- Sau `submitIndicator`: update status DRAFT→PENDING trong `manifest.my_indicators` local → nút "Gửi duyệt" biến mất ngay

**Uniqueness rule**: `normalize(ten_chi_so) + normalize(don_vi_do)` per xa+year.
Chỉ check trong DRAFT/PENDING/ACTIVE. REJECTED/ARCHIVED được phép tạo lại.

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
- **So sánh kỳ**: combo dropdown chọn năm (currentYear-2, currentYear-1, currentYear). Chỉ so năm, không so quý.
- **Tăng/giảm**: hiển thị % thay đổi + arrow icon (↑/↓). Không phán "tốt/xấu".
- **Scope filter**:
  - CB_THON: backend đã lọc theo thôn
  - CB_CM: app filter theo `linh_vuc_codes`
  - LANH_DAO: thấy tất cả

---

## 10. Manifest Refresh Strategy (quan trọng — tránh tốn reads)

| Hành động | Strategy | Lý do |
|---|---|---|
| Sau `createIndicator` | Optimistic local append vào `my_indicators` | DRAFT chỉ CB_CM thấy, không cần rebuild |
| Sau `submitIndicator` | Optimistic local update status→PENDING | App thấy ngay; backend đã rebuild cho LANH_DAO |
| Sau `approveIndicator` | `pullManifest` với current_version | Backend đã rebuild → version đổi → up_to_date=false |
| Sau `createRequest` | `pullManifest` với current_version | Backend đã rebuild → version đổi |
| Pull-to-refresh thủ công | `pullManifest` với current_version | Normal flow |
| Force-pull (bypass cache) | `pullManifest` không gửi `current_version` | Backend bỏ qua up_to_date check, query fresh |

**`QUOTA.MANIFEST_CONDITIONAL_FETCH = true`**: nếu `client_version === stored_version` → backend trả `up_to_date: true` bỏ qua query. Bỏ `current_version` trong body để force-pull.

---

## 11. Seed Data (sau khi chạy seed script)

```
SUB001: THON01/REQ001 → PENDING_VERIFY
SUB002: THON02/REQ001 → NEEDS_REVISION
```

Reset:
```powershell
node tests/seed_test_data.js
```

---

## 12. Deploy Commands

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

## 13. Files đã thay đổi (V3.4 — session này)

### Backend
| File | Thay đổi |
|---|---|
| `handlers/indicators.js` | `submitIndicator` nay gọi `rebuildManifest` → LANH_DAO thấy PENDING indicator sau khi CB_CM submit |

### App — Bug fixes
| File | Thay đổi |
|---|---|
| `services/api.js` | Thêm: `createIndicator`, `submitIndicator`, `approveIndicator`, `rejectIndicator`, `getReportData`, `createRequest` (đủ 13 functions) |
| `app/(cb-cm)/_layout.jsx` | Fix: route names dùng `"verify/[subId]"` + `"indicator-create"` + `"request-create"` với `href: null`. KHÔNG dùng `tabBarButton: () => null` (crash react-navigation 7) |
| `app/(cb-thon)/_layout.jsx` | Fix: route name dùng `"submit/[reqId]"` với `href: null` |
| `app/(lanh-dao)/_layout.jsx` | Fix: route name dùng `"verify/[subId]"` với `href: null` |

### App — Feature + Fix
| File | Thay đổi |
|---|---|
| `app/(cb-cm)/indicator-create.jsx` | Fix: sau `createIndicator` thành công → optimistic append vào `manifest.my_indicators` (0 extra API call). Import thêm `updateManifest` từ store, dùng `useAuthStore.getState()` tránh stale closure |
| `app/(cb-cm)/indicators.jsx` | Fix: sau `submitIndicator` thành công → optimistic update status DRAFT→PENDING trong `manifest.my_indicators`. Bỏ `onRefresh()` sau submit (tiết kiệm reads). `forcePullManifest` function giữ lại cho các case khác |
| `app/(cb-cm)/index.jsx` | Feature: thêm FAB màu `COLORS.accent` (cam) → navigate đến `request-create`. `paddingBottom: 88` trong list để không bị FAB che |
| `app/(cb-cm)/request-create.jsx` | **MỚI**: form tạo yêu cầu thu thập. Fields: tiêu đề, deadline (YYYY-MM-DD), chỉ số (multi-select từ manifest.indicators), thôn (chips từ requests + manual input), ghi chú. Sau tạo: `pullManifest` để refresh |

### Files đã xóa (gây build crash)
| File | Lý do |
|---|---|
| `app/app/services/api.js` | Nằm sai trong Expo Router directory → Metro bundle nó → crash vì `../constants/config` rỗng |
| `app/app/constants/config.js` | File rỗng (0 bytes) trong Expo Router directory → spurious route |

---

## 14. Files KHÔNG thay đổi (vẫn dùng bản V3.3)

### Backend
- `handlers/auth.js`
- `handlers/data.js`
- `handlers/verify.js`
- `handlers/requests.js`
- `handlers/dashboard.js`
- `utils/constants.js`
- `utils/manifest.js`
- `utils/firestore.js`
- `utils/response.js`
- `middleware/validateToken.js`
- `middleware/checkPermission.js`
- `middleware/logAudit.js`
- `index.js`

### App
- `app/(cb-cm)/verify/[subId].jsx`
- `app/(cb-thon)/index.jsx`
- `app/(cb-thon)/submit/[reqId].jsx`
- `app/(cb-thon)/report.jsx`
- `app/(lanh-dao)/index.jsx`
- `app/(lanh-dao)/verify/[subId].jsx`
- `app/(lanh-dao)/indicators.jsx`
- `app/(lanh-dao)/report.jsx`
- `app/(cb-cm)/verify/[subId].jsx`
- `app/(cb-cm)/report.jsx`
- `app/store/authStore.js`
- `app/constants/theme.js`
- `app/constants/config.js`
- `app/components/LoadingOverlay.jsx`
- `app/components/OfflineBanner.jsx`
- `app/components/StatusBadge.jsx`

---

## 15. Pending / Roadmap

### ✅ Đã hoàn thành (V3.4)
- [x] **Request creation UI** — `request-create.jsx` + FAB trong `cb-cm/index.jsx`
- [x] **Manifest refresh không tốn reads** — optimistic local update cho createIndicator + submitIndicator

### 🔴 Ưu tiên cao (cần để app hoàn chỉnh)
- [ ] **"Hoàn thành thu thập"** — nút/action để publish request sau khi đủ submissions. Request OPEN → COMPLETED. Cần: confirmation screen hoặc modal + progress indicator (chưa có backend endpoint riêng — có thể dùng update request status)
- [ ] **Notification timeout bypass** — CB_CM không xét duyệt/ kiểm tra hay xác minh trong X ngày (X sẽ thiết lập trong account admin) → LANH_DAO tự động thấy trong queue. Cần thiết kế rõ luồng trước khi code

### 🟡 Ưu tiên trung bình
- [ ] **Admin role** — user management screen, tạo xã mới, tạo user, assign roles, tạo google drive file store trên team drive (đã được tạo với quyền anyone with the link và có quyền Content Manager https://drive.google.com/drive/folders/1yHIMb4NntUBQaI-bNBsjbsLsGEERgw9K?usp=sharing)
- [ ] **Request detail screen** — xem chi tiết request: danh sách thôn, chỉ số, progress từng thôn
- [ ] **Tab bar behavior** — verify/submit screens vẫn thấy tab bar khi push (acceptable hiện tại)

### 🟢 Ưu tiên thấp
- [ ] **Multi-year seed data** — test compare_year cần data ở 2025 và 2024
- [ ] **Google Sheets sync UI/status**
- [ ] **Onboarding / First-run** — hướng dẫn cho cán bộ lần đầu dùng

---

## 16. Design System (Figma) >> bỏ không sử dụng tiếp cận này nữa

**Figma account**: ngocdd@sfdp.net
**Giới hạn free tier**: 3 pages tối đa — cần upgrade hoặc dùng text spec thay thế.

### Color Styles (17)
| Style Name | Hex | Usage |
|---|---|---|
| Primary/Default | #1B5E20 | CTA, header, FAB chỉ số |
| Primary/Light | #2E7D32 | Header CB_CM |
| Primary/Pale | #E8F5E9 | ACTIVE badge bg |
| Accent/Default | #E65100 | FAB tạo request, alert |
| Accent/Light | #FF8F00 | Warning, NEEDS_REVISION |
| Danger/Default | #C62828 | Error, reject |
| Danger/Bg | #FFEBEE | Error background |
| Surface/Background | #F5F5F5 | App background |
| Surface/Card | #FFFFFF | Cards, inputs, modals |
| Text/Primary | #212121 | Main body text |
| Text/Secondary | #616161 | Meta, subtitle |
| Text/Hint | #9E9E9E | Placeholder, disabled |
| Border/Default | #E0E0E0 | Input border, divider |
| Status/Pending Bg | #FEF3C7 | PENDING badge bg |
| Status/Pending | #F59E0B | PENDING text |
| Status/In Review Bg | #E3F2FD | IN_REVIEW bg |
| Status/In Review | #1565C0 | IN_REVIEW text |

### Text Styles (9) — Font: System Default / Roboto trong Figma
| Style Name | Size | Weight | Line Height |
|---|---|---|---|
| Display/Large | 28px | 700 | 36 |
| Display/Medium | 24px | 700 | 32 |
| Title/Large | 20px | 700 | 28 |
| Title/Medium | 18px | 600 | 26 |
| Body/Large | 17px | 400 | 26 |
| Body/Medium | 16px | 400 | 24 |
| Label/Large | 16px | 600 | 22 |
| Label/Medium | 14px | 600 | 20 |
| Caption | 13px | 400 | 18 |

### Spacing
`xs=4 · sm=8 · md=16 · lg=24 · xl=32 · xxl=48` (px)

### Border Radius
`sm=6 · md=12 · lg=16 · xl=24 · full=999` (px)

### Touch Target
Minimum **56px height** (WCAG AA mobile)

### Screen Frame
**390 × 844px** (iPhone 14 / Android standard)

### Figma Plugin (auto-generate)
File `code.js` + `manifest.json` đã tạo sẵn.
Cách dùng:
1. Tạo folder `CommuneGovernance-Plugin/` chứa 2 files
2. Figma Desktop → Plugins → Development → Import plugin from manifest…
3. Tạo Figma Design file mới (để trống)
4. Plugins → Development → CommuneGovernance Setup → Run
5. Plugin tạo: 6 pages, 17 color styles, 9 text styles, 13 screen frames, 12 component placeholders

---

## 17. Quota & Cost Tracking

| Hành động | Reads | Writes | Ghi chú |
|---|---|---|---|
| login | 2 | 1 | validateToken + user + session |
| pull_manifest (CB_CM) | 3–4 | 0 | manifest + subs + indicators (parallel) |
| pull_manifest (LANH_DAO) | 3–4 | 0 | manifest + subs + pending_inds (parallel) |
| push_data | 3 | 2 | token + request + manifest / sub + audit |
| verify_data | 3 | 2 | token + sub + manifest / sub + audit |
| create_indicator | 2 | 2 | token + uniqueness-check / indicator + audit. **NO rebuildManifest** |
| submit_indicator | 2 | 3 | token + indicator / indicator + audit + **rebuildManifest** |
| approve_indicator | 4 | 3 | token + ind + subs + reqs / ind + audit + manifest |
| create_request | 3 | 3 | token + indicators(batch) / request + audit + manifest |
| report_data | 2–3 | 1 | token + subs(current) + subs(compare)? + audit |

**Optimistic updates (0 reads, 0 writes):**
- `createIndicator` → append local `my_indicators`
- `submitIndicator` → update local `my_indicators` status

**Ước tính 500 xã × 3 users: ~7,700 reads/day → 15% free tier quota**

## 18. Mô tả nghiệp vụ và thông tin cơ bản
## 18.1. Cơ cấu tổ chức cấp xã và thôn
Xã hiện có 3 nhóm cơ quan quan trọng
* Khối Chính quyền: UBND xã bao gồm các chức danh
** Lãnh đạo UBND xã: gồm Chủ tịch UBND xã và các phó chủ tịch
** Lãnh đạo các phòng ban Chuyên môn phụ trách từng lĩnh vực, nhóm lĩnh vực
*** Chuyên viên, cán bộ chuyên môn, công chức, cán bộ hợp đồng phụ trách lĩnh vực, nhóm lĩnh vực

* Khối Mặt trận tổ quốc (MTTQ)
** Lãnh đạo MTTQ: Gồm Chủ tịch MTTQ, các phó chủ tịch (hiện tại họ cũng kiêm chủ tịch các Hội đoàn thể bên dưới MTTQ)
** Lãnh đạo các Hội đoàn thể thuộc MTTQ: Chủ tịch các Hội Phụ nữ, Nông dân, Đoàn Thanh niên, Cựu Chiến binh: Hầu hết đoàn thể tại xã chỉ có Chủ tịch, phó chủ tịch và họ có thể coi là là cán bộ hội tại cấp xã (kể cả MTTQ cũng vậy)

* Khối cơ quan đảng (Đảng bộ xã)
** Lãnh đạo đảng ủy: Bí thư, phó bí thư đảng ủy xã
** Lãnh đạo: các ban đảng. Văn phòng Đảng ủy xã
*** Chuyên viên/ cán bộ các ban đảng xã

* Khối Hội đồng Nhân dân
** Lãnh đạo HĐND: Chủ tịch, các phó Chủ tịch HĐND (nhiều trường hợp lãnh đạo Đảng ủy cũng là lãnh đạo HĐND xã)
** Lãnh đạo: các ban của Hội đồng, Văn phòng Hội đồng ND xã
*** Cán bộ các ban, các tổ đại biểu HĐND ở các thôn

Tại thôn cũng có 3 vị trí tương ứng nhận request line để báo cáo từ thôn bao gồm
* Trưởng/ phó thôn: Báo cáo thông tin lên xã theo luồng UBND xã: Thông tin đến Cán bộ chuyên môn xác nhận hoặc có thể bypass bởi lãnh đạo UBND xã
* MTTQ thôn và các cán bộ là trưởng đoàn thể (Phụ nữ, thanh niên..): Nhận luồng điều hành qua MTTQ xã: Chủ tịch MTTQ xã yêu cầu >> MTTQ thôn, Chủ tịch Hội LHPN xã yêu cầu >> Chi hội LHPN thôn, tương tự đối với Đoàn, Nông dân..
* Bí thư chi bộ thôn: Luồng thông tin là: Đảng ủy xã (bí thư, văn phòng Đảng ủy, các ban Đảng) <<>> Bí thư chi bộ thôn.

## 18.2 Về phân quyền
Lãnh đạo xã: 
+ Phê duyệt yêu cầu thêm/ bớt chỉ số thu thập thông tin
+ Bypass quá trình xác nhận thông tin do thôn gửi lên của cán bộ chuyên môn (manual: Nhấn vào một lệnh gửi tin của thôn và xác nhận/ reject hoặc tự động: Nhận thông báo yêu cầu xác nhận, phê duyệt sau X ngày mà cán bộ chuyên môn không thực hiện, khi bypass thì sẽ có thể chọn gửi/không gửi thông tin nhắc nhở - đến cán bộ chuyên môn vì ko hoàn thành nhiệm vụ)
+ Xem, xóa bộ thông tin đã gửi, hoặc thu hồi request thu thập thông tin do cán bộ chuyên môn tạo ra
+ Tạo yêu cầu phổ biến thông tin toàn xã: Đây là kênh gửi thông tin đến cho các thôn để họ nắm bắt, đọc, theo dõi tốt nhất, bao gồm cả các chỉ đạo, tuyên truyền, có thể chấp nhận dạng văn bản, âm thanh video, link...
+ Duyệt chỉ số toàn xã: khi tất cả các thôn đã gửi tin và được xác nhận thì duyệt để công bố để hiển thị công khai hoặc hạn chế
+ Tương lai: Duyệt công khai/ không công khai tin do cộng đồng gửi lên (Cán bộ thôn đã xác minh): về thiên tai, mất trộm, dịch bệnh... Bypass quá trình review sự kiện do thôn gửi lên mà ko qua cán bộ chuyên môn như mục bypass trên đây (manual hoặc auto và cảnh báo)

Cán bộ chuyên môn:
+ Xác nhận/ từ chối thông tin do thôn gửi lên
+ Tạo bộ chỉ số/ chỉ số mới trình lãnh đạo phê duyệt: Có 2 loại chỉ số
++ Chỉ số thống kê như hiện đang làm
++ Chỉ số đánh giá hiệu quả hoạt động hỗ trợ của xã với nhân dân: Chất lượng thi công, Ảnh hưởng tiêu cực đến cộng đồng, tiến độ thực hiện, sự hài lòng của nhân dân với từng nội dung ....vv. Hiện tôi đang muốn đưa cái này riêng chỉ xuất hiện ở mảng của Mặt trận tổ quốc, Hội đồng nhân dân để làm kênh đánh giá hiệu năng hỗ trợ người dân từ góc độ Hội đồng nhân dân và MTTQ
+ Tạo yêu cầu thu thập thông tin theo lĩnh vực cho thôn thu thập
+ Tạo yêu cầu phổ biến thông tin thuộc lĩnh vực mình quản lý: Đây là kênh gửi thông tin đến cho các thôn để họ nắm bắt, đọc, theo dõi tốt nhất
+ Tương lai: Review thông tin sự kiện do thôn xác minh lên để trình lãnh đạo phê duyệt

Cán bộ thôn:
+ Nhận request thu thập thông tin và điền thông tin (bằng tay hoặc dùng AI để transcribe với key dùng của azuregrant để hỗ trợ quá trình nhập liệu), submit/ trình để cán bộ xã xác nhận, duyệt.
+ Sửa thông tin bị từ chối và submit lại
+ Nhận thông báo, phổ biến thông tin do xã gửi xuống để đi thực hiện nhiệm vụ được giao.
+ Tương lai: Kiểm tra xác minh sự kiện do người dân trên địa bàn gửi và submit đẻ cán bộ xã xem xét xuất bản công khai/ hạn chế (Công khai, ai cũng xem được, ngay cả khi không có tài khoản, hạn chế, chỉ người trong khu vực xã hoặc người dùng trong xã mới xem được). Cái này sẽ liên quan đến tương tác với location service

Tính năng tương lai:
+ Người dân: Bật app, điền số điện thoại, Họ tên, vào gửi thông tin về sự kiện (thiên tai, dịch bệnh an ninh, tai nạn) theo hình thức
+ Chụp ảnh, ghi âm >> transcribe thành text >> định vị vị trí gửi thông tin >> gửi lên >> trưởng thôn xem được >> tự xác minh hoặc assign cán bộ thôn đi xác minh >> submit lên xã.
+ Bổ sung bản đồ spot map/ heat map khu vực sự kiện

## 18.2 Về Hiển thị trên App
Mong đợi logic của App sẽ bao gồm các tab ở dưới đáy màn hình và profile của user
+ Profile: để điền, cập nhập thông tin về user. Không thể sửa user name
+ Tabs
++ Tổng quan: Hiển thị nhóm các thông tin được thiết lập tính năng công khai (toàn xã) và thông tin trên địa bàn/ lĩnh vực mình quản lý
++ Nghiệp vụ:
+++ Xã: Các nghiệp vụ do xã phụ trách theo user ví dụ Lãnh đạo xã >> duyệt, tạo yêu cầu cho cán bộ chuyên môn, các thôn, Tạo luồng chỉ đạo phổ biến thông tin.
+++ Thôn: Các nghiệp vụ do thôn phụ trách (xác minh sự kiện)
+++ Báo cáo: Đây là công cụ so sánh số liệu để sớm phát hiện bất cập từ các chỉ số/ bộ chỉ số đã yêu cầu, cung cấp. Các lớp thông tin khác cũng có thể được xem ở đây (cụ có thể cân nhắc xem nên tạo riêng hay ko?) ví dụ: Bản đồ googlemap thống kê các điểm cháy rừng, lở đất, lũ lụt, dịch bệnh, an ninh. Số ý kiến đánh giá về chất lượng thực hiện dịch vụ công.
++ Notification: Giúp người dùng được báo có các yêu cầu mới phát sinh và truy cập trực tiếp vào tính năng liên quan. Nguyên tắc notify là: NHững bên có liên quan đến nghiệp vụ được thông báo về tình trạng mỗi khi nó được thay đổi trạng thái

## 18.3 Lô gic chung
Người đầu tiên ở xã tải app, đăng ký người dùng  dưới vai trò admin sẽ
+ Tạo Xã
+ Tạo người dùng
+ Thiết lập một số yêu cầu cơ bản
+++ Số ngày nhắc nhở/ thông báo lên cấp trên khi một nghiệp vụ không được xử lý

Sau khi xong, App sẽ tạo Folder trên google drive của xã để lưu trữ các nội dung upload (Ảnh, video, pdf...), khởi tạo bộ số liệu ban đầu của xã.