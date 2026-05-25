#!/usr/bin/env node
/**
 * seed_test_data.js — Run once to create all Firestore test data
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

function generateSalt()        { return crypto.randomBytes(16).toString("hex"); }
function hashPassword(p, s)    { return crypto.createHash("sha256").update(p + s).digest("hex"); }
function generateToken()       { return crypto.randomBytes(32).toString("hex"); }

const XA_CODE   = "XATEST";
const YEAR      = 2025;
const THON_CODE = "THON01";

const USERS = [
  {
    user_id: "USR_THON01", password: "Test@1234",
    ho_ten:  "Nguyễn Văn Test",
    vai_tro: "CB_THON", don_vi: THON_CODE, nhanh: "UBND",
    linh_vuc_codes: null,
  },
  {
    user_id: "USR_CBCM01", password: "Test@1234",
    ho_ten:  "Lê Thị Chuyên Môn",
    vai_tro: "CB_CHUYEN_MON", don_vi: "PHONG_NONG_NGHIEP", nhanh: "UBND",
    linh_vuc_codes: ["NONG_NGHIEP", "XA_HOI"],  // R3: only these lĩnh vực
  },
  {
    user_id: "USR_LANHDAO", password: "Test@1234",
    ho_ten:  "Trần Thị Lãnh Đạo",
    vai_tro: "LANH_DAO", don_vi: "XA", nhanh: "UBND",
    linh_vuc_codes: null,
  },
];

const INDICATORS = [
  {
    chi_so_id: "CS001", ten_chi_so: "Diện tích lúa",
    mo_ta: "Tổng diện tích canh tác lúa trong thôn",
    don_vi_do: "ha", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND",
    validation: { required: true, min: 0, max: 10000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS002", ten_chi_so: "Số hộ nghèo",
    mo_ta: "Số hộ được xếp loại nghèo trong thôn",
    don_vi_do: "hộ", kieu_du_lieu: "so", linh_vuc: "XA_HOI",
    nhanh: "UBND",
    validation: { required: true, min: 0, max: 1000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS003", ten_chi_so: "Có đường bê tông",
    mo_ta: "Thôn có đường bê tông liên thôn không",
    don_vi_do: null, kieu_du_lieu: "boolean", linh_vuc: "CO_SO_HA_TANG",
    nhanh: "UBND",
    validation: { required: true }, status: "ACTIVE",
  },
  {
    // DRAFT indicator — for approve test (T02 in test_indicators.js)
    chi_so_id: "CS_DRAFT01", ten_chi_so: "Số lượng ao cá",
    mo_ta: "Tổng số ao nuôi cá trong thôn",
    don_vi_do: "ao", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND",
    validation: { required: true, min: 0, max: 500 }, status: "DRAFT",
  },
];

async function seed() {
  console.log("\n═══════════════════════════════════════");
  console.log("  Seeding Firestore test data");
  console.log(`  Xã: ${XA_CODE}  |  Năm: ${YEAR}`);
  console.log("═══════════════════════════════════════\n");

  const batch = db.batch();
  const now   = Timestamp.now();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

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
    console.log(`✅ users/${u.user_id}  (${u.vai_tro})  pw: ${u.password}`);
  }

  // ── indicators ─────────────────────────────────────────────
  for (const ind of INDICATORS) {
    batch.set(
      db.collection("communes").doc(XA_CODE)
        .collection("indicators").doc(ind.chi_so_id),
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
      db.collection("communes").doc(XA_CODE)
        .collection("requests").doc(r.req_id),
      { ...r, manifest_version: manifestVersion, created_at: now, year: YEAR }
    );
  }
  console.log("✅ requests: REQ001 (OPEN), REQ002 (COMPLETED), REQ003 (OPEN/THON02 only)");

  // ── manifest ───────────────────────────────────────────────
  const activeIndicators = INDICATORS.filter(i => i.status === "ACTIVE");
  const openRequests     = requests.filter(r => r.status === "OPEN");

  batch.set(
    db.collection("communes").doc(XA_CODE)
      .collection("manifests").doc("current"),
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
═══════════════════════════════════════
  DONE. CONFIG cho test scripts:
═══════════════════════════════════════

  CB_THON  : USR_THON01  / Test@1234
  CB_CM    : USR_CBCM01  / Test@1234  (linh_vuc: NONG_NGHIEP, XA_HOI)
  LANH_DAO : USR_LANHDAO / Test@1234

  OPEN_REQ_ID   : REQ001
  CLOSED_REQ_ID : REQ002
  PERM_REQ_ID   : REQ003
  CHI_SO_IDS    : CS001, CS002, CS003
  DRAFT_IND     : CS_DRAFT01  (dùng cho approve test)
═══════════════════════════════════════
`);
}

seed().then(() => process.exit(0))
      .catch(err => { console.error("❌ Seed failed:", err.message); process.exit(1); });