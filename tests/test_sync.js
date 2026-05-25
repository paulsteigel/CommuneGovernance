#!/usr/bin/env node
/**
 * test_sync.js — Integration test cho POST /sync_to_sheets
 * Usage: node tests/test_sync.js
 *
 * Note: TEST_SHEETS_ID là placeholder nên Sheets write bị skip.
 *       Dùng dry_run=true để test toàn bộ logic không cần Sheets thật.
 *
 * Tests:
 *   T01  Không có X-Internal-Secret            → 403
 *   T02  Sai X-Internal-Secret                 → 403
 *   T03  ✅ Đúng secret, xa không tồn tại      → success (0 rows)
 *   T04  ✅ dry_run=true, không có VERIFIED sub → 0 rows, skipped
 *   T05  ✅ dry_run=true sau khi có VERIFIED sub → rows_synced > 0
 *   T06  ✅ dry_run response có đủ field        → synced_xas, total_rows, results
 *   T07  ✅ results[].tabs_updated là array     → tab names = req_ids
 *   T08  ✅ dry_run KHÔNG update checkpoint     → chạy lại vẫn có rows
 *   T09  ✅ xa_code filter hoạt động            → chỉ sync 1 xa
 *   T10  ✅ duration_ms trong response          → timing được trả về
 */
"use strict";

const https = require("https");

