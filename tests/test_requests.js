#!/usr/bin/env node
/**
 * test_requests.js — Integration test for POST /create_request
 * Usage: node tests/test_requests.js
 *
 * Tests:
 *   T01  LANH_DAO creates request              → OPEN + manifest rebuilt
 *   T02  CB_CM creates request (own linh_vuc)  → OPEN
 *   T03  CB_CM uses indicator outside linh_vuc → PERM_002
 *   T04  CB_THON tries to create               → PERM_001
 *   T05  Non-existent chi_so_id               → DATA_001
 *   T06  DRAFT indicator (not ACTIVE)          → DATA_001
 *   T07  Missing tieu_de                       → DATA_001
 *   T08  Bad deadline format                   → DATA_001
 *   T09  Empty danh_sach_thon                  → DATA_001
 *   T10  New request appears in manifest        → verify via pull_manifest
 */
"use strict";

const https = require("https");

const CONFIG = {
  BASE_URL: "https://careapi-cx7avsd4pa-as.a.run.app",
  CB_THON:  { user_id: "USR_THON01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CB_CM:    { user_id: "USR_CBCM01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  LANH_DAO: { user_id: "USR_LANHDAO", password: "Test@1234", xa_code: "XATEST", year: 2025 },
  // ACTIVE indicators (from seed)
  ACTIVE_IDS:  ["CS001", "CS002"],   // NONG_NGHIEP + XA_HOI — both in CB_CM's linh_vuc
  OUTSIDE_IDS: ["CS003"],            // CO_SO_HA_TANG — NOT in CB_CM's linh_vuc
  DRAFT_ID:    "CS_DRAFT01",         // seeded as DRAFT
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
    req.on("error", reject); req.write(data); req.end();
  });
}

