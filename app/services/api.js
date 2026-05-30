// services/api.js
import { API_BASE_URL, API_TIMEOUT } from "../constants/config";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new ApiError("TIMEOUT", "Kết nối quá chậm, vui lòng thử lại");
    throw new ApiError("NETWORK", "Không có kết nối mạng");
  }
}

function post(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`${path}${qs ? "?" + qs : ""}`, { method: "GET" });
}

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function unwrap(result, fallbackMessage = "Lỗi không xác định") {
  if (!result.ok || !result.data?.success) {
    const msg  = result.data?.message    || fallbackMessage;
    const code = result.data?.error_code || "SYS_001";
    throw new ApiError(code, msg);
  }
  return result.data;
}

// ─── Auth ─────────────────────────────────────────────────────

export async function login({ user_id, password, xa_code, year }) {
  return unwrap(await post("/login", { user_id, password, xa_code, year }), "Đăng nhập thất bại");
}

export async function logout({ token, user_id, xa_code, year }) {
  return unwrap(await post("/logout", { token, user_id, xa_code, year }), "Đăng xuất thất bại");
}

export async function pullManifest({ token, user_id, xa_code, year, current_version }) {
  return unwrap(
    await post("/pull_manifest", { token, user_id, xa_code, year, current_version }),
    "Không lấy được danh sách công việc"
  );
}

// ─── Data (CB_THON) ───────────────────────────────────────────

export async function pushData({ token, user_id, xa_code, year, manifest_version_used, submissions }) {
  return unwrap(
    await post("/push_data", { token, user_id, xa_code, year, manifest_version_used, submissions }),
    "Gửi số liệu thất bại"
  );
}

export async function resubmitData({ token, user_id, xa_code, submission_id, updated_values }) {
  return unwrap(
    await post("/resubmit_data", { token, user_id, xa_code, submission_id, updated_values }),
    "Gửi lại thất bại"
  );
}

// ─── Indicators ───────────────────────────────────────────────

export async function createIndicator({
  token, user_id, xa_code, year,
  ten_chi_so, kieu_du_lieu, linh_vuc,
  don_vi_do, mo_ta, validation,
}) {
  return unwrap(
    await post("/create_indicator", {
      token, user_id, xa_code, year,
      ten_chi_so, kieu_du_lieu, linh_vuc,
      don_vi_do, mo_ta, validation,
    }),
    "Tạo chỉ số thất bại"
  );
}

export async function submitIndicator({ token, user_id, xa_code, year, chi_so_id }) {
  return unwrap(
    await post("/submit_indicator", { token, user_id, xa_code, year, chi_so_id }),
    "Gửi duyệt thất bại"
  );
}

export async function approveIndicator({ token, user_id, xa_code, year, chi_so_id }) {
  return unwrap(
    await post("/approve_indicator", { token, user_id, xa_code, year, chi_so_id }),
    "Duyệt chỉ số thất bại"
  );
}

export async function rejectIndicator({ token, user_id, xa_code, year, chi_so_id, rejection_reason }) {
  return unwrap(
    await post("/reject_indicator", { token, user_id, xa_code, year, chi_so_id, rejection_reason }),
    "Từ chối chỉ số thất bại"
  );
}

// ─── Requests ─────────────────────────────────────────────────

export async function createRequest({
  token, user_id, xa_code, year,
  tieu_de, chi_so_ids, danh_sach_thon, deadline, ghi_chu,
}) {
  return unwrap(
    await post("/create_request", {
      token, user_id, xa_code, year,
      tieu_de, chi_so_ids, danh_sach_thon, deadline, ghi_chu,
    }),
    "Tạo yêu cầu thất bại"
  );
}

// ─── Verify ───────────────────────────────────────────────────

export async function verifyData({
  token, user_id, xa_code,
  submission_id, verify_mode, decision,
  indicator_reviews, comment,
}) {
  return unwrap(
    await post("/verify_data", {
      token, user_id, xa_code,
      submission_id, verify_mode, decision,
      indicator_reviews, comment,
    }),
    "Xét duyệt thất bại"
  );
}

// ─── Dashboard ────────────────────────────────────────────────

export async function getDashboard({ token, user_id, xa_code, year, req_id }) {
  const params = { token, user_id, xa_code, year };
  if (req_id) params.req_id = req_id;
  return unwrap(await get("/dashboard", params), "Không lấy được dashboard");
}

// ─── Report ───────────────────────────────────────────────────

export async function getReportData({ token, user_id, xa_code, year, compare_year }) {
  const params = { token, user_id, xa_code, year };
  if (compare_year) params.compare_year = compare_year;
  return unwrap(await get("/report_data", params), "Không lấy được số liệu");
}
// ─── Request Status ────────────────────────────────────────────

/**
 * Complete a request — all thons must be VERIFIED.
 * action: "complete" | "cancel" | "exclude_thon"
 */
export async function updateRequestStatus({
  token, user_id, xa_code,
  req_id, action,
  cancel_reason, thon_code, reason,
}) {
  return unwrap(
    await request("/update_request_status", {
      method: "PATCH",
      body: JSON.stringify({
        token, user_id, xa_code,
        req_id, action,
        ...(cancel_reason !== undefined && { cancel_reason }),
        ...(thon_code      !== undefined && { thon_code }),
        ...(reason         !== undefined && { reason }),
      }),
    }),
    "Cập nhật trạng thái thất bại"
  );
}

// ─── Public results (no auth) ─────────────────────────────────

export async function getPublicResults({ xa_code, year, nhanh }) {
  const params = {};
  if (year)  params.year  = year;
  if (nhanh) params.nhanh = nhanh;
  return unwrap(
    await get(`/public/xa/${xa_code}/results`, params),
    "Không lấy được kết quả công khai"
  );
}

// ─── Register / Admin ─────────────────────────────────────────

export async function registerUser({
  link_token, ho_ten, phone, cccd, email, chuc_danh, password,
}) {
  return unwrap(
    await post("/register", {
      link_token, ho_ten, phone, cccd, email, chuc_danh, password,
    }),
    "Đăng ký thất bại"
  );
}

export async function createInviteLink({ token, user_id, xa_code }) {
  return unwrap(
    await post("/admin/create_invite_link", { token, user_id, xa_code }),
    "Tạo link thất bại"
  );
}

export async function listPendingUsers({ token, user_id, xa_code }) {
  return unwrap(
    await post("/admin/list_pending_users", { token, user_id, xa_code }),
    "Không lấy được danh sách chờ"
  );
}

export async function approveUser({
  token, user_id, xa_code,
  target_user_id, vai_tro, nhanh, don_vi, linh_vuc_codes, other_branches,
}) {
  return unwrap(
    await post("/admin/approve_user", {
      token, user_id, xa_code,
      target_user_id, vai_tro, nhanh, don_vi,
      linh_vuc_codes: linh_vuc_codes || [],
      other_branches: other_branches || [],
    }),
    "Phê duyệt thất bại"
  );
}

export async function resetPassword({
  token, user_id, xa_code,
  target_user_id, verify_phone, verify_cccd, new_password,
}) {
  return unwrap(
    await post("/admin/reset_password", {
      token, user_id, xa_code,
      target_user_id, verify_phone, verify_cccd, new_password,
    }),
    "Đặt lại mật khẩu thất bại"
  );
}
