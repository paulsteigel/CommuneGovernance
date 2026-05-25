# PROMPT HOÀN CHỈNH — HỆ THỐNG THU THẬP DỮ LIỆU THÔN/XÃ
## GOOGLE CLOUD FUNCTIONS + FIRESTORE + OFFLINE-FIRST ARCHITECTURE
## Version 2.0 — Production-Ready, Scales to 500+ communes

---

## 1. BỐI CẢNH DỰ ÁN

Ứng dụng Android (React Native) cho cán bộ thôn thu thập dữ liệu
và báo cáo lên xã — phục vụ vùng nông thôn/DTTS Việt Nam.

Pilot: 4 xã tỉnh Quảng Trị. Target: 500+ xã toàn quốc.
Usage pattern: 1 user/device tại một thời điểm (không có concurrent
multi-user trên cùng thiết bị).

### Nguyên tắc thiết kế bất biến
- OFFLINE-FIRST: Mỗi session = 1 read (pull) + 1 write (push). Không
  có call nào khác trong lúc user nhập liệu.
- ZERO VM: Không setup, không maintain server. Toàn bộ là managed
  services.
- SHEETS LÀ OUTPUT: Google Sheets chỉ để CARE staff xem báo cáo —
  không phải database.
- SCALE KHÔNG ĐỔI KIẾN TRÚC: Từ 4 lên 500 xã chỉ thêm data,
  không sửa code.

---

## 2. TECHNOLOGY STACK

| Layer         | Technology                  | Lý do chọn                          |
|---------------|-----------------------------|--------------------------------------|
| API           | Google Cloud Functions (v2) | 2M calls/tháng free, serverless thực sự, no VM |
| Database      | Cloud Firestore             | 50K reads + 20K writes/ngày free, realtime, offline SDK |
| Auth          | Custom token trong Firestore | Đủ đơn giản cho use case, không cần Firebase Auth |
| Image Storage | Google Drive (Workspace)    | Nonprofit = unlimited storage        |
| Reporting     | Google Sheets               | CARE staff quen dùng, sync đêm từ Firestore |
| Scheduler     | Cloud Scheduler             | Trigger sync Firestore → Sheets hằng đêm |

### Quota thực tế cho 500 xã

```
500 xã × 30 users × 2 calls/ngày = 30,000 calls/ngày
Cloud Functions free: 2,000,000/tháng → dư 1.1M calls → $0

Firestore reads (manifest pulls):
500 xã × 30 reads/ngày = 15,000 reads/ngày
Free tier: 50,000/ngày → dư 35,000 → $0

Firestore writes (push_data):
500 xã × 30 writes/ngày = 15,000 writes/ngày
Free tier: 20,000/ngày → dư 5,000 → $0 (hoặc $0.06/100K khi vượt)
```

---

## 3. FIRESTORE SCHEMA (Source of Truth)

### 3.1 Collection: `config/xa_registry/{xa_code}`
Thay thế Developer Sheet XA_REGISTRY.
```
xa_code:        "XALAOBAO"
xa_name:        "Xã Lao Bảo"
tinh:           "Quảng Trị"
gmail_xa:       "ubnd.xa.laobao@gmail.com"
drive_folder_id:"abc123xyz"   // Google Drive folder để upload ảnh
sheets_id:      "2CyL4n..."   // Commune Sheet dùng cho reporting
status:         "ACTIVE"
created_at:     Timestamp
```

### 3.2 Collection: `users/{user_id}`
Thay thế Developer Sheet USERS.
```
user_id:          "USR001"
xa_code:          "XALAOBAO"
ho_ten:           "Nguyễn Văn A"
vai_tro:          "CB_THON"           // ADMIN|LANH_DAO|CB_CHUYEN_MON|CB_THON
don_vi:           "THON01"            // thôn code hoặc phòng ban hoặc "XA"
linh_vuc_codes:   ["NONG_NGHIEP"]     // null nếu không áp dụng
password_hash:    "sha256hex..."
password_salt:    "randomsalt..."     // per-user salt, KHÔNG share
session_token:    "random32chars..."
token_expires_at: Timestamp           // 30 ngày
status:           "ACTIVE"
last_login_at:    Timestamp
```

