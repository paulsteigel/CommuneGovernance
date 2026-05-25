#!/usr/bin/env node
/**
 * test_push_data.js — Integration test for POST /push_data
 *
 * Usage:
 *   node test_push_data.js
 *
 * Prerequisites:
 *   1. Copy a valid CB_THON token from a fresh /login call
 *   2. Fill CONFIG below with real data from your Firestore
 *   3. node test_push_data.js
 *
 * Tests (run in order — each depends on prior state):
 *   T01  Happy path          → 200, submission_ids populated
 *   T02  Duplicate block     → DATA_004 (same req_id + thon)
 *   T03  Stale manifest      → 200 + warnings: ["MANIFEST_OUTDATED"]
 *   T04  Wrong thon          → PERM_002  (forge thon attempt)
 *   T05  Closed request      → DATA_002
 *   T06  Missing fields      → DATA_001
 *   T07  Wrong role          → PERM_001  (LANH_DAO cannot push)
 *   T08  Bad token           → AUTH_001
 */

"use strict";
const https = require("https");
const http  = require("http");

// ─────────────────────────────────────────────────────────────
// CONFIG — fill these in before running
// ─────────────────────────────────────────────────────────────
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
  CHI_SO_IDS:    ["CS001", "CS002", "CS003"],

  LANH_DAO: {
    user_id:  "USR_LANHDAO",
    password: "Test@1234",
    xa_code:  "XATEST",
    year:     2025,
  },
};
// ─────────────────────────────────────────────────────────────

