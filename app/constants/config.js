// constants/config.js
export const API_BASE_URL = "https://careapi-cx7avsd4pa-as.a.run.app";

// Default year — dùng năm hiện tại
export const CURRENT_YEAR = new Date().getFullYear();

// Timeout cho API calls (ms) — mạng vùng sâu chậm
export const API_TIMEOUT = 15000;

// Key cho SecureStore / AsyncStorage
export const STORAGE_KEYS = {
  TOKEN:          "cg_token",
  USER:           "cg_user",
  XA_CODE:        "cg_xa_code",
  YEAR:           "cg_year",
  MANIFEST:       "cg_manifest",
  OFFLINE_QUEUE:  "cg_offline_queue",
};

// Submission status labels (Vietnamese)
export const STATUS_LABELS = {
  PENDING_VERIFY: "Chờ xét duyệt",
  IN_REVIEW:      "Đang xem xét",
  VERIFIED:       "Đã xác nhận",
  NEEDS_REVISION: "Cần chỉnh sửa",
  REJECTED:       "Từ chối",
};

// Request status labels
export const REQUEST_STATUS_LABELS = {
  OPEN:        "Đang mở",
  IN_PROGRESS: "Đang thực hiện",
  COMPLETED:   "Hoàn thành",
  CANCELLED:   "Đã hủy",
};

// Roles
export const ROLES = {
  CB_THON:       "CB_THON",
  CB_CHUYEN_MON: "CB_CHUYEN_MON",
  LANH_DAO:      "LANH_DAO",
  ADMIN:         "ADMIN",
};
