"use strict";

// ============================================================
// SUPER_ADMIN HANDLER
//
// POST /super-admin/create_commune   — Khởi tạo xã mới
// POST /super-admin/bootstrap_link   — Tạo bootstrap link (Admin đầu tiên/xã)
// GET  /super-admin/communes         — Danh sách xã + trạng thái
//
// GET  /bootstrap?token=XXX          — Trang HTML đăng ký Admin
// POST /bootstrap/register           — API đăng ký Admin qua bootstrap link
// ============================================================

const { db, serverTimestamp, queryAll } = require("../utils/firestore");
const { validateToken }                 = require("../middleware/validateToken");
const { checkPermission }               = require("../middleware/checkPermission");
const { logAudit }                      = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const { createPasswordHash, generateToken } = require("../utils/crypto");
const { ACTIONS, ERROR_CODES, ROLES }   = require("../utils/constants");

const BOOTSTRAP_TTL_DAYS = 7;

// ─── Helper: resolve base URL ─────────────────────────────────
function resolveBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

// ─── POST /super-admin/create_commune ────────────────────────
async function createCommune(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.SUPER_ADMIN_CREATE_COMMUNE);

  const { xa_code, ten_xa, tinh } = req.body;
  if (!xa_code?.trim() || !ten_xa?.trim()) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc ten_xa");
  }

  const cleanCode = xa_code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const docRef    = db.collection("communes").doc(cleanCode);
  const existing  = await docRef.get();

  if (existing.exists) {
    return errorResponse(res, ERROR_CODES.COMMUNE_EXISTS,
      `Xã ${cleanCode} đã tồn tại trong hệ thống`);
  }

  const payload = {
    xa_code:              cleanCode,
    ten_xa:               ten_xa.trim(),
    tinh:                 tinh?.trim() || "",
    danh_sach_thon:       [],
    bypass_timeout_days:  5,
    created_at:           serverTimestamp(),
    created_by:           user.user_id || user.id,
    has_admin:            false, // Flag: Admin đầu tiên đã đăng ký chưa
  };

  await docRef.set(payload);
  await logAudit(user, ACTIONS.SUPER_ADMIN_CREATE_COMMUNE, { xa_code: cleanCode, ten_xa: ten_xa.trim() }, req);

  return successResponse(res, {
    message:  `Đã tạo xã "${ten_xa.trim()}" (${cleanCode}).`,
    xa_code:  cleanCode,
    ten_xa:   ten_xa.trim(),
  });
}

// ─── POST /super-admin/bootstrap_link ────────────────────────
async function createBootstrapLink(req, res) {
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.SUPER_ADMIN_BOOTSTRAP_LINK);

  const { xa_code } = req.body;
  if (!xa_code?.trim()) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code");
  }

  // Commune must exist
  const communeSnap = await db.collection("communes").doc(xa_code).get();
  if (!communeSnap.exists) {
    return errorResponse(res, ERROR_CODES.NOT_FOUND,
      `Xã ${xa_code} chưa tồn tại. Tạo xã trước bằng /super-admin/create_commune`);
  }

  const link_id  = generateToken(20);
  const now      = new Date();
  const expires  = new Date(now.getTime() + BOOTSTRAP_TTL_DAYS * 86400000);

  await db.collection("bootstrap_links").doc(link_id).set({
    link_id,
    xa_code,
    created_by:  user.user_id || user.id,
    created_at:  serverTimestamp(),
    expires_at:  expires,
    is_active:   true,
    used:        false,
    used_by:     null,
    used_at:     null,
  });

  await logAudit(user, ACTIONS.SUPER_ADMIN_BOOTSTRAP_LINK, { xa_code, link_id }, req);

  const baseUrl   = resolveBaseUrl(req);
  const webLink   = `${baseUrl}/bootstrap?token=${link_id}`;
  const communeData = communeSnap.data();

  return successResponse(res, {
    link_id,
    xa_code,
    ten_xa:     communeData.ten_xa,
    web_link:   webLink,
    expires_at: expires.toISOString(),
    message:    `Link Admin đầu tiên cho ${communeData.ten_xa}. Hiệu lực ${BOOTSTRAP_TTL_DAYS} ngày. Chỉ dùng được 1 lần.`,
  });
}