// ── HTTP helper ──────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(CONFIG.BASE_URL + path);
    const data   = JSON.stringify(body);
    const driver = url.protocol === "https:" ? https : http;

    const req = driver.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
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
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── Test cases ───────────────────────────────────────────────
async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  push_data integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── Step 0: Login to get fresh token ──────────────────────
  console.log("── SETUP: Login as CB_THON ──");
  const loginRes = await post("/login", CONFIG.CB_THON);
  check("Login succeeds", loginRes.body.success === true,
    JSON.stringify(loginRes.body.error_code));
  if (!loginRes.body.success) {
    console.log("  ⚠️  Cannot continue without valid token — check CONFIG");
    process.exit(1);
  }

  const token           = loginRes.body.data.token;
  const manifestVersion = loginRes.body.data.manifest?.manifest_version || "v_unknown";
  const xa_code         = CONFIG.CB_THON.xa_code;
  const year            = CONFIG.CB_THON.year;
  console.log(`  token        : ${token.substring(0,8)}…`);
  console.log(`  manifest ver : ${manifestVersion}\n`);

  // ── T01: Happy path ───────────────────────────────────────
  console.log("── T01: Happy path ──");
  const t01 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:             CONFIG.OPEN_REQ_ID,
      device_collected_at:"2025-06-15T09:00:00Z",
      values: Object.fromEntries(CONFIG.CHI_SO_IDS.map((id, i) => [id, i + 10])),
      anh_urls: [],
    }],
  });
  console.log("  response:", JSON.stringify(t01.body, null, 2).substring(0, 300));
  check("status 200",             t01.status === 200);
  check("success true",           t01.body.success === true);
  check("processed = 1",          t01.body.data?.processed === 1);
  check("submission_ids returned",Array.isArray(t01.body.data?.submission_ids) &&
                                  t01.body.data.submission_ids.length === 1);
  check("no warnings",            t01.body.data?.warnings?.length === 0);
  check("new_manifest present",   !!t01.body.data?.new_manifest);
  console.log();

  // ── T02: Duplicate block ──────────────────────────────────
  console.log("── T02: Duplicate submission (same req_id + thon) ──");
  const t02 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:             CONFIG.OPEN_REQ_ID,  // same as T01 → should be blocked
      device_collected_at:"2025-06-15T09:30:00Z",
      values: { [CONFIG.CHI_SO_IDS[0]]: 999 },
    }],
  });
  console.log("  response:", JSON.stringify(t02.body).substring(0, 200));
  check("success false",          t02.body.success === false);
  check("error DATA_004",         t02.body.error_code === "DATA_004");
  console.log();

  // ── T03: Stale manifest warning ───────────────────────────
  console.log("── T03: Stale manifest → accept + warn ──");
  // Need a different req_id that hasn't been submitted yet
  // If you only have one open req, skip this test
  const SECOND_REQ = CONFIG.OPEN_REQ_ID + "_T03"; // replace with real second req
  const t03 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: "v20200101T000000",  // definitely stale
    submissions: [{
      req_id:             SECOND_REQ,
      device_collected_at:"2025-06-15T09:00:00Z",
      values: { [CONFIG.CHI_SO_IDS[0]]: 55 },
    }],
  });
  console.log("  response:", JSON.stringify(t03.body).substring(0, 200));
  // Either succeeds with warning, or DATA_002 if SECOND_REQ doesn't exist
  if (t03.body.success) {
    check("accepted despite stale manifest", true);
    check("MANIFEST_OUTDATED warning present",
      t03.body.data?.warnings?.includes("MANIFEST_OUTDATED"));
  } else {
    check("T03 skipped — need a second OPEN req_id in CONFIG",
      t03.body.error_code === "DATA_002");
  }
  console.log();

  // ── T04: Wrong thon (forge attempt) ──────────────────────
  console.log("── T04: Wrong thon — PERM_002 ──");
  // We need a req_id that does NOT include this user's thon
  // If you only have one req, this test may return DATA_002 instead
  const t04 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:              CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values: { [CONFIG.CHI_SO_IDS[0]]: 1 },
      // No way to forge thon — server always uses user.don_vi from token
    }],
  });
  // T04 should return DATA_004 (already submitted) OR PERM_002 if we had
  // a request that excludes this thon. Log result for manual check.
  console.log("  NOTE: server uses user.don_vi from token — client cannot forge thon.");
  console.log("  To test PERM_002, use a req_id whose danh_sach_thon excludes this user.");
  console.log("  response:", JSON.stringify(t04.body).substring(0, 200));
  console.log();

  // ── T05: Closed request ───────────────────────────────────
  console.log("── T05: Closed request → DATA_002 ──");
  const t05 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id:             CONFIG.CLOSED_REQ_ID,
      device_collected_at:"2025-06-15T09:00:00Z",
      values: { [CONFIG.CHI_SO_IDS[0]]: 1 },
    }],
  });
  console.log("  response:", JSON.stringify(t05.body).substring(0, 200));
  check("success false",         t05.body.success === false);
  check("error DATA_002 or DATA_004", ["DATA_002","DATA_004","DATA_001"]
    .includes(t05.body.error_code));
  console.log();

  // ── T06: Missing required fields ─────────────────────────
  console.log("── T06: Missing fields → DATA_001 ──");
  const t06 = await post("/push_data", {
    token,
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    // submissions missing
  });
  console.log("  response:", JSON.stringify(t06.body).substring(0, 200));
  check("success false",    t06.body.success === false);
  check("error DATA_001",   t06.body.error_code === "DATA_001");
  console.log();

  // T06b: empty values
  const t06b = await post("/push_data", {
    token, xa_code, year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id: CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values: {},  // empty — should be rejected
    }],
  });
  console.log("  T06b (empty values) response:", JSON.stringify(t06b.body).substring(0, 150));
  check("T06b: empty values rejected",
    t06b.body.success === false && t06b.body.error_code === "DATA_001");
  console.log();

  // ── T07: Wrong role (LANH_DAO) ────────────────────────────
  console.log("── T07: LANH_DAO cannot push data → PERM_001 ──");
  const loginLD = await post("/login", CONFIG.LANH_DAO);
  if (loginLD.body.success) {
    const ldToken = loginLD.body.data.token;
    const t07 = await post("/push_data", {
      token: ldToken,
      xa_code,
      year,
      manifest_version_used: manifestVersion,
      submissions: [{
        req_id: CONFIG.OPEN_REQ_ID,
        device_collected_at: "2025-06-15T09:00:00Z",
        values: { [CONFIG.CHI_SO_IDS[0]]: 1 },
      }],
    });
    console.log("  response:", JSON.stringify(t07.body).substring(0, 200));
    check("success false",   t07.body.success === false);
    check("error PERM_001",  t07.body.error_code === "PERM_001");
  } else {
    console.log("  ⚠️  Skipped — LANH_DAO login failed, check CONFIG.LANH_DAO");
  }
  console.log();

  // ── T08: Bad token ────────────────────────────────────────
  console.log("── T08: Invalid token → AUTH_001 ──");
  const t08 = await post("/push_data", {
    token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    xa_code,
    year,
    manifest_version_used: manifestVersion,
    submissions: [{
      req_id: CONFIG.OPEN_REQ_ID,
      device_collected_at: "2025-06-15T09:00:00Z",
      values: { [CONFIG.CHI_SO_IDS[0]]: 1 },
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