### 3.3 Collection: `communes/{xa_code}/indicators/{chi_so_id}`
Thay thế tab CHI_SO trong Commune Sheet.
```
chi_so_id:    "CS001"
ten_chi_so:   "Diện tích lúa"
mo_ta:        "Tổng diện tích canh tác lúa trong thôn"
don_vi_do:    "ha"
kieu_du_lieu: "so"           // so | text | boolean | anh
linh_vuc:     "NONG_NGHIEP"
validation: {
  required: true,
  min: 0,                    // chỉ dùng nếu kieu_du_lieu = "so"
  max: 10000
}
created_by:   "USR002"
status:       "DRAFT"        // DRAFT → PENDING → ACTIVE → ARCHIVED
created_at:   Timestamp
updated_at:   Timestamp
approved_by:  null           // user_id khi LANH_DAO approve
approved_at:  null
year:         2025
```

### 3.4 Collection: `communes/{xa_code}/requests/{req_id}`
Thay thế tab REQUESTS trong Commune Sheet.
```
req_id:          "REQ001"
tieu_de:         "Báo cáo nông nghiệp Q2/2025"
tao_boi:         "USR002"
danh_sach_thon:  ["THON01", "THON02", "THON03"]
chi_so_ids:      ["CS001", "CS002"]
deadline:        "2025-06-30"
ghi_chu:         "Số liệu tính đến ngày 30/6"
status:          "OPEN"       // OPEN → IN_PROGRESS → COMPLETED → CANCELLED
manifest_version:"v20250615T103000"
created_at:      Timestamp
year:            2025
```

### 3.5 Collection: `communes/{xa_code}/submissions/{submission_id}`
Thay thế tab REQ_[id] trong Commune Sheet.
```
submission_id:         "SUB001"
req_id:                "REQ001"
thon_code:             "THON01"
submitted_by:          "USR001"
submitted_at:          Timestamp   // khi push lên server
device_collected_at:   Timestamp   // khi user nhập trên device
values: {
  "CS001": 120.5,
  "CS002": 45,
  "CS003": true
}
anh_urls:              ["https://drive.google.com/..."]
manifest_version_used: "v20250615T103000"
status:                "PENDING_VERIFY"
                       // PENDING_VERIFY → VERIFIED → REJECTED
verified_by:           null
verified_at:           null
rejection_reason:      null
year:                  2025
```

### 3.6 Document: `communes/{xa_code}/manifests/current`
Pre-computed manifest, được update mỗi khi có thay đổi indicator/request.
Không filter theo user ở đây — filtering xảy ra trong Cloud Function.
```
version:      "v20250615T103000"   // ISO timestamp khi manifest được tạo lại
generated_at: Timestamp
xa_code:      "XALAOBAO"
xa_name:      "Xã Lao Bảo"
year:         2025

indicators: [   // tất cả indicators ACTIVE của xã trong năm
  {
    chi_so_id:    "CS001",
    ten_chi_so:   "Diện tích lúa",
    mo_ta:        "...",
    don_vi_do:    "ha",
    kieu_du_lieu: "so",
    linh_vuc:     "NONG_NGHIEP",
    validation:   { required: true, min: 0, max: 10000 }
  }
]

requests: [    // tất cả requests OPEN của xã trong năm
  {
    req_id:         "REQ001",
    tieu_de:        "Báo cáo nông nghiệp Q2",
    chi_so_ids:     ["CS001", "CS002"],
    danh_sach_thon: ["THON01", "THON02"],
    deadline:       "2025-06-30",
    ghi_chu:        "..."
  }
]

drive_folder_id: "abc123"   // để client upload ảnh trực tiếp
```

### 3.7 Collection: `audit_logs/{log_id}`
```
log_id:     auto-generated
user_id:    "USR001"
xa_code:    "XALAOBAO"
action:     "push_data"
timestamp:  Timestamp
detail:     { req_id: "REQ001", submission_id: "SUB001", ... }
ip:         "..."          // Cloud Function có thể lấy từ request headers
```

---

## 4. MANIFEST SCHEMA (trả về cho client)

Khi login hoặc pull_manifest, Cloud Function đọc
`communes/{xa_code}/manifests/current` rồi FILTER server-side theo role:

```json
{
  "manifest_version": "v20250615T103000",
  "generated_at": "2025-06-15T10:30:00Z",
  "expires_at": "2025-06-16T10:30:00Z",

  "user": {
    "user_id": "USR001",
    "ho_ten": "Nguyễn Văn A",
    "vai_tro": "CB_THON",
    "don_vi": "THON01",
    "xa_code": "XALAOBAO",
    "xa_name": "Xã Lao Bảo"
  },

  "indicators": [
    // CB_THON: tất cả indicators ACTIVE (cần để hiểu data form)
    // CB_CM: chỉ indicators thuộc linh_vuc_codes của mình
    // LANH_DAO/ADMIN: tất cả
    {
      "chi_so_id": "CS001",
      "ten_chi_so": "Diện tích lúa",
      "mo_ta": "Tổng diện tích canh tác lúa",
      "don_vi_do": "ha",
      "kieu_du_lieu": "so",
      "validation": { "min": 0, "max": 10000, "required": true }
    }
  ],

  "requests": [
    // CB_THON: CHỈ requests có thôn của mình trong danh_sach_thon
    //          + kèm has_submitted để tránh nộp 2 lần
    // CB_CM: requests do mình tạo hoặc thuộc lĩnh vực của mình
    // LANH_DAO/ADMIN: tất cả
    {
      "req_id": "REQ001",
      "tieu_de": "Báo cáo nông nghiệp Q2",
      "chi_so_ids": ["CS001", "CS002"],
      "deadline": "2025-06-30",
      "ghi_chu": "Tính đến ngày 30/6",
      "has_submitted": false,
      "submitted_at": null
    }
  ],

  "config": {
    "drive_folder_id": "abc123",
    "current_year": 2025
  }
}
```

---

## 5. PHÂN QUYỀN

4 roles: ADMIN | LANH_DAO | CB_CHUYEN_MON | CB_THON

### Scoping rules
- CB_THON: scoped theo `don_vi` (thôn code). Chỉ thấy/nộp data
  của thôn mình.
- CB_CHUYEN_MON: scoped theo `don_vi` (phòng ban) + `linh_vuc_codes`.
  Chỉ tạo/verify indicators thuộc lĩnh vực của mình.
- LANH_DAO / ADMIN: scope toàn xã.

### Business rules cứng — KHÔNG có exception

```
R1: CHỈ LANH_DAO được approve indicator (PENDING → ACTIVE)
R2: CHỈ CB_THON được push_data — CB_CM/LANH_DAO KHÔNG nhập thay
R3: CB_CM chỉ create/verify indicators thuộc linh_vuc_codes của mình
R4: CB_THON KHÔNG BAO GIỜ thấy data của thôn khác
R5: push_data phải verify user.don_vi === request.danh_sach_thon
    (chống forge thôn)
R6: Manifest filter server-side — không tin client tự filter
R7: Mỗi (req_id, thon_code) chỉ được submit 1 lần
    (check trước khi ghi Firestore)
```

### Hàm bắt buộc

```javascript
// Throw ngay nếu fail — KHÔNG để logic chạy tiếp
function checkPermission(user, action, scope) {
  // action: "push_data" | "create_indicator" | "approve_indicator" | ...
  // scope: { req_id, thon_code, linh_vuc, chi_so_id, ... }
  const rules = PERMISSION_MATRIX[action];
  if (!rules.allowedRoles.includes(user.vai_tro)) {
    throw { code: "PERM_001", message: "Role không được phép" };
  }
  if (rules.scopeCheck) {
    rules.scopeCheck(user, scope); // throw PERM_002 nếu sai scope
  }
}
```

---

## 6. CLOUD FUNCTIONS ENDPOINTS

Base URL: `https://{region}-{project}.cloudfunctions.net/care-api`
Tất cả endpoints nhận POST với Content-Type: application/json.
GET chỉ dùng cho dashboard (có thể cache).