// ─── GET /super-admin/communes ────────────────────────────────
async function listCommunes(req, res) {
  // token + user_id may be in query string for GET
  if (req.query.token) {
    req.body = { ...req.body, ...req.query };
  }
  const user = await validateToken(req);
  checkPermission(user, ACTIONS.SUPER_ADMIN_LIST_COMMUNES);

  const communes = await queryAll(db.collection("communes").orderBy("created_at", "desc"));

  const safe = communes.map(c => ({
    xa_code:     c.xa_code,
    ten_xa:      c.ten_xa,
    tinh:        c.tinh,
    has_admin:   c.has_admin || false,
    thon_count:  (c.danh_sach_thon || []).length,
    created_at:  c.created_at?.toDate ? c.created_at.toDate().toISOString() : null,
  }));

  return successResponse(res, { count: safe.length, communes: safe });
}

// ─── GET /bootstrap?token=XXX — HTML registration page ───────
async function bootstrapPage(req, res) {
  const link_token = req.query.token || "";
  const baseUrl    = resolveBaseUrl(req);

  let communeName      = "";
  let xaCode           = "";
  let linkValid        = false;
  let alreadyUsed      = false;
  let expiredOrInvalid = false;

  if (link_token) {
    try {
      const linkSnap = await db.collection("bootstrap_links").doc(link_token).get();
      if (linkSnap.exists) {
        const ld  = linkSnap.data();
        const now = new Date();
        const exp = ld.expires_at?.toDate ? ld.expires_at.toDate() : new Date(ld.expires_at);

        if (ld.used) {
          alreadyUsed = true;
        } else if (!ld.is_active || exp < now) {
          expiredOrInvalid = true;
        } else {
          linkValid = true;
          xaCode    = ld.xa_code;
          const cs  = await db.collection("communes").doc(xaCode).get();
          communeName = cs.exists ? (cs.data().ten_xa || xaCode) : xaCode;
        }
      } else {
        expiredOrInvalid = true;
      }
    } catch (_) {
      expiredOrInvalid = true;
    }
  }

  const statusBlock = !link_token
    ? `<div class="msg warn">⚠️ Link không hợp lệ. Vui lòng liên hệ CARE Vietnam để nhận link mới.</div>`
    : alreadyUsed
    ? `<div class="msg warn">⚠️ Link này đã được sử dụng để tạo tài khoản Admin.<br>Mỗi link chỉ dùng được một lần. Vui lòng đăng nhập bằng tài khoản đã tạo.</div>`
    : expiredOrInvalid
    ? `<div class="msg warn">⚠️ Link đã hết hạn hoặc không còn hiệu lực.<br>Vui lòng liên hệ CARE Vietnam để nhận link mới.</div>`
    : "";

  const formBlock = linkValid ? `
    <div class="commune-badge">
      <span class="badge-icon">🏛️</span>
      <div>
        <div class="badge-label">Đăng ký tài khoản QUẢN TRỊ VIÊN cho</div>
        <div class="badge-xa">${communeName}</div>
      </div>
    </div>

    <div id="msgError" class="msg err" style="display:none"></div>
    <div id="msgOk"    class="msg ok"  style="display:none">
      <div style="font-size:44px;margin-bottom:12px">✅</div>
      <strong style="font-size:18px">Tài khoản Admin đã được tạo!</strong><br>
      <span id="okText" style="font-size:14px;line-height:1.6"></span>
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
        <label>Email <span class="opt">(không bắt buộc)</span></label>
        <input type="email"    name="email"     placeholder="example@gmail.com" autocomplete="email">
      </div>
      <div class="field">
        <label>Chức danh / Vị trí *</label>
        <input type="text"     name="chuc_danh" placeholder="Trưởng Văn phòng UBND" required>
      </div>
      <div class="field">
        <label>Mật khẩu * <span class="opt">(tối thiểu 6 ký tự)</span></label>
        <div class="pw-wrap">
          <input type="password" name="password" id="pwInput" placeholder="Đặt mật khẩu" autocomplete="new-password" required>
          <button type="button" class="pw-eye" onclick="togglePw()">👁</button>
        </div>
      </div>
      <button type="submit" id="submitBtn" class="btn">Đăng ký tài khoản Admin</button>
    </form>

    <div class="admin-note">
      <strong>Lưu ý quan trọng:</strong> Tài khoản này có quyền Quản trị viên (Admin) xã.
      Sau khi đăng ký thành công, bạn có thể đăng nhập ngay vào ứng dụng và bắt đầu khởi tạo hệ thống cho xã.
    </div>

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
          errDiv.textContent   = "Mật khẩu tối thiểu 6 ký tự";
          errDiv.style.display = "block";
          return;
        }

        btn.disabled    = true;
        btn.textContent = "Đang tạo tài khoản…";

        try {
          const resp = await fetch(API_BASE + "/bootstrap/register", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ link_token: LINK_TOKEN, ho_ten, phone, cccd, email, chuc_danh: chucDanh, password }),
          });
          const data = await resp.json();

          if (data.success) {
            document.getElementById("regForm").style.display = "none";
            document.querySelector(".admin-note").style.display = "none";
            document.getElementById("okText").innerHTML =
              (data.data?.message || "Tài khoản Admin đã được kích hoạt.") +
              "<br><br>Mở ứng dụng Village Linker và đăng nhập bằng số điện thoại và mật khẩu vừa tạo.";
            document.getElementById("msgOk").style.display = "block";
          } else {
            errDiv.textContent   = data.message || "Đăng ký thất bại. Vui lòng thử lại.";
            errDiv.style.display = "block";
            btn.disabled    = false;
            btn.textContent = "Đăng ký tài khoản Admin";
          }
        } catch (_) {
          errDiv.textContent   = "Lỗi kết nối. Kiểm tra mạng và thử lại.";
          errDiv.style.display = "block";
          btn.disabled    = false;
          btn.textContent = "Đăng ký tài khoản Admin";
        }
      }
    </script>` : "";

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta name="theme-color" content="#1B5E20">
  <title>Đăng ký Admin — Village Linker</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Roboto',sans-serif;background:#1B5E20;min-height:100vh;-webkit-text-size-adjust:100%}
    .header{background:#1B5E20;padding:32px 20px 24px;text-align:center}
    .logo{width:72px;height:72px;background:rgba(255,255,255,.2);border-radius:36px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:12px}
    .app-name{color:#fff;font-size:22px;font-weight:700}
    .app-sub{color:rgba(255,255,255,.8);font-size:13px;margin-top:4px}
    .card{background:#fff;border-radius:20px;margin:0 14px 28px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    .commune-badge{background:#E8F5E9;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px}
    .badge-icon{font-size:28px;flex-shrink:0}
    .badge-label{font-size:12px;color:#388E3C;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
    .badge-xa{font-size:18px;font-weight:700;color:#1B5E20;margin-top:2px}
    .msg{border-radius:10px;padding:16px;margin-bottom:16px;font-size:14px;line-height:1.6;text-align:center}
    .msg.warn{background:#FFF3E0;color:#E65100;text-align:left}
    .msg.err{background:#FFEBEE;color:#C62828;text-align:left}
    .msg.ok{background:#E8F5E9;color:#1B5E20}
    .field{margin-bottom:16px}
    label{display:block;font-size:14px;font-weight:600;color:#212121;margin-bottom:6px}
    .opt{font-weight:400;color:#9E9E9E}
    input{width:100%;border:1.5px solid #E0E0E0;border-radius:10px;padding:14px 12px;font-size:16px;color:#212121;outline:none;-webkit-appearance:none;transition:border-color .2s}
    input:focus{border-color:#1B5E20}
    .pw-wrap{position:relative}
    .pw-wrap input{padding-right:48px}
    .pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:18px;cursor:pointer;padding:4px}
    .btn{width:100%;background:#1B5E20;color:#fff;border:none;border-radius:10px;height:56px;font-size:17px;font-weight:700;cursor:pointer;margin-top:8px;-webkit-tap-highlight-color:transparent;transition:opacity .2s}
    .btn:disabled{opacity:.6}
    .admin-note{background:#E3F2FD;border-radius:10px;padding:14px 16px;margin-top:16px;font-size:13px;color:#1565C0;line-height:1.6}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🏛️</div>
    <div class="app-name">Village Linker — Quản trị viên</div>
    <div class="app-sub">CARE International Việt Nam</div>
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

// ─── POST /bootstrap/register ────────────────────────────────
// Creates ADMIN user directly — no approval needed — invalidates bootstrap link
async function bootstrapRegister(req, res) {
  const { link_token, ho_ten, phone, cccd, email, chuc_danh, password } = req.body;

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
    return errorResponse(res, ERROR_CODES.DATA_001, "Mật khẩu tối thiểu 6 ký tự");
  }

  // ── Validate bootstrap link ─────────────────────────────
  const linkRef  = db.collection("bootstrap_links").doc(link_token);
  const linkSnap = await linkRef.get();

  if (!linkSnap.exists) {
    return errorResponse(res, ERROR_CODES.BOOTSTRAP_INVALID, "Link không tồn tại");
  }

  const ld  = linkSnap.data();
  const now = new Date();
  const exp = ld.expires_at?.toDate ? ld.expires_at.toDate() : new Date(ld.expires_at);

  if (ld.used) {
    return errorResponse(res, ERROR_CODES.BOOTSTRAP_USED,
      "Link này đã được sử dụng để tạo tài khoản Admin. Mỗi link chỉ dùng được một lần.");
  }
  if (!ld.is_active || exp < now) {
    return errorResponse(res, ERROR_CODES.BOOTSTRAP_EXPIRED,
      "Link đã hết hạn hoặc không còn hiệu lực. Vui lòng liên hệ CARE Vietnam để nhận link mới.");
  }

  const xa_code = ld.xa_code;

  // ── Check duplicate phone/CCCD ──────────────────────────
  const [phoneCheck, cccdCheck] = await Promise.all([
    db.collection("users").where("phone", "==", cleanPhone).limit(1).get(),
    db.collection("users").where("cccd",  "==", cleanCCCD).limit(1).get(),
  ]);
  if (!phoneCheck.empty) {
    return errorResponse(res, ERROR_CODES.INV_002, "Số điện thoại này đã được đăng ký");
  }
  if (!cccdCheck.empty) {
    return errorResponse(res, ERROR_CODES.INV_002, "Số CCCD này đã được đăng ký");
  }

  // ── Create ADMIN user — ACTIVE immediately ───────────────
  const { hash, salt } = createPasswordHash(password);
  const base_id   = `ADM_${cleanPhone.replace(/\D/g, "").slice(-8)}`;
  const existsSnap = await db.collection("users").doc(base_id).get();
  const user_id    = existsSnap.exists ? `ADM_${generateToken(8).toUpperCase()}` : base_id;

  await db.runTransaction(async (tx) => {
    // Create user
    tx.set(db.collection("users").doc(user_id), {
      user_id,
      ho_ten:        ho_ten.trim(),
      phone:         cleanPhone,
      cccd:          cleanCCCD,
      email:         email?.trim() || null,
      chuc_danh:     chuc_danh.trim(),
      password_hash: hash,
      password_salt: salt,
      vai_tro:       ROLES.ADMIN,
      status:        "ACTIVE",         // ← Auto-active, no approval needed
      xa_code,
      nhanh:         null,             // ADMIN is cross-nhanh
      don_vi:        null,
      linh_vuc_codes: [],
      other_branches: [],
      bootstrap_link_id: link_token,  // Audit trail
      created_at:    serverTimestamp(),
    });

    // Invalidate bootstrap link
    tx.update(linkRef, {
      used:     true,
      used_by:  user_id,
      used_at:  serverTimestamp(),
      is_active: false,
    });

    // Mark commune as having an Admin
    tx.update(db.collection("communes").doc(xa_code), {
      has_admin:       true,
      first_admin_id:  user_id,
      first_admin_at:  serverTimestamp(),
    });
  });

  return successResponse(res, {
    user_id,
    xa_code,
    vai_tro: ROLES.ADMIN,
    status:  "ACTIVE",
    message: `Tài khoản Admin xã đã được tạo thành công. Đăng nhập bằng số điện thoại ${cleanPhone} và mật khẩu vừa tạo.`,
  });
}

module.exports = {
  createCommune,
  createBootstrapLink,
  listCommunes,
  bootstrapPage,
  bootstrapRegister,
};
