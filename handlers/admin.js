"use strict";

// ============================================================
// ADMIN HANDLER
//
// GET  /register                  — trang đăng ký HTML (public, dùng invite link)
// POST /admin/create_invite_link  — tạo link mời cán bộ đăng ký
// POST /register                  — cán bộ tự đăng ký (public, dùng invite link)
// POST /admin/list_pending_users  — xem danh sách chờ duyệt
// POST /admin/approve_user        — phê duyệt + gán role
// POST /admin/reset_password      — reset pass (xác minh SĐT + CCCD)
// ============================================================

const { db, paths, queryAll, serverTimestamp } = require("../utils/firestore");
const { validateToken }                         = require("../middleware/validateToken");
const { checkPermission }                       = require("../middleware/checkPermission");
const { logAudit }                              = require("../middleware/logAudit");
const { successResponse, errorResponse }        = require("../utils/response");
const { createPasswordHash, generateToken }     = require("../utils/crypto");
const { ACTIONS, ERROR_CODES, ROLES }           = require("../utils/constants");

const INVITE_TTL_DAYS = 30;

// ─── Helper: resolve base URL from request ───────────────────
// Works on Cloud Run (where x-forwarded-* headers are set) and locally.
function resolveBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

// ─── POST /admin/create_invite_link ──────────────────────────
async function createInviteLink(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_CREATE_INVITE);

  const { xa_code } = req.body;
  if (!xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  }

  const link_id  = generateToken(16); // 16-char random hex
  const now      = new Date();
  const expires  = new Date(now.getTime() + INVITE_TTL_DAYS * 86400000);

  await db.collection("invite_links").doc(link_id).set({
    link_id,
    xa_code,
    created_by:  user.user_id || user.id,
    created_at:  serverTimestamp(),
    expires_at:  expires,
    used_count:  0,
    is_active:   true,
  });

  await logAudit(user, ACTIONS.ADMIN_CREATE_INVITE, { xa_code, link_id }, req);

  const baseUrl  = resolveBaseUrl(req);
  const deepLink = `communegovernance://register?token=${link_id}`;
  const webLink  = `${baseUrl}/register?token=${link_id}`;

  return successResponse(res, {
    link_id,
    deep_link:  deepLink,
    web_link:   webLink,
    expires_at: expires.toISOString(),
    message:    `Link đăng ký có hiệu lực ${INVITE_TTL_DAYS} ngày. Chia sẻ qua Zalo.`,
  });
}

