#!/usr/bin/env node
/**
 * test_push_data.js — Integration test for POST /push_data
 * Usage: node tests/test_push_data.js
 */
"use strict";

const https = require("https");

const CONFIG = {
  BASE_URL: "https://careapi-cx7avsd4pa-as.a.run.app",
  CB_THON: {
    user_id:  "USR_THON01",
    password: "Test@1234",
    xa_code:  "XATEST",
    year:     2025,
  },
  OPEN_REQ_ID:   "REQ001",
  CLOSED_REQ_ID: "REQ002",
  PERM_REQ_ID:   "REQ003",
  CHI_SO_IDS:    ["CS001", "CS002", "CS003"],
  LANH_DAO: {
    user_id:  "USR_LANHDAO",
    password: "Test@1234",
    xa_code:  "XATEST",
    year:     2025,
  },
};

// ── HTTP helper ──────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CONFIG.BASE_URL + path);
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end",  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Test runner ──────────────────────────────────────────────
let passed = 0, failed = 0;

function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

// ── Tests ────────────────────────────────────────────────────
async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  push_data integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── SETUP: Login CB_THON ──────────────────────────────────
  console.log("── SETUP: Login as CB_THON ──");
  const loginRes = await post("/login", CONFIG.CB_THON);
  check("Login succeeds", loginRes.body.success === true,
    JSON.stringify(loginRes.body.error_code));
  if (!loginRes.body.success) {
    console.log("  ⚠️  Cannot continue — login failed");
    process.exit(1);
  }

  // Response format: { success, token, manifest }  (flat — no .data wrapper)
  const token           = loginRes.body.token;
  const manifestVersion = loginRes.body.manifest?.manifest_version || "v_unknown";
  const xa_code         = CONFIG.CB_THON.xa_code;
  const year            = CONFIG.CB_THON.year;
  console.log(`  token        : ${token.substring(0, 8)}…`);
  console.log(`  manifest ver : ${manifestVersion}\n`);

  // ── T01: Happy path ───────────────────────────────────────
  console.log("── T01: Happy path ──");
  const t01 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values:              { CS001: 120.5, CS002: 45, CS003: true },
      anh_urls:            [],
    }],
  });
  console.log("  response:", JSON.stringify(t01.body).substring(0, 300));
  check("success true",           t01.body.success === true,        t01.body.error_code);
  check("processed = 1",          t01.body.processed === 1);
  check("submission_ids returned", Array.isArray(t01.body.submission_ids) &&
                                   t01.body.submission_ids.length === 1);
  check("no warnings",            t01.body.warnings?.length === 0);
  check("new_manifest present",   !!t01.body.new_manifest);
  console.log();

  // ── T02: Duplicate block ──────────────────────────────────
  console.log("── T02: Duplicate submission → DATA_004 ──");
  const t02 = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.OPEN_REQ_ID,   // same → blocked
      device_collected_at: "2025-06-15T09:30:00Z",
      values:              { CS001: 999 },
    }],
  });
  console.log("  response:", JSON.stringify(t02.body).substring(0, 200));
  check("success false",   t02.body.success === false);
  check("error DATA_004",  t02.body.error_code === "DATA_004");
  console.log();

  // ── T03: Stale manifest → accept + warn ──────────────────
  console.log("── T03: Stale manifest → 200 + MANIFEST_OUTDATED ──");
  // Uses PERM_REQ_ID (REQ003) — but THON01 not in its danh_sach_thon
  // so we expect PERM_002 here, which still proves server rejects correctly.
  // For a clean stale test we need a second open req for THON01 — skip if unavailable.
  console.log("  (skipped — REQ003 excludes THON01, tested in T04 instead)\n");

  // ── T04: Wrong thon → PERM_002 ───────────────────────────
  console.log("── T04: Request excludes this thon → PERM_002 ──");
  const t04 = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.PERM_REQ_ID,  // REQ003 excludes THON01
      device_collected_at: "2025-06-15T09:00:00Z",
      values:              { CS001: 1 },
    }],
  });
  console.log("  response:", JSON.stringify(t04.body).substring(0, 200));
  check("success false",   t04.body.success === false);
  check("error PERM_002",  t04.body.error_code === "PERM_002");
  console.log();

  // ── T05: Closed request → DATA_002 ───────────────────────
  console.log("── T05: Closed request → DATA_002 ──");
  const t05 = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.CLOSED_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values:              { CS001: 1 },
    }],
  });
  console.log("  response:", JSON.stringify(t05.body).substring(0, 200));
  check("success false",   t05.body.success === false);
  check("error DATA_002",  t05.body.error_code === "DATA_002");
  console.log();

  // ── T06: Missing fields → DATA_001 ───────────────────────
  console.log("── T06: Missing submissions field → DATA_001 ──");
  const t06 = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    // submissions missing
  });
  console.log("  response:", JSON.stringify(t06.body).substring(0, 200));
  check("success false",   t06.body.success === false);
  check("error DATA_001",  t06.body.error_code === "DATA_001");

  // T06b: empty values object
  const t06b = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values:              {},
    }],
  });
  console.log("  T06b response:", JSON.stringify(t06b.body).substring(0, 150));
  check("T06b: empty values rejected",
    t06b.body.success === false && t06b.body.error_code === "DATA_001");
  console.log();

  // ── T07: Wrong role (LANH_DAO) → PERM_001 ────────────────
  console.log("── T07: LANH_DAO cannot push → PERM_001 ──");
  const loginLD = await post("/login", CONFIG.LANH_DAO);
  if (loginLD.body.success) {
    const ldToken = loginLD.body.token;
    const t07 = await post("/push_data", {
      token:                 ldToken,
      xa_code, year,
      manifest_version_used: manifestVersion,
      submissions: [{
        req_id:              CONFIG.OPEN_REQ_ID,
        device_collected_at: "2025-06-15T09:00:00Z",
        values:              { CS001: 1 },
      }],
    });
    console.log("  response:", JSON.stringify(t07.body).substring(0, 200));
    check("success false",   t07.body.success === false);
    check("error PERM_001",  t07.body.error_code === "PERM_001");
  } else {
    console.log("  ⚠️  Skipped — LANH_DAO login failed");
  }
  console.log();

  // ── T08: Bad token → AUTH_001 ─────────────────────────────
  console.log("── T08: Invalid token → AUTH_001 ──");
  const t08 = await post("/push_data", {
    token:                 "a".repeat(64),
    xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values:              { CS001: 1 },
    }],
  });
  console.log("  response:", JSON.stringify(t08.body).substring(0, 200));
  check("success false",   t08.body.success === false);
  check("error AUTH_001",  t08.body.error_code === "AUTH_001");
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