```
// Auth
POST /login          // credentials → session_token + filtered manifest
POST /logout         // invalidate token trong Firestore

// Manifest
POST /pull_manifest  // refresh manifest khi token còn hạn

// Data (offline-first)
POST /push_data      // CB_THON batch submit toàn bộ session

// Management (online, CB_CM + LANH_DAO)
POST /create_indicator   // CB_CM tạo → DRAFT, trigger rebuild manifest
POST /approve_indicator  // LANH_DAO duyệt → ACTIVE, trigger rebuild manifest
POST /create_request     // CB_CM/LANH_DAO tạo request, trigger rebuild manifest
POST /verify_data        // CB_CM xác nhận submission → VERIFIED

// Reporting
GET  /dashboard          // tổng hợp theo xã/thôn/kỳ (LANH_DAO/ADMIN)

// Internal (triggered by Cloud Scheduler, không expose ra ngoài)
POST /sync_to_sheets     // Firestore → Google Sheets, chạy mỗi đêm lúc 2AM
```

### Trigger rebuild manifest
Mỗi khi có thay đổi ảnh hưởng đến manifest (create/approve indicator,
create request), Cloud Function phải gọi `rebuildManifest(xa_code, year)`
để update document `communes/{xa_code}/manifests/current`.
Client nhận manifest mới trong response ngay lập tức.

---

## 7. REQUEST / RESPONSE FORMAT

### Request format (tất cả endpoints trừ /login)
```json
{
  "token": "random32chars...",
  "xa_code": "XALAOBAO",
  "year": 2025,
  "data": { }
}
```

### push_data payload
```json
{
  "token": "...",
  "manifest_version_used": "v20250615T103000",
  "submissions": [
    {
      "req_id": "REQ001",
      "device_collected_at": "2025-06-15T09:00:00Z",
      "values": {
        "CS001": 120.5,
        "CS002": 45,
        "CS003": true
      },
      "anh_urls": [
        "https://drive.google.com/file/d/abc/view"
      ]
    }
  ]
}
```

### push_data response
```json
{
  "success": true,
  "processed": 1,
  "submission_ids": ["SUB001"],
  "warnings": [],
  "new_manifest": { }
}
```
Note: `warnings` chứa "MANIFEST_OUTDATED" nếu manifest_version_used
khác version hiện tại — vẫn accept data, chỉ flag để CB_CM biết khi verify.

### Error response format
```json
{
  "success": false,
  "error_code": "PERM_002",
  "message": "Không có quyền thực hiện thao tác này",
  "timestamp": "2025-06-15T10:30:00Z"
}
```

### Error codes chuẩn
```
AUTH_001: Token không hợp lệ hoặc hết hạn
AUTH_002: Sai user_id hoặc password
PERM_001: Role không được phép thực hiện action này
PERM_002: User không có quyền trên scope này (sai thôn/lĩnh vực)
DATA_001: Thiếu trường bắt buộc
DATA_002: Request không tồn tại hoặc đã đóng
DATA_003: CHI_SO không thuộc linh_vuc của user
DATA_004: Submission trùng lặp (req_id + thon_code đã tồn tại)
DATA_005: Indicator không ở trạng thái hợp lệ để approve
SYNC_001: Manifest version mismatch (warning, không block)
SYS_001:  Lỗi hệ thống — log và trả về message chung
```

---

## 8. SECURITY

### Password
- Algorithm: SHA-256 + per-user salt (salt lưu riêng trong Firestore)
- KHÔNG dùng bcrypt (quá chậm cho Cloud Functions cold start)
- Salt: 16 bytes random, hex encoded

```javascript
function hashPassword(plain, salt) {
  const crypto = require("crypto");
  return crypto.createHash("sha256")
    .update(plain + salt)
    .digest("hex");
}

function generateSalt() {
  const crypto = require("crypto");
  return crypto.randomBytes(16).toString("hex");
}
```

### Session token
- 32 bytes random, hex encoded (64 chars)
- TTL: 30 ngày từ lần login
- Lưu trong Firestore `users/{user_id}.session_token` +
  `token_expires_at`
- Invalidate: xóa token field (logout) hoặc check expires_at (auto)