// ─── POST /register  (public — dùng invite link) ─────────────
async function register(req, res) {
  const {
    link_token,    // invite link_id
    ho_ten,
    phone,
    cccd,
    email,
    chuc_danh,     // tự mô tả: "Trưởng thôn Bình An"
    password,
  } = req.body;

  // ── Input validation ─────────────────────────────────────
  if (!link_token || !ho_ten?.trim() || !phone?.trim() ||
      !cccd?.trim() || !chuc_danh?.trim() || !password) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Vui lòng điền đầy đủ: link_token, ho_ten, phone, cccd, chuc_danh, password");
  }

  const cleanPhone = phone.trim().replace(/\s/g, "");
  const cleanCCCD  = cccd.trim().replace(/\s/g, "");

  if (!/^(0|\+84)\d{9,10}$/.test(cleanPhone)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Số điện thoại không hợp lệ (phải bắt đầu bằng 0 hoặc +84)");
  }
  if (password.length < 6) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Mật khẩu tối thiểu 6 ký tự");
  }

  // ── Validate invite link ──────────────────────────────────
  const linkSnap = await db.collection("invite_links").doc(link_token).get();
  if (!linkSnap.exists) {
    return errorResponse(res, ERROR_CODES.INV_001, "Link đăng ký không hợp lệ");
  }

  const linkData  = linkSnap.data();
  const now       = new Date();
  const expiresAt = linkData.expires_at?.toDate
    ? linkData.expires_at.toDate()
    : new Date(linkData.expires_at);

  if (!linkData.is_active || expiresAt < now) {
    return errorResponse(res, ERROR_CODES.INV_001,
      "Link đăng ký đã hết hạn hoặc không còn hiệu lực");
  }

  const xa_code = linkData.xa_code;

  // ── Check duplicate phone or CCCD ────────────────────────
  const [phoneCheck, cccdCheck] = await Promise.all([
    db.collection("users").where("phone", "==", cleanPhone).limit(1).get(),
    db.collection("users").where("cccd",  "==", cleanCCCD).limit(1).get(),
  ]);

  if (!phoneCheck.empty) {
    return errorResponse(res, ERROR_CODES.INV_002,
      "Số điện thoại này đã được đăng ký");
  }
  if (!cccdCheck.empty) {
    return errorResponse(res, ERROR_CODES.INV_002,
      "Số CCCD này đã được đăng ký");
  }

  // ── Create user (PENDING_APPROVAL) ───────────────────────
  const { hash, salt } = createPasswordHash(password);
  const user_id = `USR_${cleanPhone.replace(/\D/g, "").slice(-8)}`;

  // Ensure unique user_id
  const existing = await db.collection("users").doc(user_id).get();
  const finalId  = existing.exists
    ? `USR_${generateToken(8).toUpperCase()}`
    : user_id;

  await db.collection("users").doc(finalId).set({
    user_id:       finalId,
    ho_ten:        ho_ten.trim(),
    phone:         cleanPhone,
    cccd:          cleanCCCD,
    email:         email?.trim() || null,
    chuc_danh:     chuc_danh.trim(),
    password_hash: hash,
    password_salt: salt,
    xa_code,
    status:        "PENDING_APPROVAL",
    // vai_tro, nhanh, don_vi, linh_vuc_codes → set by Admin on approval
    vai_tro:       null,
    nhanh:         null,
    don_vi:        null,
    linh_vuc_codes: [],
    other_branches: [],
    created_at:    serverTimestamp(),
    invite_link_id: link_token,
  });

  // Increment invite link usage count
  await linkSnap.ref.update({
    used_count: (linkData.used_count || 0) + 1,
  });

  return successResponse(res, {
    user_id:    finalId,
    xa_code,
    status:     "PENDING_APPROVAL",
    message:    "Đăng ký thành công. Tài khoản đang chờ phê duyệt từ Admin xã.",
  });
}

// ─── POST /admin/list_pending_users ──────────────────────────
async function listPendingUsers(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_LIST_PENDING);

  const { xa_code } = req.body;
  if (!xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  }

  // NOTE: Query only by xa_code (single-field index, always available).
  // Filter by status in JS to avoid requiring a Firestore composite index
  // on (xa_code, status). For this app's scale (<500 users/xa) this is fine.
  const allXaUsers = await queryAll(
    db.collection("users").where("xa_code", "==", xa_code)
  );

  const safeList = allXaUsers
    .filter(u => u.status === "PENDING_APPROVAL")
    .map(u => ({
      user_id:    u.user_id   || u.id,
      ho_ten:     u.ho_ten,
      phone:      u.phone,
      cccd:       u.cccd,
      chuc_danh:  u.chuc_danh,
      email:      u.email,
      xa_code:    u.xa_code,
      created_at: u.created_at?.toDate
        ? u.created_at.toDate().toISOString()
        : null,
    }))
    // Sort newest first
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  return successResponse(res, {
    xa_code,
    count: safeList.length,
    users: safeList,
  });
}

// ─── POST /admin/approve_user ─────────────────────────────────
async function approveUser(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_APPROVE_USER);

  const {
    xa_code,
    target_user_id,
    vai_tro,
    nhanh,
    don_vi,
    linh_vuc_codes,
    other_branches,
  } = req.body;

  if (!xa_code || !target_user_id || !vai_tro || !nhanh) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu: xa_code, target_user_id, vai_tro, nhanh");
  }

  const validRoles = Object.values(ROLES);
  if (!validRoles.includes(vai_tro)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `vai_tro không hợp lệ. Chọn một trong: ${validRoles.join(", ")}`);
  }

  const userRef  = db.collection("users").doc(target_user_id);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `Người dùng ${target_user_id} không tồn tại`);
  }

  const userData = userSnap.data();
  if (userData.xa_code !== xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Người dùng này không thuộc xã của bạn");
  }
  if (userData.status === "ACTIVE") {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Người dùng đã được kích hoạt trước đó");
  }

  await userRef.update({
    status:          "ACTIVE",
    vai_tro,
    nhanh,
    don_vi:          don_vi || null,
    linh_vuc_codes:  linh_vuc_codes || [],
    other_branches:  other_branches || [],
    approved_by:     user.user_id || user.id,
    approved_at:     serverTimestamp(),
  });

  await logAudit(user, ACTIONS.ADMIN_APPROVE_USER, {
    xa_code, target_user_id, vai_tro, nhanh, don_vi,
  }, req);

  return successResponse(res, {
    user_id:   target_user_id,
    new_status: "ACTIVE",
    vai_tro,
    nhanh,
    don_vi,
    message:    `Tài khoản ${userData.ho_ten} đã được kích hoạt.`,
  });
}

