#!/usr/bin/env node
/**
 * seed_test_data.js
 * Run once to create all Firestore test data needed for test_push_data.js
 *
 * Usage:
 *   node tests/seed_test_data.js
 *
 * Creates:
 *   - 1 xã:       XATEST
 *   - 2 users:    USR_THON01 (CB_THON), USR_LANHDAO (LANH_DAO)
 *   - 3 indicators: CS001, CS002, CS003 (ACTIVE)
 *   - 1 manifest: communes/XATEST/manifests/current
 *   - 1 OPEN request:   REQ001 (targets THON01)
 *   - 1 CLOSED request: REQ002 (status COMPLETED, for T05)
 */

"use strict";

const admin  = require("firebase-admin");
const crypto = require("crypto");
const path   = require("path");

// ── Init Firebase Admin ───────────────────────────────────────
const serviceAccount = require(path.join(__dirname, "../service-account.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db        = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// ── Password helpers (same logic as utils/crypto.js) ─────────
function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}
function hashPassword(plain, salt) {
  return crypto.createHash("sha256").update(plain + salt).digest("hex");
}
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ── Seed config ───────────────────────────────────────────────
const XA_CODE      = "XATEST";
const YEAR         = 2025;
const THON_CODE    = "THON01";

const USERS = {
  CB_THON: {
    user_id:  "USR_THON01",
    password: "Test@1234",       // plain — will be hashed below
    ho_ten:   "Nguyễn Văn Test",
    vai_tro:  "CB_THON",
    don_vi:   THON_CODE,
    nhanh:    "UBND",
    linh_vuc_codes: null,
  },
  LANH_DAO: {
    user_id:  "USR_LANHDAO",
    password: "Test@1234",
    ho_ten:   "Trần Thị Lãnh Đạo",
    vai_tro:  "LANH_DAO",
    don_vi:   "XA",
    nhanh:    "UBND",
    linh_vuc_codes: null,
  },
};

const INDICATORS = [
  {
    chi_so_id:    "CS001",
    ten_chi_so:   "Diện tích lúa",
    mo_ta:        "Tổng diện tích canh tác lúa trong thôn",
    don_vi_do:    "ha",
    kieu_du_lieu: "so",
    linh_vuc:     "NONG_NGHIEP",
    validation:   { required: true, min: 0, max: 10000 },
    status:       "ACTIVE",
  },
  {
    chi_so_id:    "CS002",
    ten_chi_so:   "Số hộ nghèo",
    mo_ta:        "Số hộ được xếp loại nghèo trong thôn",
    don_vi_do:    "hộ",
    kieu_du_lieu: "so",
    linh_vuc:     "XA_HOI",
    validation:   { required: true, min: 0, max: 1000 },
    status:       "ACTIVE",
  },
  {
    chi_so_id:    "CS003",
    ten_chi_so:   "Có đường bê tông",
    mo_ta:        "Thôn có đường bê tông liên thôn không",
    don_vi_do:    null,
    kieu_du_lieu: "boolean",
    linh_vuc:     "CO_SO_HA_TANG",
    validation:   { required: true },
    status:       "ACTIVE",
  },
];

// ── Main ──────────────────────────────────────────────────────
async function seed() {
  console.log("\n═══════════════════════════════════════");
  console.log("  Seeding Firestore test data");
  console.log(`  Project: communegovernance`);
  console.log(`  Xã: ${XA_CODE}  |  Năm: ${YEAR}`);
  console.log("═══════════════════════════════════════\n");

  const batch = db.batch();
  const now   = Timestamp.now();

  // ── 1. Xã registry ─────────────────────────────────────────
  const xaRef = db.collection("config").doc("xa_registry")
    .collection(XA_CODE).doc(XA_CODE);
  // Firestore path: config/xa_registry/XATEST  (sub-collection doc)
  // Actually spec says: config/xa_registry/{xa_code} as a collection
  // Use flat path: xa_registry/{xa_code}
  const xaRef2 = db.collection("xa_registry").doc(XA_CODE);
  batch.set(xaRef2, {
    xa_code:        XA_CODE,
    xa_name:        "Xã Test",
    tinh:           "Quảng Trị",
    gmail_xa:       "test.xa@gmail.com",
    drive_folder_id:"TEST_DRIVE_FOLDER",
    sheets_id:      "TEST_SHEETS_ID",
    status:         "ACTIVE",
    created_at:     now,
  });
  console.log("✅ xa_registry/XATEST");

  // ── 2. Users ───────────────────────────────────────────────
  for (const [key, u] of Object.entries(USERS)) {
    const salt  = generateSalt();
    const hash  = hashPassword(u.password, salt);
    const token = generateToken();
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    );

    const userRef = db.collection("users").doc(u.user_id);
    batch.set(userRef, {
      user_id:          u.user_id,
      xa_code:          XA_CODE,
      ho_ten:           u.ho_ten,
      vai_tro:          u.vai_tro,
      don_vi:           u.don_vi,
      nhanh:            u.nhanh,
      linh_vuc_codes:   u.linh_vuc_codes,
      password_hash:    hash,
      password_salt:    salt,
      session_token:    token,
      token_expires_at: expiresAt,
      status:           "ACTIVE",
      last_login_at:    now,
    });
    console.log(`✅ users/${u.user_id}  (${u.vai_tro})  password: ${u.password}`);
  }

  // ── 3. Indicators ──────────────────────────────────────────
  for (const ind of INDICATORS) {
    const ref = db
      .collection("communes").doc(XA_CODE)
      .collection("indicators").doc(ind.chi_so_id);
    batch.set(ref, {
      ...ind,
      created_by:  "USR_LANHDAO",
      approved_by: "USR_LANHDAO",
      approved_at: now,
      created_at:  now,
      updated_at:  now,
      year:        YEAR,
    });
  }
  console.log(`✅ indicators: ${INDICATORS.map(i => i.chi_so_id).join(", ")}`);

  // ── 4. Requests ────────────────────────────────────────────
  const manifestVersion = `v${new Date().toISOString().replace(/[-:T]/g,"").substring(0,15)}`;

  // REQ001 — OPEN, targets THON01
  const req1Ref = db
    .collection("communes").doc(XA_CODE)
    .collection("requests").doc("REQ001");
  batch.set(req1Ref, {
    req_id:          "REQ001",
    tieu_de:         "Báo cáo nông nghiệp Q2/2025",
    tao_boi:         "USR_LANHDAO",
    danh_sach_thon:  [THON_CODE, "THON02"],
    chi_so_ids:      ["CS001", "CS002", "CS003"],
    deadline:        "2025-12-31",
    ghi_chu:         "Số liệu tính đến cuối năm 2025",
    status:          "OPEN",
    manifest_version: manifestVersion,
    created_at:      now,
    year:            YEAR,
  });
  console.log("✅ requests/REQ001  (OPEN, targets THON01 + THON02)");

  // REQ002 — COMPLETED (for T05 closed-request test)
  const req2Ref = db
    .collection("communes").doc(XA_CODE)
    .collection("requests").doc("REQ002");
  batch.set(req2Ref, {
    req_id:          "REQ002",
    tieu_de:         "Báo cáo đã đóng Q1/2025",
    tao_boi:         "USR_LANHDAO",
    danh_sach_thon:  [THON_CODE],
    chi_so_ids:      ["CS001"],
    deadline:        "2025-03-31",
    ghi_chu:         "Request này đã đóng",
    status:          "COMPLETED",
    manifest_version: manifestVersion,
    created_at:      now,
    year:            YEAR,
  });
  console.log("✅ requests/REQ002  (COMPLETED — for closed-request test)");

  // REQ003 — OPEN but excludes THON01 (for PERM_002 test)
  const req3Ref = db
    .collection("communes").doc(XA_CODE)
    .collection("requests").doc("REQ003");
  batch.set(req3Ref, {
    req_id:          "REQ003",
    tieu_de:         "Báo cáo chỉ cho THON02",
    tao_boi:         "USR_LANHDAO",
    danh_sach_thon:  ["THON02"],   // THON01 NOT included → PERM_002
    chi_so_ids:      ["CS001"],
    deadline:        "2025-12-31",
    ghi_chu:         "Dùng để test PERM_002",
    status:          "OPEN",
    manifest_version: manifestVersion,
    created_at:      now,
    year:            YEAR,
  });
  console.log("✅ requests/REQ003  (OPEN, excludes THON01 — for PERM_002 test)");

  // ── 5. Manifest ────────────────────────────────────────────
  const manifestRef = db
    .collection("communes").doc(XA_CODE)
    .collection("manifests").doc("current");
  batch.set(manifestRef, {
    version:      manifestVersion,
    generated_at: now,
    xa_code:      XA_CODE,
    xa_name:      "Xã Test",
    year:         YEAR,
    indicators:   INDICATORS.map(({ chi_so_id, ten_chi_so, mo_ta,
                                    don_vi_do, kieu_du_lieu, linh_vuc, validation }) => ({
      chi_so_id, ten_chi_so, mo_ta, don_vi_do, kieu_du_lieu, linh_vuc, validation,
    })),
    requests: [
      {
        req_id:         "REQ001",
        tieu_de:        "Báo cáo nông nghiệp Q2/2025",
        chi_so_ids:     ["CS001", "CS002", "CS003"],
        danh_sach_thon: [THON_CODE, "THON02"],
        deadline:       "2025-12-31",
        ghi_chu:        "Số liệu tính đến cuối năm 2025",
      },
      {
        req_id:         "REQ003",
        tieu_de:        "Báo cáo chỉ cho THON02",
        chi_so_ids:     ["CS001"],
        danh_sach_thon: ["THON02"],
        deadline:       "2025-12-31",
        ghi_chu:        "Dùng để test PERM_002",
      },
    ],
    drive_folder_id: "TEST_DRIVE_FOLDER",
  });
  console.log(`✅ manifests/current  (version: ${manifestVersion})`);

  // ── Commit all ─────────────────────────────────────────────
  await batch.commit();

  // ── Print CONFIG for test script ───────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("  DONE. Copy này vào CONFIG trong test_push_data.js:");
  console.log("═══════════════════════════════════════\n");
  console.log(`  CB_THON: {
    user_id:  "USR_THON01",
    password: "Test@1234",
    xa_code:  "${XA_CODE}",
    year:     ${YEAR},
  },
  OPEN_REQ_ID:   "REQ001",
  CLOSED_REQ_ID: "REQ002",
  PERM_REQ_ID:   "REQ003",   // add this to T04 test
  CHI_SO_IDS:    ["CS001", "CS002", "CS003"],
  LANH_DAO: {
    user_id:  "USR_LANHDAO",
    password: "Test@1234",
    xa_code:  "${XA_CODE}",
    year:     ${YEAR},
  },
`);
  console.log("═══════════════════════════════════════\n");
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\n❌ Seed failed:", err.message || err);
    process.exit(1);
  });