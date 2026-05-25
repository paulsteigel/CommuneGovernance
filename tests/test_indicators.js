#!/usr/bin/env node
/**
 * test_indicators.js — Integration test for create/approve indicator
 * Usage: node tests/test_indicators.js
 *
 * Tests:
 *   T01  CB_CM creates indicator               → DRAFT
 *   T02  LANH_DAO approves it                  → ACTIVE + manifest rebuilt
 *   T03  Approve again                         → DATA_005 (already ACTIVE)
 *   T04  CB_THON tries to create               → PERM_001
 *   T05  CB_CM wrong linh_vuc                  → PERM_002
 *   T06  Missing required fields               → DATA_001
 *   T07  Invalid kieu_du_lieu                  → DATA_001
 *   T08  Approve non-existent indicator        → DATA_005
 *   T09  CB_THON tries to approve              → PERM_001
 */
"use strict";

const https = require("https");

const CONFIG = {
  BASE_URL: "https://careapi-cx7avsd4pa-as.a.run.app",
  CB_THON: {
    user_id: "USR_THON01", password: "Test@1234",
    xa_code: "XATEST",     year: 2025,
  },
  // CB_CM user — need to add this in seed if not present
  CB_CM: {
    user_id: "USR_CBCM01", password: "Test@1234",
    xa_code: "XATEST",     year: 2025,
  },
  LANH_DAO: {
    user_id: "USR_LANHDAO", password: "Test@1234",
    xa_code: "XATEST",      year: 2025,
  },
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CONFIG.BASE_URL + path);
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: url.hostname, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end",  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