let passed = 0, failed = 0;
function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  requests integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── SETUP: Login ──────────────────────────────────────────
  console.log("── SETUP: Login ──");
  const [loginLD, loginCM, loginThon] = await Promise.all([
    post("/login", CONFIG.LANH_DAO),
    post("/login", CONFIG.CB_CM),
    post("/login", CONFIG.CB_THON),
  ]);
  check("LANH_DAO login", loginLD.body.success   === true, loginLD.body.error_code);
  check("CB_CM login",    loginCM.body.success    === true, loginCM.body.error_code);
  check("CB_THON login",  loginThon.body.success  === true, loginThon.body.error_code);
  if (!loginLD.body.success) { console.log("⚠️  Cannot continue"); process.exit(1); }

  const ldToken   = loginLD.body.token;
  const cmToken   = loginCM.body.token;
  const thonToken = loginThon.body.token;
  const xa_code   = CONFIG.LANH_DAO.xa_code;
  const year      = CONFIG.LANH_DAO.year;
  console.log();

  let createdReqId = null;

  // ── T01: LANH_DAO creates request ────────────────────────
  console.log("── T01: LANH_DAO creates request → OPEN ──");
  const t01 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de:        "Báo cáo tổng hợp Q3/2025",
    chi_so_ids:     CONFIG.ACTIVE_IDS,
    danh_sach_thon: ["THON01", "THON02"],
    deadline:       "2025-09-30",
    ghi_chu:        "Tạo bởi LANH_DAO test",
  });
  console.log("  response:", JSON.stringify(t01.body).substring(0, 300));
  check("success true",            t01.body.success === true,    t01.body.error_code);
  check("req_id returned",         !!t01.body.req_id);
  check("status OPEN",             t01.body.status === "OPEN");
  check("manifest_version present",!!t01.body.manifest_version);
  createdReqId = t01.body.req_id;
  console.log();

  // ── T02: CB_CM creates request (own linh_vuc) ────────────
  console.log("── T02: CB_CM creates request (NONG_NGHIEP) → OPEN ──");
  const t02 = loginCM.body.success
    ? await post("/create_request", {
        token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code, year,
        tieu_de:        "Báo cáo nông nghiệp CB_CM",
        chi_so_ids:     ["CS001"],          // NONG_NGHIEP — in CB_CM's scope
        danh_sach_thon: ["THON01"],
        deadline:       "2025-10-31",
      })
    : { body: { success: false, error_code: "SKIPPED" } };
  console.log("  response:", JSON.stringify(t02.body).substring(0, 200));
  if (loginCM.body.success) {
    check("success true",   t02.body.success === true, t02.body.error_code);
    check("req_id returned",!!t02.body.req_id);
  } else { console.log("  ⚠️  Skipped — CB_CM login failed"); }
  console.log();

  // ── T03: CB_CM uses indicator outside linh_vuc → PERM_002 
  console.log("── T03: CB_CM uses CO_SO_HA_TANG indicator → PERM_002 ──");
  const t03 = loginCM.body.success
    ? await post("/create_request", {
        token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code, year,
        tieu_de:        "Báo cáo hạ tầng (sai scope)",
        chi_so_ids:     CONFIG.OUTSIDE_IDS,  // CO_SO_HA_TANG — NOT in CB_CM's scope
        danh_sach_thon: ["THON01"],
        deadline:       "2025-10-31",
      })
    : { body: { success: false, error_code: "SKIPPED" } };
  console.log("  response:", JSON.stringify(t03.body).substring(0, 200));
  if (loginCM.body.success) {
    check("success false",  t03.body.success === false);
    check("error PERM_002", t03.body.error_code === "PERM_002");
  } else { console.log("  ⚠️  Skipped"); }
  console.log();

  // ── T04: CB_THON tries to create → PERM_001 ──────────────
  console.log("── T04: CB_THON create request → PERM_001 ──");
  const t04 = await post("/create_request", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, year,
    tieu_de: "Test", chi_so_ids: ["CS001"],
    danh_sach_thon: ["THON01"], deadline: "2025-10-31",
  });
  console.log("  response:", JSON.stringify(t04.body).substring(0, 200));
  check("success false",  t04.body.success === false);
  check("error PERM_001", t04.body.error_code === "PERM_001");
  console.log();

  // ── T05: Non-existent chi_so_id → DATA_001 ───────────────
  console.log("── T05: Non-existent chi_so_id → DATA_001 ──");
  const t05 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de: "Test", chi_so_ids: ["CS_DOESNOTEXIST"],
    danh_sach_thon: ["THON01"], deadline: "2025-10-31",
  });
  console.log("  response:", JSON.stringify(t05.body).substring(0, 200));
  check("success false",  t05.body.success === false);
  check("error DATA_001", t05.body.error_code === "DATA_001");
  console.log();

  // ── T06: DRAFT indicator → DATA_001 ──────────────────────
  console.log("── T06: DRAFT indicator in request → DATA_001 ──");
  const t06 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de: "Test draft", chi_so_ids: [CONFIG.DRAFT_ID],
    danh_sach_thon: ["THON01"], deadline: "2025-10-31",
  });
  console.log("  response:", JSON.stringify(t06.body).substring(0, 200));
  check("success false",  t06.body.success === false);
  check("error DATA_001", t06.body.error_code === "DATA_001");
  console.log();

  // ── T07: Missing tieu_de → DATA_001 ──────────────────────
  console.log("── T07: Missing tieu_de → DATA_001 ──");
  const t07 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    chi_so_ids: ["CS001"], danh_sach_thon: ["THON01"], deadline: "2025-10-31",
  });
  console.log("  response:", JSON.stringify(t07.body).substring(0, 200));
  check("success false",  t07.body.success === false);
  check("error DATA_001", t07.body.error_code === "DATA_001");
  console.log();

  // ── T08: Bad deadline format → DATA_001 ──────────────────
  console.log("── T08: Bad deadline format → DATA_001 ──");
  const t08 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de: "Test", chi_so_ids: ["CS001"],
    danh_sach_thon: ["THON01"], deadline: "31/10/2025",
  });
  console.log("  response:", JSON.stringify(t08.body).substring(0, 200));
  check("success false",  t08.body.success === false);
  check("error DATA_001", t08.body.error_code === "DATA_001");
  console.log();

  // ── T09: Empty danh_sach_thon → DATA_001 ─────────────────
  console.log("── T09: Empty danh_sach_thon → DATA_001 ──");
  const t09 = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de: "Test", chi_so_ids: ["CS001"],
    danh_sach_thon: [], deadline: "2025-10-31",
  });
  console.log("  response:", JSON.stringify(t09.body).substring(0, 200));
  check("success false",  t09.body.success === false);
  check("error DATA_001", t09.body.error_code === "DATA_001");
  console.log();

  // ── T10: New request appears in manifest ──────────────────
  console.log("── T10: New request visible in manifest (CB_THON pull) ──");
  if (createdReqId) {
    const t10 = await post("/pull_manifest", {
      token: thonToken, user_id: CONFIG.CB_THON.user_id,
      xa_code, year, current_version: "v_stale_force_refresh",
    });
    const requests = t10.body.manifest?.requests || [];
    const found    = requests.some(r => r.req_id === createdReqId);
    console.log(`  req_id: ${createdReqId}, found in manifest: ${found}`);
    check("success true",              t10.body.success === true, t10.body.error_code);
    check("new request in manifest",   found);
  } else {
    console.log("  ⚠️  Skipped — T01 failed, no req_id to check");
  }
  console.log();

  // ── Summary ───────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════\n");
}

runTests().catch(err => { console.error("Unexpected error:", err); process.exit(1); });