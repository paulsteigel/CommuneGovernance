"use strict";

// ============================================================
// ADMIN HANDLER
//
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
const { createPasswordHash, generateToken }           = require("../utils/crypto");
const { ACTIONS, ERROR_CODES, ROLES }           = require("../utils/constants");

const INVITE_TTL_DAYS = 30;

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

  const deepLink  = `communegovernance://register?token=${link_id}`;
  const webLink   = `https://app.communegovernance.vn/register?token=${link_id}`;

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

  const pending = await queryAll(
    db.collection("users")
      .where("xa_code", "==", xa_code)
      .where("status",  "==", "PENDING_APPROVAL")
  );

  const safeList = pending.map(u => ({
    user_id:   u.user_id,
    ho_ten:    u.ho_ten,
    phone:     u.phone,
    cccd:      u.cccd,
    chuc_danh: u.chuc_danh,
    email:     u.email,
    xa_code:   u.xa_code,
    created_at: u.created_at?.toDate
      ? u.created_at.toDate().toISOString()
      : null,
  }));

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

module.exports = {
  createInviteLink,
  register,
  listPendingUsers,
  approveUser,
  resetPassword,
};