let passed = 0, failed = 0;
function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  indicators integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── SETUP: Login all users ────────────────────────────────
  console.log("── SETUP: Login ──");
  const [loginCM, loginLD, loginThon] = await Promise.all([
    post("/login", CONFIG.CB_CM),
    post("/login", CONFIG.LANH_DAO),
    post("/login", CONFIG.CB_THON),
  ]);

  check("CB_CM login",    loginCM.body.success   === true, loginCM.body.error_code);
  check("LANH_DAO login", loginLD.body.success   === true, loginLD.body.error_code);
  check("CB_THON login",  loginThon.body.success === true, loginThon.body.error_code);

  if (!loginLD.body.success) {
    console.log("  ⚠️  LANH_DAO login failed — cannot continue"); process.exit(1);
  }

  const cmToken   = loginCM.body.token;
  const ldToken   = loginLD.body.token;
  const thonToken = loginThon.body.token;
  const xa_code   = CONFIG.LANH_DAO.xa_code;
  const year      = CONFIG.LANH_DAO.year;
  console.log();

  let createdChiSoId = null;

  // ── T01: CB_CM creates indicator ─────────────────────────
  console.log("── T01: CB_CM creates indicator → DRAFT ──");
  const t01 = loginCM.body.success
    ? await post("/create_indicator", {
        token: cmToken, user_id: CONFIG.CB_CM.user_id,
        xa_code, year,
        ten_chi_so:   "Số lượng trâu bò",
        kieu_du_lieu: "so",
        linh_vuc:     "NONG_NGHIEP",
        don_vi_do:    "con",
        mo_ta:        "Tổng số trâu bò trong thôn",
        validation:   { required: true, min: 0, max: 5000 },
      })
    : { body: { success: false, error_code: "SKIPPED" } };

  console.log("  response:", JSON.stringify(t01.body).substring(0, 200));
  if (loginCM.body.success) {
    check("success true",       t01.body.success === true, t01.body.error_code);
    check("chi_so_id returned", !!t01.body.chi_so_id);
    check("status DRAFT",       t01.body.status === "DRAFT");
    createdChiSoId = t01.body.chi_so_id;
  } else {
    console.log("  ⚠️  Skipped — CB_CM not seeded. Run seed_test_data with CB_CM user.");
  }
  console.log();

  // ── T02: LANH_DAO approves it ─────────────────────────────
  console.log("── T02: LANH_DAO approves → ACTIVE + manifest rebuilt ──");
  const approveTarget = createdChiSoId || "CS001"; // fallback to seeded indicator
  const t02 = await post("/approve_indicator", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id,
    xa_code, year,
    chi_so_id: approveTarget,
  });
  console.log("  response:", JSON.stringify(t02.body).substring(0, 300));
  check("success true",           t02.body.success === true, t02.body.error_code);
  check("status ACTIVE",          t02.body.status === "ACTIVE");
  check("manifest_version present",!!t02.body.manifest_version);
  console.log();

  // ── T03: Approve same indicator again → DATA_005 ──────────
  console.log("── T03: Approve already-ACTIVE indicator → DATA_005 ──");
  const t03 = await post("/approve_indicator", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id,
    xa_code, year,
    chi_so_id: approveTarget,
  });
  console.log("  response:", JSON.stringify(t03.body).substring(0, 200));
  check("success false",  t03.body.success === false);
  check("error DATA_005", t03.body.error_code === "DATA_005");
  console.log();

  // ── T04: CB_THON tries to create → PERM_001 ───────────────
  console.log("── T04: CB_THON create indicator → PERM_001 ──");
  const t04 = await post("/create_indicator", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id,
    xa_code, year,
    ten_chi_so: "Test", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
  });
  console.log("  response:", JSON.stringify(t04.body).substring(0, 200));
  check("success false",  t04.body.success === false);
  check("error PERM_001", t04.body.error_code === "PERM_001");
  console.log();

  // ── T05: CB_CM wrong linh_vuc → PERM_002 ─────────────────
  console.log("── T05: CB_CM create outside linh_vuc → PERM_002 ──");
  const t05 = loginCM.body.success
    ? await post("/create_indicator", {
        token: cmToken, user_id: CONFIG.CB_CM.user_id,
        xa_code, year,
        ten_chi_so: "Test sai lĩnh vực", kieu_du_lieu: "so",
        linh_vuc:   "GIAO_DUC",  // not in CB_CM's linh_vuc_codes
      })
    : { body: { success: false, error_code: "SKIPPED" } };
  console.log("  response:", JSON.stringify(t05.body).substring(0, 200));
  if (loginCM.body.success) {
    check("success false",  t05.body.success === false);
    check("error PERM_002", t05.body.error_code === "PERM_002");
  } else {
    console.log("  ⚠️  Skipped — CB_CM not seeded");
  }
  console.log();

  // ── T06: Missing required fields → DATA_001 ──────────────
  console.log("── T06: Missing fields → DATA_001 ──");
  const t06 = await post("/create_indicator", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id,
    xa_code, year,
    // ten_chi_so missing
    kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
  });
  console.log("  response:", JSON.stringify(t06.body).substring(0, 200));
  check("success false",  t06.body.success === false);
  check("error DATA_001", t06.body.error_code === "DATA_001");
  console.log();

  // ── T07: Invalid kieu_du_lieu → DATA_001 ─────────────────
  console.log("── T07: Invalid kieu_du_lieu → DATA_001 ──");
  const t07 = await post("/create_indicator", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id,
    xa_code, year,
    ten_chi_so: "Test", kieu_du_lieu: "video", linh_vuc: "NONG_NGHIEP",
  });
  console.log("  response:", JSON.stringify(t07.body).substring(0, 200));
  check("success false",  t07.body.success === false);
  check("error DATA_001", t07.body.error_code === "DATA_001");
  console.log();

  // ── T08: Approve non-existent indicator → DATA_005 ────────
  console.log("── T08: Approve non-existent chi_so_id → DATA_005 ──");
  const t08 = await post("/approve_indicator", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id,
    xa_code, year, chi_so_id: "CS_TIDONTEXIST",
  });
  console.log("  response:", JSON.stringify(t08.body).substring(0, 200));
  check("success false",  t08.body.success === false);
  check("error DATA_005", t08.body.error_code === "DATA_005");
  console.log();

  // ── T09: CB_THON tries to approve → PERM_001 ─────────────
  console.log("── T09: CB_THON approve indicator → PERM_001 ──");
  const t09 = await post("/approve_indicator", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id,
    xa_code, year, chi_so_id: "CS001",
  });
  console.log("  response:", JSON.stringify(t09.body).substring(0, 200));
  check("success false",  t09.body.success === false);
  check("error PERM_001", t09.body.error_code === "PERM_001");
  console.log();

  // ── Summary ───────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════\n");
}

runTests().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});