// ─── POST /admin/reset_password ───────────────────────────────
async function resetPassword(req, res) {
  const admin = await validateToken(req);
  checkPermission(admin, ACTIONS.ADMIN_RESET_PASSWORD);

  const { xa_code, target_user_id, verify_phone, verify_cccd, new_password } = req.body;

  if (!xa_code || !target_user_id || !new_password) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu xa_code, target_user_id hoặc new_password");
  }
  if (new_password.length < 6) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Mật khẩu mới tối thiểu 6 ký tự");
  }

  const userRef  = db.collection("users").doc(target_user_id);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Người dùng không tồn tại");
  }

  const userData = userSnap.data();
  if (userData.xa_code !== xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Người dùng không thuộc xã của bạn");
  }

  // Optionally verify identity if admin provides phone+CCCD
  if (verify_phone || verify_cccd) {
    const phoneOk = !verify_phone ||
      userData.phone === verify_phone.trim().replace(/\s/g, "");
    const cccdOk  = !verify_cccd  ||
      userData.cccd  === verify_cccd.trim().replace(/\s/g, "");

    if (!phoneOk || !cccdOk) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "Số điện thoại hoặc CCCD không khớp — không thể reset mật khẩu");
    }
  }

  const { hash, salt } = createPasswordHash(new_password);
  await userRef.update({
    password_hash: hash,
    password_salt: salt,
    // Invalidate current session
    session_token:    null,
    token_expires_at: null,
    reset_requested_at: null,
  });

  await logAudit(admin, ACTIONS.ADMIN_RESET_PASSWORD, {
    xa_code, target_user_id,
  }, req);

  return successResponse(res, {
    user_id: target_user_id,
    message: `Mật khẩu của ${userData.ho_ten} đã được đặt lại.`,
  });
}

// ─── GET /admin/commune_config ────────────────────────────────
// Trả về cấu hình xã (tên, tỉnh, danh sách thôn, params).
// Nếu chưa setup → trả về object rỗng, is_setup: false
async function getCommuneConfig(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_GET_COMMUNE);

  const xa_code = req.query.xa_code || req.body?.xa_code;
  if (!xa_code) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  }

  const communeSnap = await db.collection("communes").doc(xa_code).get();

  if (!communeSnap.exists) {
    return successResponse(res, {
      xa_code,
      ten_xa:              null,
      tinh:                null,
      danh_sach_thon:      [],
      linh_vuc_active:     [],
      bypass_timeout_days: 5,
      is_setup:            false,
    });
  }

  const d = communeSnap.data();
  return successResponse(res, {
    xa_code:             d.xa_code,
    ten_xa:              d.ten_xa              || null,
    tinh:                d.tinh               || null,
    danh_sach_thon:      d.danh_sach_thon     || [],
    linh_vuc_active:     d.linh_vuc_active    || [],
    bypass_timeout_days: d.bypass_timeout_days || 5,
    is_setup:            !!d.ten_xa,
  });
}