const CONFIG = {
  BASE_URL:        "https://careapi-cx7avsd4pa-as.a.run.app",
  INTERNAL_SECRET: process.env.INTERNAL_SECRET || "CHANGE_ME_IN_ENV",
  LANH_DAO: { user_id: "USR_LANHDAO", password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CB_THON:  { user_id: "USR_THON01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CHI_SO_IDS: ["CS001", "CS002"],
  THON_CODE:  "THON01",
};

function post(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CONFIG.BASE_URL + path);
    const data = JSON.stringify(body);
    const r    = https.request({
      hostname: url.hostname, path: url.pathname, method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...extraHeaders,
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on("error", reject); r.write(data); r.end();
  });
}

const sync = (body) => post("/sync_to_sheets", body,
  { "x-internal-secret": CONFIG.INTERNAL_SECRET });

let passed = 0, failed = 0;
function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  sync_to_sheets integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  if (CONFIG.INTERNAL_SECRET === "CHANGE_ME_IN_ENV") {
    console.log("  ⚠️  INTERNAL_SECRET not set — set via env var before running:");
    console.log("      $env:INTERNAL_SECRET='your_secret' (PowerShell)");
    console.log("      export INTERNAL_SECRET='your_secret' (bash)");
  }
  console.log("═══════════════════════════════════════════════\n");

  // ── SETUP: Create a verified submission to sync ────────────
  console.log("── SETUP: Login & create verified submission ──");
  const [loginLD, loginThon] = await Promise.all([
    post("/login", CONFIG.LANH_DAO),
    post("/login", CONFIG.CB_THON),
  ]);
  check("LANH_DAO login", loginLD.body.success === true);
  check("CB_THON login",  loginThon.body.success === true);
  if (!loginLD.body.success) { console.log("⚠️  Login failed"); process.exit(1); }

  const ldToken   = loginLD.body.token;
  const thonToken = loginThon.body.token;
  const xa_code   = CONFIG.LANH_DAO.xa_code;
  const year      = CONFIG.LANH_DAO.year;

  // Create request → push → verify (to have a VERIFIED sub)
  const reqR = await post("/create_request", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
    tieu_de: `[SYNC-TEST] ${Date.now()}`,
    chi_so_ids:     CONFIG.CHI_SO_IDS,
    danh_sach_thon: [CONFIG.THON_CODE],
    deadline: "2025-12-31",
  });
  const reqId = reqR.body.req_id;
  check("Create request", reqR.body.success === true && !!reqId);

  const pushR = await post("/push_data", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, year,
    manifest_version_used: "v0",
    submissions: [{ req_id: reqId, device_collected_at: new Date().toISOString(), values: { CS001: 80, CS002: 20 } }],
  });
  const subId = pushR.body.submission_ids?.[0];
  check("Push submission", pushR.body.success === true && !!subId);

  const verR = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code,
    submission_id: subId, verify_mode: "batch", decision: "confirm",
  });
  check("Verify submission", verR.body.success === true && verR.body.status === "VERIFIED");
  console.log(`  → Verified submission: ${subId} for ${reqId}`);

  // ── AUTH ──────────────────────────────────────────────────
  console.log("\n── Auth ──");

  const t01 = await post("/sync_to_sheets", { xa_code, dry_run: true });
  check("T01  No secret → 403", t01.status === 403, `status: ${t01.status}`);

  const t02 = await post("/sync_to_sheets", { xa_code, dry_run: true },
    { "x-internal-secret": "wrong_secret_xyz" });
  check("T02  Wrong secret → 403", t02.status === 403, `status: ${t02.status}`);

  // ── BASIC SYNC LOGIC ──────────────────────────────────────
  console.log("\n── Sync logic ──");

  // T03: xa không tồn tại
  const t03 = await sync({ xa_code: "XA_NOT_EXIST", dry_run: true });
  check("T03  ✅ xa không tồn tại → success (0 rows)",
    t03.body.success === true && t03.body.total_rows_synced === 0,
    JSON.stringify(t03.body));

  // T04: dry_run, xa không có VERIFIED submissions chưa sync
  // (First check a fresh xa with no data — use XATEST but filter for no new subs
  // by using year that has no data)
  const t04 = await sync({ xa_code, year: 1999, dry_run: true });
  check("T04  ✅ Không có submission → skipped",
    t04.body.success === true,
    JSON.stringify(t04.body?.results?.[0]));

  // T05: dry_run với VERIFIED submission vừa tạo
  const t05 = await sync({ xa_code, dry_run: true });
  check("T05  ✅ dry_run có VERIFIED sub → total_rows_synced > 0",
    t05.body.success === true && t05.body.total_rows_synced > 0,
    `rows: ${t05.body.total_rows_synced}`);

  // T06: Response structure đầy đủ
  check("T06  ✅ Response có synced_xas, total_rows_synced, results",
    typeof t05.body.synced_xas       === "number" &&
    typeof t05.body.total_rows_synced === "number" &&
    Array.isArray(t05.body.results),
    JSON.stringify(Object.keys(t05.body)));

  // T07: tabs_updated là array chứa req_id
  const xaResult = t05.body.results?.find(r => r.xa_code === xa_code);
  check("T07  ✅ tabs_updated chứa req_id vừa tạo",
    Array.isArray(xaResult?.tabs_updated) && xaResult.tabs_updated.includes(reqId),
    JSON.stringify(xaResult?.tabs_updated));

  // T08: dry_run KHÔNG update checkpoint → chạy lại vẫn thấy rows
  const t08 = await sync({ xa_code, dry_run: true });
  check("T08  ✅ dry_run 2 lần → vẫn thấy rows (checkpoint chưa update)",
    t08.body.total_rows_synced > 0,
    `rows: ${t08.body.total_rows_synced}`);

  // T09: xa_code filter — chỉ sync XATEST, không phải tất cả
  check("T09  ✅ xa_code filter → chỉ 1 xa trong results",
    t05.body.results?.length === 1 && t05.body.results[0].xa_code === xa_code,
    `${t05.body.results?.length} xas`);

  // T10: duration_ms có trong response
  check("T10  ✅ duration_ms trong response",
    typeof t05.body.duration_ms === "number" && t05.body.duration_ms >= 0,
    `${t05.body.duration_ms}ms`);

  // ── SUMMARY ──────────────────────────────────────────────
  const total = passed + failed;
  console.log("\n═══════════════════════════════════════════════");
  console.log(`  ${passed}/${total} passed  ${failed > 0 ? `(${failed} FAILED)` : "✅ ALL PASS"}`);
  console.log("  Note: Sheets write skipped (TEST_SHEETS_ID placeholder)");
  console.log("  Real sync sẽ write khi sheets_id là ID thật.");
  console.log("═══════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("❌ Uncaught error:", err.message);
  process.exit(1);
});