### Firestore Security Rules
Cloud Functions chạy với Service Account có full Firestore access.
Client KHÔNG trực tiếp đọc/ghi Firestore — tất cả qua Cloud Functions.
Firestore rules: deny all từ client.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Cloud Functions dùng Admin SDK
    }
  }
}
```

### Audit log
Mọi write operation ghi vào `audit_logs`:
```javascript
async function logAudit(user, action, detail) {
  await db.collection("audit_logs").add({
    user_id: user.user_id,
    xa_code: user.xa_code,
    action,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    detail
  });
}
```

---

## 9. OFFLINE-FIRST FLOW

### CB_THON flow (happy path)
```
1. Mở app, có mạng
   → POST /login
   → nhận { session_token, manifest }
   → lưu vào AsyncStorage (React Native)

2. Đóng mạng / vào vùng không có sóng
   → app đọc manifest từ AsyncStorage
   → user nhập số liệu cho từng request
   → data lưu tạm trong AsyncStorage

3. Có mạng trở lại
   → POST /push_data với toàn bộ submissions
   → nhận { success, submission_ids, new_manifest }
   → update manifest trong AsyncStorage

4. Token hết hạn (30 ngày)
   → POST /login lại
   → nhận manifest mới
```

### Conflict detection
```
push_data gửi: manifest_version_used = "v20250615T103000"
Server check: current manifest version = "v20250620T080000"
→ Khác nhau → vẫn ACCEPT data (data thực tế vẫn có giá trị)
→ Thêm warning: "MANIFEST_OUTDATED"
→ CB_CM sẽ thấy flag khi verify → tự quyết định có cần thu thập lại
```

---

## 10. IMAGE UPLOAD FLOW

Apps Script và Cloud Functions KHÔNG nhận binary upload.
Client upload ảnh trực tiếp lên Google Drive:

```
1. manifest.config.drive_folder_id = "abc123"
2. Client dùng Google Drive API (OAuth hoặc Service Account token)
   để upload ảnh vào folder của xã
3. Lấy file URL sau khi upload thành công
4. Đưa URL vào push_data payload: anh_urls: ["https://..."]
5. Cloud Function chỉ lưu URL — không xử lý file
```

Note: Workspace for Nonprofits → unlimited Drive storage.
Tổ chức theo path: `/{xa_code}/{year}/{req_id}/{thon_code}/`

---

## 11. GOOGLE SHEETS SYNC (Reporting Only)

Cloud Scheduler trigger mỗi đêm lúc 2AM → POST /sync_to_sheets

### sync_to_sheets logic
```javascript
async function syncToSheets(xa_code, year) {
  // 1. Đọc tất cả submissions từ Firestore (batch)
  const submissions = await db
    .collection(`communes/${xa_code}/submissions`)
    .where("year", "==", year)
    .get();

  // 2. Mở Commune Sheet (ID từ config/xa_registry/{xa_code}.sheets_id)
  const sheet = SpreadsheetApp / googleapis sheets API
  
  // 3. Clear và rewrite toàn bộ data tab
  // Tab SUBMISSIONS: tất cả submissions theo req_id, thon_code
  // Tab SUMMARY: tổng hợp theo thôn, theo chỉ số
  // Tab INDICATORS: danh sách CHI_SO hiện tại
  // Tab REQUESTS: danh sách requests hiện tại

  // 4. Không bao giờ để Sheets là source of truth
  //    Sheets có thể bị xóa/corrupt → chỉ cần chạy lại sync
}
```

Commune Sheets structure (read-only cho CARE staff):
```
Tab SUBMISSIONS: submission_id | req_id | thon | submitted_by |
                 submitted_at | CS001 | CS002 | ... | status
