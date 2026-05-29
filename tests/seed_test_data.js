#!/usr/bin/env node
/**
 * seed_test_data.js — Reset & seed all Firestore test data
 * v2: clears submissions first, then seeds with realistic test state
 * Usage: node tests/seed_test_data.js
 */
"use strict";

const admin  = require("firebase-admin");
const crypto = require("crypto");
const path   = require("path");

const serviceAccount = require(path.join(__dirname, "../service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db        = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

function generateSalt()     { return crypto.randomBytes(16).toString("hex"); }
function hashPassword(p, s) { return crypto.createHash("sha256").update(p + s).digest("hex"); }
function generateToken()    { return crypto.randomBytes(32).toString("hex"); }

const XA_CODE   = "XATEST";
const YEAR      = 2025;
const THON_CODE = "THON01";

const USERS = [
  {
    user_id: "USR_THON01", password: "Test@1234",
    ho_ten: "Nguyễn Văn Test",
    vai_tro: "CB_THON", don_vi: THON_CODE, nhanh: "UBND",
    linh_vuc_codes: null,
  },
  {
    user_id: "USR_CBCM01", password: "Test@1234",
    ho_ten: "Lê Thị Chuyên Môn",
    vai_tro: "CB_CHUYEN_MON", don_vi: "PHONG_NONG_NGHIEP", nhanh: "UBND",
    linh_vuc_codes: ["NONG_NGHIEP", "XA_HOI"],
  },
  {
    user_id: "USR_LANHDAO", password: "Test@1234",
    ho_ten: "Trần Thị Lãnh Đạo",
    vai_tro: "LANH_DAO", don_vi: "XA", nhanh: "UBND",
    linh_vuc_codes: null,
  },
];

const INDICATORS = [
  {
    chi_so_id: "CS001", ten_chi_so: "Diện tích lúa",
    mo_ta: "Tổng diện tích canh tác lúa trong thôn",
    don_vi_do: "ha", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND", validation: { required: true, min: 0, max: 10000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS002", ten_chi_so: "Số hộ nghèo",
    mo_ta: "Số hộ được xếp loại nghèo trong thôn",
    don_vi_do: "hộ", kieu_du_lieu: "so", linh_vuc: "XA_HOI",
    nhanh: "UBND", validation: { required: true, min: 0, max: 1000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS003", ten_chi_so: "Có đường bê tông",
    mo_ta: "Thôn có đường bê tông liên thôn không",
    don_vi_do: null, kieu_du_lieu: "boolean", linh_vuc: "CO_SO_HA_TANG",
    nhanh: "UBND", validation: { required: true }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS_DRAFT01", ten_chi_so: "Số lượng ao cá",
    mo_ta: "Tổng số ao nuôi cá trong thôn",
    don_vi_do: "ao", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND", validation: { required: true, min: 0, max: 500 }, status: "DRAFT",
  },
];

// ── Helper: delete entire subcollection ──────────────────────
async function deleteCollection(collRef) {
  const snap = await collRef.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function seed() {
  console.log("\n═══════════════════════════════════════");
  console.log("  Seeding Firestore test data  v2");
  console.log(`  Xã: ${XA_CODE}  |  Năm: ${YEAR}`);
  console.log("═══════════════════════════════════════\n");

  const now       = Timestamp.now();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  // ── Step 0: Clear submissions (data sạch để demo) ──────────
  console.log("🗑  Clearing old submissions...");
  const deleted = await deleteCollection(
    db.collection("communes").doc(XA_CODE).collection("submissions")
  );
  console.log(`   Deleted ${deleted} old submission(s)\n`);

  const batch = db.batch();

  // ── xa_registry ────────────────────────────────────────────
  batch.set(db.collection("xa_registry").doc(XA_CODE), {
    xa_code: XA_CODE, xa_name: "Xã Test", tinh: "Quảng Trị",
    gmail_xa: "test.xa@gmail.com",
    drive_folder_id: "TEST_DRIVE_FOLDER",
    sheets_id: "TEST_SHEETS_ID",
    status: "ACTIVE", created_at: now,
  });
  console.log("✅ xa_registry/XATEST");

  // ── users ──────────────────────────────────────────────────
  for (const u of USERS) {
    const salt  = generateSalt();
    const hash  = hashPassword(u.password, salt);
    const token = generateToken();
    batch.set(db.collection("users").doc(u.user_id), {
      user_id: u.user_id, xa_code: XA_CODE,
      ho_ten: u.ho_ten, vai_tro: u.vai_tro,
      don_vi: u.don_vi, nhanh: u.nhanh,
      linh_vuc_codes: u.linh_vuc_codes,
      password_hash: hash, password_salt: salt,
      session_token: token, token_expires_at: expiresAt,
      status: "ACTIVE", last_login_at: now,
    });
    console.log(`✅ users/${u.user_id}  (${u.vai_tro})`);
  }

  // ── indicators ─────────────────────────────────────────────
  for (const ind of INDICATORS) {
    batch.set(
      db.collection("communes").doc(XA_CODE).collection("indicators").doc(ind.chi_so_id),
      {
        ...ind,
        created_by:  "USR_LANHDAO",
        approved_by: ind.status === "ACTIVE" ? "USR_LANHDAO" : null,
        approved_at: ind.status === "ACTIVE" ? now : null,
        created_at: now, updated_at: now, year: YEAR,
      }
    );
  }
  console.log(`✅ indicators: ${INDICATORS.map(i => i.chi_so_id).join(", ")}`);

  // ── requests ───────────────────────────────────────────────
  const manifestVersion = `v${new Date().toISOString().replace(/[-:T]/g,"").substring(0,15)}`;

  const requests = [
    {
      req_id: "REQ001", tieu_de: "Báo cáo nông nghiệp Q2/2025",
      tao_boi: "USR_LANHDAO",
      danh_sach_thon: [THON_CODE, "THON02"],
      chi_so_ids: ["CS001", "CS002", "CS003"],
      deadline: "2025-12-31", ghi_chu: "Số liệu tính đến cuối năm 2025",
      status: "OPEN",
    },
    {
      req_id: "REQ002", tieu_de: "Báo cáo đã đóng Q1/2025",
      tao_boi: "USR_LANHDAO", danh_sach_thon: [THON_CODE],
      chi_so_ids: ["CS001"], deadline: "2025-03-31",
      ghi_chu: "Request này đã đóng", status: "COMPLETED",
    },
    {
      req_id: "REQ003", tieu_de: "Báo cáo chỉ cho THON02",
      tao_boi: "USR_LANHDAO", danh_sach_thon: ["THON02"],
      chi_so_ids: ["CS001"], deadline: "2025-12-31",
      ghi_chu: "Dùng để test PERM_002", status: "OPEN",
    },
  ];

  for (const r of requests) {
    batch.set(
      db.collection("communes").doc(XA_CODE).collection("requests").doc(r.req_id),
      { ...r, manifest_version: manifestVersion, created_at: now, year: YEAR }
    );
  }
  console.log("✅ requests: REQ001 (OPEN), REQ002 (COMPLETED), REQ003 (OPEN/THON02 only)");

  // ── submissions — trạng thái demo ──────────────────────────
  // SUB001: THON01/REQ001 → PENDING_VERIFY  ← CB_CM + LANH_DAO thấy ngay
  // SUB002: THON02/REQ001 → NEEDS_REVISION  ← test "cần sửa" flow
  const submittedAt = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2h ago

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("submissions").doc("SUB001"),
    {
      submission_id: "SUB001",
      req_id: "REQ001", thon_code: "THON01",
      submitted_by: "USR_THON01",
      submitted_at: submittedAt,
      device_collected_at: submittedAt,
      values: { CS001: 45.5, CS002: 12, CS003: true },
      anh_urls: [],
      status: "PENDING_VERIFY",
      verified_by: null, verified_at: null,
      rejection_reason: null,
      indicator_reviews: {},
      manifest_version_used: manifestVersion,
      year: YEAR,
    }
  );

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("submissions").doc("SUB002"),
    {
      submission_id: "SUB002",
      req_id: "REQ001", thon_code: "THON02",
      submitted_by: "USR_THON02",
      submitted_at: Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000)), // 1 day ago
      device_collected_at: Timestamp.fromDate(new Date(Date.now() - 25 * 60 * 60 * 1000)),
      values: { CS001: 30.0, CS002: 8, CS003: false },
      anh_urls: [],
      status: "NEEDS_REVISION",
      verified_by: "USR_CBCM01",
      verified_at: Timestamp.fromDate(new Date(Date.now() - 12 * 60 * 60 * 1000)),
      rejection_reason: "Số liệu diện tích lúa có vẻ thấp bất thường, đề nghị kiểm tra lại.",
      indicator_reviews: { CS001: { status: "rejected", comment: "Cần xác minh lại" } },
      manifest_version_used: manifestVersion,
      year: YEAR,
    }
  );
  console.log("✅ submissions: SUB001 (THON01/PENDING_VERIFY), SUB002 (THON02/NEEDS_REVISION)");

  // ── manifest ───────────────────────────────────────────────
  const activeIndicators = INDICATORS.filter(i => i.status === "ACTIVE");
  const openRequests     = requests.filter(r => r.status === "OPEN");

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("manifests").doc("current"),
    {
      version: manifestVersion, generated_at: now,
      xa_code: XA_CODE, xa_name: "Xã Test", year: YEAR,
      indicators: activeIndicators.map(({ chi_so_id, ten_chi_so, mo_ta,
                                          don_vi_do, kieu_du_lieu, linh_vuc, validation }) => ({
        chi_so_id, ten_chi_so, mo_ta, don_vi_do, kieu_du_lieu, linh_vuc, validation,
      })),
      requests: openRequests.map(({ req_id, tieu_de, chi_so_ids,
                                    danh_sach_thon, deadline, ghi_chu, tao_boi }) => ({
        req_id, tieu_de, chi_so_ids, danh_sach_thon, deadline, ghi_chu, tao_boi,
      })),
      drive_folder_id: "TEST_DRIVE_FOLDER",
    }
  );
  console.log(`✅ manifests/current  (version: ${manifestVersion})`);

  await batch.commit();

  console.log(`
═══════════════════════════════════════════════════════
  DONE — Trạng thái demo sau seed:
═══════════════════════════════════════════════════════

  CB_THON  (USR_THON01 / Test@1234):
    → Thấy REQ001, has_submitted = TRUE (SUB001 tồn tại)
    → Có thể resubmit nếu bị từ chối

  CB_CM  (USR_CBCM01 / Test@1234):
    → pending_verifications: 2 items
       • SUB001 THON01 → PENDING_VERIFY  (cần xét duyệt)
       • SUB002 THON02 → NEEDS_REVISION  (đã từ chối, chờ CB_THON sửa)

  LANH_DAO  (USR_LANHDAO / Test@1234):
    → Cần duyệt: 2, tiến độ REQ001: 0/2 verified
    → Có thể bypass verify SUB001 hoặc SUB002

═══════════════════════════════════════════════════════
`);
}

seed().then(() => process.exit(0))
      .catch(err => { console.error("❌ Seed failed:", err.message); process.exit(1); });