// ─── POST /admin/setup_commune ────────────────────────────────
// Tạo / cập nhật commune document (tên xã, tỉnh, danh sách thôn).
// Admin chạy 1 lần khi onboarding, có thể chạy lại để chỉnh sửa.
async function setupCommune(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_SETUP_COMMUNE);

  const { xa_code, ten_xa, tinh, danh_sach_thon, bypass_timeout_days } = req.body;

  if (!xa_code || !ten_xa?.trim()) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc ten_xa");
  }

  // Normalize thôn list: auto-generate thon_code from ten_thon if missing
  const thonList = (danh_sach_thon || [])
    .map((t, idx) => {
      const tenThon = t.ten_thon?.trim() || "";
      if (!tenThon) return null;
      // Auto-generate thon_code if not provided or empty
      const code = (t.thon_code?.trim())
        || `thon_${tenThon
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/gi, "d")
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
          }_${idx + 1}`;
      return { thon_code: code, ten_thon: tenThon };
    })
    .filter(Boolean);

  const communeRef = db.collection("communes").doc(xa_code);
  const existing   = await communeRef.get();

  const updateData = {
    xa_code,
    ten_xa:              ten_xa.trim(),
    tinh:                tinh?.trim() || null,
    danh_sach_thon:      thonList,
    bypass_timeout_days: Number(bypass_timeout_days) || 5,
    updated_at:          serverTimestamp(),
    updated_by:          user.user_id || user.id,
  };

  if (!existing.exists) {
    Object.assign(updateData, {
      created_at:           serverTimestamp(),
      created_by:           user.user_id || user.id,
      linh_vuc_active:      [],
      invite_link_ttl_days: 30,
      current_year:         new Date().getFullYear(),
      public_results_delay_hours: 0,
    });
  }

  await communeRef.set(updateData, { merge: true });
  await logAudit(user, ACTIONS.ADMIN_SETUP_COMMUNE, {
    xa_code, ten_xa: ten_xa.trim(), thon_count: thonList.length,
  }, req);

  return successResponse(res, {
    xa_code,
    ten_xa:         ten_xa.trim(),
    danh_sach_thon: thonList,
    message:        `Đã lưu cấu hình xã "${ten_xa.trim()}" với ${thonList.length} thôn.`,
  });
}

// ─── GET /admin/commune_config ───────────────────────────────
async function getCommuneConfig(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_GET_COMMUNE);

  const xa_code = req.query.xa_code || req.body?.xa_code;
  if (!xa_code) return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");

  const snap = await db.collection("communes").doc(xa_code).get();
  const data  = snap.exists
    ? snap.data()
    : { xa_code, ten_xa: xa_code, tinh: "", danh_sach_thon: [], bypass_timeout_days: 5 };

  // Convert Firestore timestamps to ISO strings before sending
  const safe = { ...data };
  if (safe.updated_at?.toDate) safe.updated_at = safe.updated_at.toDate().toISOString();
  if (safe.created_at?.toDate) safe.created_at = safe.created_at.toDate().toISOString();

  return successResponse(res, safe);
}

// ─── POST /admin/setup_commune ───────────────────────────────
async function setupCommune(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.ADMIN_SETUP_COMMUNE);

  const { xa_code, ten_xa, tinh, danh_sach_thon, bypass_timeout_days } = req.body;
  if (!xa_code) return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  if (!ten_xa?.trim()) return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu tên xã");

  // Validate & clean danh_sach_thon
  const thonList = (Array.isArray(danh_sach_thon) ? danh_sach_thon : [])
    .filter(t => t?.thon_code?.trim() && t?.ten_thon?.trim())
    .map(t => ({ thon_code: t.thon_code.trim(), ten_thon: t.ten_thon.trim() }));

  const existing = await db.collection("communes").doc(xa_code).get();
  const payload  = {
    xa_code,
    ten_xa:               ten_xa.trim(),
    tinh:                 tinh?.trim() || "",
    danh_sach_thon:       thonList,
    bypass_timeout_days:  Number(bypass_timeout_days) || 5,
    updated_at:           serverTimestamp(),
    updated_by:           user.user_id || user.id,
    // Preserve created_at on first setup
    ...(existing.exists ? {} : { created_at: serverTimestamp(), created_by: user.user_id || user.id }),
  };

  await db.collection("communes").doc(xa_code).set(payload, { merge: true });
  await logAudit(user, ACTIONS.ADMIN_SETUP_COMMUNE,
    { xa_code, ten_xa: ten_xa.trim(), thon_count: thonList.length }, req);

  return successResponse(res, {
    message:    `Đã lưu cấu hình xã "${ten_xa.trim()}" với ${thonList.length} thôn.`,
    xa_code,
    ten_xa:     ten_xa.trim(),
    thon_count: thonList.length,
  });
}