Tab SUMMARY:     thon_code | req_id | tieu_de | trang_thai | % hoàn thành
Tab INDICATORS:  chi_so_id | ten | don_vi | linh_vuc | status
Tab REQUESTS:    req_id | tieu_de | deadline | status | % thon da nop
```

---

## 12. PROJECT STRUCTURE (Cloud Functions)

```
care-data-collection/
├── index.js              // Entry point, router
├── package.json
├── .env                  // GOOGLE_APPLICATION_CREDENTIALS, PROJECT_ID
│
├── handlers/
│   ├── auth.js           // login, logout, pull_manifest
│   ├── data.js           // push_data
│   ├── indicators.js     // create_indicator, approve_indicator
│   ├── requests.js       // create_request
│   ├── verify.js         // verify_data
│   ├── dashboard.js      // get_dashboard
│   └── sync.js           // sync_to_sheets (internal)
│
├── middleware/
│   ├── validateToken.js  // check session_token trong Firestore
│   ├── checkPermission.js// enforce RBAC — gọi trước mọi handler
│   └── logAudit.js       // ghi audit_logs
│
├── utils/
│   ├── firestore.js      // db instance, batch helpers
│   ├── crypto.js         // hashPassword, generateToken, generateSalt
│   ├── manifest.js       // buildManifest, rebuildManifest, filterManifest
│   ├── response.js       // successResponse, errorResponse
│   └── constants.js      // ROLES, ACTIONS, ERROR_CODES
│
└── firestore.rules       // deny all từ client
```

---

## 13. YÊU CẦU OUTPUT (Implement theo thứ tự)

### Bước 1 — Foundation (implement trước)
Viết đầy đủ code cho:

1. `index.js` — router, parse request, dispatch đến handler
2. `middleware/validateToken.js` — đọc Firestore users, check expiry
3. `middleware/checkPermission.js` — PERMISSION_MATRIX đầy đủ 9 actions,
   throw error ngay nếu fail, được gọi TRƯỚC mọi business logic
4. `utils/crypto.js` — hashPassword(plain, salt), generateToken(),
   generateSalt()
5. `utils/response.js` — successResponse(data), errorResponse(code, msg)
6. `utils/constants.js` — ROLES, ACTIONS, ERROR_CODES, PERMISSION_MATRIX
7. `handlers/auth.js`:
   - `login(req)`: verify password → tạo token → buildManifest → return
   - `logout(req)`: clear token trong Firestore
   - `pullManifest(req)`: refresh manifest cho token còn hạn
8. `utils/manifest.js`:
   - `buildManifest(xa_code, year, user)`: đọc Firestore, filter theo role,
     return manifest JSON
   - `rebuildManifest(xa_code, year)`: update document manifests/current
   - `filterManifestForUser(manifest, user)`: filter requests theo thôn/lĩnh vực

### Bước 2 — Core data flow
9. `handlers/data.js` — `pushData(req)`:
   - checkPermission trước
   - Validate payload
   - Check duplicate (req_id + thon_code + year)
   - Check manifest version → add warning nếu stale
   - Batch write submissions vào Firestore
   - logAudit
   - Return { success, submission_ids, warnings, new_manifest }

### Bước 3 — Management
10. `handlers/indicators.js` — create + approve
11. `handlers/requests.js` — create + trigger rebuildManifest
12. `handlers/verify.js` — verify submission
13. `handlers/dashboard.js` — aggregate từ Firestore

### Bước 4 — Reporting sync
14. `handlers/sync.js` — sync_to_sheets dùng Google Sheets API v4

---

## 14. CONSTRAINTS BẮT BUỘC

```
- Tất cả Firestore reads dùng batch (collection.get() hoặc
  collection.where().get()) — KHÔNG dùng doc().get() trong loop
- checkPermission() phải được gọi TRƯỚC mọi business logic,
  không exception
- push_data PHẢI check duplicate trước khi ghi
- Mọi write operation PHẢI gọi logAudit()
- rebuildManifest() phải được gọi sau mỗi thay đổi indicator/request
- Comment bằng tiếng Anh trong code
- Tất cả error phải return đúng format errorResponse()
  — không bao giờ để unhandled exception expose ra client
- Dùng async/await, không dùng callback
- Validate input ở đầu mỗi handler trước khi chạm Firestore
```

---

## 15. ENVIRONMENT VARIABLES

```bash
PROJECT_ID=care-data-collection
FIRESTORE_DATABASE=(default)
REGION=asia-southeast1        # Singapore, gần Việt Nam nhất
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json

# Sheets sync
SHEETS_API_SCOPES=https://www.googleapis.com/auth/spreadsheets

# Security
TOKEN_TTL_DAYS=30
MANIFEST_TTL_HOURS=24
```

---

*Prompt version 2.0 — Offline-First, Google Cloud Functions + Firestore*
*Designed for CARE Vietnam — Rural Data Collection System*
*Scales from 4 to 500+ communes without architecture change*
