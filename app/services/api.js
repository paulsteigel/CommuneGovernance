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