// ─── GET /register?token=XXXX  (public — serves HTML form) ──────
async function registerPage(req, res) {
  const link_token = req.query.token || "";
  const baseUrl    = resolveBaseUrl(req);

  let communeName      = "";
  let xaCode           = "";
  let linkValid        = false;
  let expiredOrInvalid = false;

  if (link_token) {
    try {
      const linkSnap = await db.collection("invite_links").doc(link_token).get();
      if (linkSnap.exists) {
        const linkData  = linkSnap.data();
        const now       = new Date();
        const expiresAt = linkData.expires_at?.toDate
          ? linkData.expires_at.toDate()
          : new Date(linkData.expires_at);

        if (linkData.is_active && expiresAt > now) {
          linkValid = true;
          xaCode    = linkData.xa_code || "";
          // Try to fetch commune display name
          const communeSnap = await db.collection("communes").doc(xaCode).get();
          communeName = communeSnap.exists
            ? (communeSnap.data().ten_xa || xaCode)
            : xaCode;
        } else {
          expiredOrInvalid = true;
        }
      } else {
        expiredOrInvalid = true;
      }
    } catch (_) {
      expiredOrInvalid = true;
    }
  }

  // ── HTML page ──────────────────────────────────────────────
  const statusBlock = !link_token
    ? `<div class="msg warn">⚠️ Link đăng ký không hợp lệ.<br>Vui lòng liên hệ Admin xã để nhận link mới qua Zalo.</div>`
    : expiredOrInvalid
    ? `<div class="msg warn">⚠️ Link đăng ký đã hết hạn hoặc không còn hiệu lực.<br>Vui lòng liên hệ Admin xã để nhận link mới.</div>`
    : "";

  const formBlock = linkValid ? `
    <div class="commune-badge">📍 Đăng ký cho: <strong>${communeName}</strong></div>

    <div id="msgError"  class="msg err"  style="display:none"></div>
    <div id="msgOk"     class="msg ok"   style="display:none">
      <div style="font-size:40px;margin-bottom:8px">✅</div>
      <strong>Đăng ký thành công!</strong><br>
      <span id="okText"></span>
    </div>

    <form id="regForm" onsubmit="handleSubmit(event)">
      <div class="field">
        <label>Họ và tên *</label>
        <input type="text"     name="ho_ten"    placeholder="Nguyễn Văn A"    autocomplete="name" required>
      </div>
      <div class="field">
        <label>Số điện thoại *</label>
        <input type="tel"      name="phone"     placeholder="0912 345 678"    autocomplete="tel" required>
      </div>
      <div class="field">
        <label>Số CCCD *</label>
        <input type="text"     name="cccd"      placeholder="079123456789"    inputmode="numeric" required>
      </div>
      <div class="field">
        <label>Email <span style="font-weight:400;color:#9e9e9e">(không bắt buộc)</span></label>
        <input type="email"    name="email"     placeholder="example@gmail.com" autocomplete="email">
      </div>
      <div class="field">
        <label>Chức danh / Vị trí *</label>
        <input type="text"     name="chuc_danh" placeholder="Ví dụ: Trưởng thôn Bình An" required>
      </div>
      <div class="field">
        <label>Mật khẩu * <span style="font-weight:400;color:#9e9e9e">(tối thiểu 6 ký tự)</span></label>
        <div class="pw-wrap">
          <input type="password" name="password" id="pwInput" placeholder="Đặt mật khẩu của bạn" autocomplete="new-password" required>
          <button type="button" class="pw-eye" onclick="togglePw()" aria-label="Hiện/ẩn mật khẩu">👁</button>
        </div>
      </div>
      <button type="submit" id="submitBtn" class="btn">Gửi đăng ký</button>
    </form>

    <p class="note">Sau khi đăng ký, Admin xã sẽ xem xét và kích hoạt tài khoản. Bạn sẽ nhận thông báo qua Zalo.</p>

    <script>
      const API_BASE   = ${JSON.stringify(baseUrl)};
      const LINK_TOKEN = ${JSON.stringify(link_token)};

      function togglePw() {
        const inp = document.getElementById("pwInput");
        inp.type  = inp.type === "password" ? "text" : "password";
      }

      async function handleSubmit(e) {
        e.preventDefault();
        const btn    = document.getElementById("submitBtn");
        const errDiv = document.getElementById("msgError");
        errDiv.style.display = "none";

        const form     = e.target;
        const ho_ten   = form.ho_ten.value.trim();
        const phone    = form.phone.value.trim();
        const cccd     = form.cccd.value.trim();
        const email    = form.email.value.trim() || null;
        const chucDanh = form.chuc_danh.value.trim();
        const password = form.password.value;

        if (password.length < 6) {
          errDiv.textContent    = "Mật khẩu tối thiểu 6 ký tự";
          errDiv.style.display  = "block";
          return;
        }

        btn.disabled    = true;
        btn.textContent = "Đang gửi…";

        try {
          const resp = await fetch(API_BASE + "/register", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              link_token: LINK_TOKEN,
              ho_ten, phone, cccd, email,
              chuc_danh: chucDanh, password,
            }),
          });
          const data = await resp.json();

          if (data.success) {
            document.getElementById("regForm").style.display = "none";
            document.getElementById("okText").textContent =
              (data.data?.message || "Tài khoản đang chờ Admin phê duyệt.") +
              "\\n\\nVui lòng chờ thông báo qua Zalo.";
            document.getElementById("msgOk").style.display = "block";
          } else {
            errDiv.textContent   = data.message || "Đăng ký thất bại. Vui lòng thử lại.";
            errDiv.style.display = "block";
            btn.disabled    = false;
            btn.textContent = "Gửi đăng ký";
          }
        } catch (_) {
          errDiv.textContent   = "Lỗi kết nối. Kiểm tra mạng và thử lại.";
          errDiv.style.display = "block";
          btn.disabled    = false;
          btn.textContent = "Gửi đăng ký";
        }
      }
    </script>` : "";

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta name="theme-color" content="#1B5E20">
  <title>Đăng ký tài khoản — Village Linker</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Roboto',sans-serif;background:#1B5E20;min-height:100vh;-webkit-text-size-adjust:100%}
    .header{background:#1B5E20;padding:36px 20px 24px;text-align:center}
    .logo{width:72px;height:72px;background:rgba(255,255,255,.2);border-radius:36px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:12px}
    .app-name{color:#fff;font-size:22px;font-weight:700;letter-spacing:-.3px}
    .app-sub{color:rgba(255,255,255,.8);font-size:13px;margin-top:4px}
    .card{background:#fff;border-radius:20px;margin:0 14px 28px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    .commune-badge{background:#E8F5E9;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:14px;color:#1B5E20}
    .msg{border-radius:10px;padding:16px;margin-bottom:16px;font-size:14px;line-height:1.5;text-align:center}
    .msg.warn{background:#FFF3E0;color:#E65100}
    .msg.err{background:#FFEBEE;color:#C62828;text-align:left}
    .msg.ok{background:#E8F5E9;color:#1B5E20}
    .field{margin-bottom:16px}
    label{display:block;font-size:14px;font-weight:600;color:#212121;margin-bottom:6px}
    input{width:100%;border:1.5px solid #E0E0E0;border-radius:10px;padding:14px 12px;font-size:16px;color:#212121;outline:none;-webkit-appearance:none;transition:border-color .2s}
    input:focus{border-color:#1B5E20}
    .pw-wrap{position:relative}
    .pw-wrap input{padding-right:48px}
    .pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:18px;cursor:pointer;padding:4px;line-height:1}
    .btn{width:100%;background:#1B5E20;color:#fff;border:none;border-radius:10px;height:56px;font-size:17px;font-weight:700;cursor:pointer;margin-top:8px;-webkit-tap-highlight-color:transparent;transition:opacity .2s}
    .btn:disabled{opacity:.6}
    .note{color:#9E9E9E;font-size:12px;text-align:center;margin-top:20px;line-height:1.6;padding:0 4px}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🏡</div>
    <div class="app-name">Village Linker</div>
    <div class="app-sub">Kết nối thôn bản — CARE International Việt Nam</div>
  </div>
  <div class="card">
    ${statusBlock}
    ${formBlock}
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "DENY");
  return res.send(html);
}

module.exports = {
  createInviteLink,
  register,
  registerPage,
  getCommuneConfig,
  setupCommune,
  listPendingUsers,
  approveUser,
  resetPassword,
};
