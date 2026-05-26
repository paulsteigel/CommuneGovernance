// services/api.js
// Wrapper gọi tất cả backend endpoints của CommuneGovernance API.
// Hỗ trợ timeout + offline detection.

import { API_BASE_URL, API_TIMEOUT } from "../constants/config";

// ─── Core fetch wrapper ────────────────────────────────────────

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const url = `${API_BASE_URL}${path}`;
    const res  = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    clearTimeout(timeoutId);

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new ApiError("TIMEOUT", "Kết nối quá chậm, vui lòng thử lại");
    }
    throw new ApiError("NETWORK", "Không có kết nối mạng");
  }
}

function post(path, body) {
  return request(path, {
    method:  "POST",
    body:    JSON.stringify(body),
  });
}

function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`${path}${qs ? "?" + qs : ""}`, { method: "GET" });
}

// ─── API Error class ───────────────────────────────────────────

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ─── Response helper ───────────────────────────────────────────

function unwrap(result, fallbackMessage = "Lỗi không xác định") {
  if (!result.ok || !result.data?.success) {
    const msg = result.data?.message || fallbackMessage;
    const code = result.data?.error_code || "SYS_001";
    throw new ApiError(code, msg);
  }
  return result.data;
}

// ─── Auth endpoints ────────────────────────────────────────────

/**
 * Đăng nhập
 * @returns { token, manifest }
 */
export async function login({ user_id, password, xa_code, year }) {
  const result = await post("/login", { user_id, password, xa_code, year });
  return unwrap(result, "Đăng nhập thất bại");
}

/**
 * Đăng xuất
 */
export async function logout({ token, user_id, xa_code, year }) {
  const result = await post("/logout", { token, user_id, xa_code, year });
  return unwrap(result, "Đăng xuất thất bại");
}

/**
 * Pull manifest (kiểm tra cập nhật)
 */
export async function pullManifest({ token, user_id, xa_code, year, current_version }) {
  const result = await post("/pull_manifest", {
    token, user_id, xa_code, year, current_version,
  });
  return unwrap(result, "Không lấy được danh sách công việc");
}

// ─── Data endpoints ────────────────────────────────────────────

/**
 * Gửi số liệu (CB_THON)
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.user_id
 * @param {string} params.xa_code
 * @param {number} params.year
 * @param {string} params.manifest_version_used
 * @param {Array}  params.submissions  — [{ req_id, device_collected_at, values: {CS001: ..} }]
 */
export async function pushData({ token, user_id, xa_code, year, manifest_version_used, submissions }) {
  const result = await post("/push_data", {
    token, user_id, xa_code, year, manifest_version_used, submissions,
  });
  return unwrap(result, "Gửi số liệu thất bại");
}

/**
 * Gửi lại số liệu đã bị yêu cầu chỉnh sửa
 */
export async function resubmitData({ token, user_id, xa_code, submission_id, values }) {
  const result = await post("/resubmit_data", {
    token, user_id, xa_code, submission_id, values,
  });
  return unwrap(result, "Gửi lại thất bại");
}

// ─── Verify endpoints ──────────────────────────────────────────

/**
 * Xét duyệt số liệu (CB_CM / LANH_DAO)
 * @param {object} params
 * @param {string} params.verify_mode  — "batch" | "per_indicator"
 * @param {string} params.decision     — "confirm" | "reject" | "flag"
 * @param {object} params.indicator_reviews — { CS001: { status, comment } }
 * @param {string} params.verify_comment
 */
export async function verifyData({
  token, user_id, xa_code,
  submission_id, verify_mode, decision,
  indicator_reviews, verify_comment,
}) {
  const result = await post("/verify_data", {
    token, user_id, xa_code,
    submission_id, verify_mode, decision,
    indicator_reviews, verify_comment,
  });
  return unwrap(result, "Xét duyệt thất bại");
}

// ─── Dashboard endpoint ────────────────────────────────────────

/**
 * Lấy dashboard tổng quan (LANH_DAO)
 */
export async function getDashboard({ token, user_id, xa_code, year, req_id }) {
  const params = { token, user_id, xa_code, year };
  if (req_id) params.req_id = req_id;
  const result = await get("/dashboard", params);
  return unwrap(result, "Không lấy được dashboard");
}
