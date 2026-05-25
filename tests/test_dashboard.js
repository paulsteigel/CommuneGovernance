#!/usr/bin/env node
/**
 * test_dashboard.js — Integration test cho GET /dashboard
 * Usage: node tests/test_dashboard.js
 *
 * SETUP tự động: tạo request + push submissions + verify một số
 *
 * Tests:
 *   T01  Không có token                         → AUTH_001
 *   T02  Thiếu xa_code                          → DATA_001
 *   T03  Thiếu year                             → DATA_001
 *   T04  year không hợp lệ                      → DATA_001
 *   T05  CB_THON xem dashboard                  → PERM_001
 *   T06  CB_CM xem dashboard                    → PERM_001
 *   T07  ✅ LANH_DAO xem dashboard              → success
 *   T08  ✅ Response có trường requests array    → đúng cấu trúc
 *   T09  ✅ Response có trường summary           → đúng cấu trúc
 *   T10  ✅ total_thon khớp danh_sach_thon       → đúng số
 *   T11  ✅ status_breakdown đủ 4 key            → PENDING/IN_REVIEW/VERIFIED/NEEDS_REVISION
 *   T12  ✅ completion_pct là số 0–100           → đúng range
 *   T13  ✅ verified_thon tăng sau verify        → logic đúng
 *   T14  ✅ Filter theo req_id hoạt động         → chỉ trả req đó
 *   T15  ✅ missing_thons chính xác              → thôn chưa nộp
 *   T16  ✅ summary.needs_attention đúng         → NEEDS_REVISION + IN_REVIEW
 *   T17  ✅ generated_at là ISO string           → timestamp hợp lệ
 */
"use strict";

const https = require("https");

const CONFIG = {
  BASE_URL: "https://careapi-cx7avsd4pa-as.a.run.app",
  LANH_DAO: { user_id: "USR_LANHDAO", password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CB_CM:    { user_id: "USR_CBCM01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CB_THON:  { user_id: "USR_THON01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CHI_SO_IDS: ["CS001", "CS002"],
  THON_CODE:  "THON01",
};

function request(method, path, body, query = "") {
  return new Promise((resolve, reject) => {
    const url  = new URL(CONFIG.BASE_URL + path + query);
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        ...(data && { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const post = (path, body) => request("POST", path, body);
const get  = (path, query) => request("GET",  path, null, query);

let passed = 0, failed = 0;
function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  dashboard integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ── SETUP ─────────────────────────────────────────────────
  console.log("── SETUP: Login ──");
  const [loginLD, loginCM, loginThon] = await Promise.all([
    post("/login", CONFIG.LANH_DAO),
    post("/login", CONFIG.CB_CM),
    post("/login", CONFIG.CB_THON),
  ]);
  check("LANH_DAO login", loginLD.body.success  === true);
  check("CB_CM login",    loginCM.body.success   === true);
  check("CB_THON login",  loginThon.body.success  === true);
  if (!loginLD.body.success) { console.log("⚠️  Login failed"); process.exit(1); }

  const ldToken   = loginLD.body.token;
  const cmToken   = loginCM.body.token;
  const thonToken = loginThon.body.token;
  const xa_code   = CONFIG.LANH_DAO.xa_code;
  const year      = CONFIG.LANH_DAO.year;

  // Create 2 fresh requests (2-thon request to test missing_thons)
  console.log("\n── SETUP: Create requests & submissions ──");
  const [reqA, reqB] = await Promise.all([
    post("/create_request", {
      token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
      tieu_de: `[DASH-TEST-A] ${Date.now()}`,
      chi_so_ids:     CONFIG.CHI_SO_IDS,
      danh_sach_thon: [CONFIG.THON_CODE, "THON02"],  // 2 thons
      deadline: "2025-12-31",
    }),
    post("/create_request", {
      token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
      tieu_de: `[DASH-TEST-B] ${Date.now()}`,
      chi_so_ids:     CONFIG.CHI_SO_IDS,
      danh_sach_thon: [CONFIG.THON_CODE],
      deadline: "2020-01-01",   // past deadline → overdue
    }),
  ]);
  check("Create REQ_A", reqA.body.success === true);
  check("Create REQ_B", reqB.body.success === true);
  if (!reqA.body.req_id) { console.log("⚠️  Setup failed"); process.exit(1); }

  const reqIdA = reqA.body.req_id;
  const reqIdB = reqB.body.req_id;

  // Push 2 submissions (one for each request)
  const [pushA, pushB] = await Promise.all([
    post("/push_data", {
      token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, year,
      manifest_version_used: "v0",
      submissions: [{ req_id: reqIdA, device_collected_at: new Date().toISOString(), values: { CS001: 50, CS002: 10 } }],
    }),
    post("/push_data", {
      token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, year,
      manifest_version_used: "v0",
      submissions: [{ req_id: reqIdB, device_collected_at: new Date().toISOString(), values: { CS001: 30, CS002: 5 } }],
    }),
  ]);
  check("Push SUB_A (REQ_A)", pushA.body.success === true);
  check("Push SUB_B (REQ_B)", pushB.body.success === true);

  const subIdA = pushA.body.submission_ids?.[0];
  const subIdB = pushB.body.submission_ids?.[0];

  // Verify SUB_B (so we have one VERIFIED, one PENDING_VERIFY)
  const verifyB = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code,
    submission_id: subIdB, verify_mode: "batch", decision: "confirm",
  });
  check("Verify SUB_B → VERIFIED", verifyB.body.success === true && verifyB.body.status === "VERIFIED");

  console.log(`  → REQ_A: ${reqIdA} (SUB_A PENDING_VERIFY)`);
  console.log(`  → REQ_B: ${reqIdB} (SUB_B VERIFIED, overdue)`);

  // ── AUTH & VALIDATION ──────────────────────────────────────
  console.log("\n── Auth & validation ──");

  const t01 = await get("/dashboard", `?user_id=${CONFIG.LANH_DAO.user_id}&xa_code=${xa_code}&year=${year}`);
  check("T01  No token → AUTH_001", t01.body.error_code === "AUTH_001", t01.body.error_code);

  const t02 = await get("/dashboard", `?token=${ldToken}&user_id=${CONFIG.LANH_DAO.user_id}&year=${year}`);
  check("T02  Missing xa_code → DATA_001", t02.body.error_code === "DATA_001", t02.body.message);

  const t03 = await get("/dashboard", `?token=${ldToken}&user_id=${CONFIG.LANH_DAO.user_id}&xa_code=${xa_code}`);
  check("T03  Missing year → DATA_001", t03.body.error_code === "DATA_001", t03.body.message);

  const t04 = await get("/dashboard", `?token=${ldToken}&user_id=${CONFIG.LANH_DAO.user_id}&xa_code=${xa_code}&year=notanumber`);
  check("T04  Invalid year → DATA_001", t04.body.error_code === "DATA_001", t04.body.message);

  const t05 = await get("/dashboard", `?token=${thonToken}&user_id=${CONFIG.CB_THON.user_id}&xa_code=${xa_code}&year=${year}`);
  check("T05  CB_THON → PERM_001", t05.body.error_code === "PERM_001", t05.body.error_code);

  const t06 = await get("/dashboard", `?token=${cmToken}&user_id=${CONFIG.CB_CM.user_id}&xa_code=${xa_code}&year=${year}`);
  check("T06  CB_CM → PERM_001", t06.body.error_code === "PERM_001", t06.body.error_code);

  // ── RESPONSE STRUCTURE ─────────────────────────────────────
  console.log("\n── Response structure ──");

  const t07 = await get("/dashboard", `?token=${ldToken}&user_id=${CONFIG.LANH_DAO.user_id}&xa_code=${xa_code}&year=${year}`);
  check("T07  ✅ LANH_DAO dashboard → success", t07.body.success === true, JSON.stringify(t07.body).substring(0, 100));

  const dash = t07.body;

  check("T08  ✅ requests là array",          Array.isArray(dash.requests), typeof dash.requests);
  check("T09  ✅ summary tồn tại",            typeof dash.summary === "object");
  check("T17  ✅ generated_at là ISO string", typeof dash.generated_at === "string" && dash.generated_at.includes("T"));

  // Find our test requests in the response
  const reqAData = dash.requests?.find(r => r.req_id === reqIdA);
  const reqBData = dash.requests?.find(r => r.req_id === reqIdB);

  check("T10  ✅ total_thon REQ_A = 2",
    reqAData?.total_thon === 2,
    `got ${reqAData?.total_thon}`);

  check("T11  ✅ status_breakdown có 4 key",
    reqAData && ["PENDING_VERIFY","IN_REVIEW","VERIFIED","NEEDS_REVISION"]
      .every(k => reqAData.status_breakdown[k] !== undefined),
    JSON.stringify(reqAData?.status_breakdown));

  check("T12  ✅ completion_pct REQ_A = 0% (THON01 PENDING, THON02 missing)",
    reqAData?.completion_pct === 0,
    `got ${reqAData?.completion_pct}`);

  check("T13  ✅ verified_thon REQ_B = 1 (đã verify)",
    reqBData?.verified_thon === 1,
    `got ${reqBData?.verified_thon}`);

  // REQ_A: THON01 pushed (PENDING_VERIFY), THON02 not pushed → missing
  check("T15  ✅ missing_thons REQ_A có THON02",
    reqAData?.missing_thons?.includes("THON02"),
    JSON.stringify(reqAData?.missing_thons));

  check("T16  ✅ summary.pending_verify >= 1",
    dash.summary?.pending_verify >= 1,
    `got ${dash.summary?.pending_verify}`);

  // ── FILTER BY req_id ───────────────────────────────────────
  console.log("\n── Filter by req_id ──");

  const t14 = await get("/dashboard",
    `?token=${ldToken}&user_id=${CONFIG.LANH_DAO.user_id}&xa_code=${xa_code}&year=${year}&req_id=${reqIdB}`);
  check("T14  ✅ Filter req_id trả về đúng 1 request",
    t14.body.success === true &&
    t14.body.requests?.length === 1 &&
    t14.body.requests[0].req_id === reqIdB,
    JSON.stringify(t14.body.requests?.map(r => r.req_id)));

  // ── SUMMARY ──────────────────────────────────────────────────
  const total = passed + failed;
  console.log("\n═══════════════════════════════════════════════");
  console.log(`  ${passed}/${total} passed  ${failed > 0 ? `(${failed} FAILED)` : "✅ ALL PASS"}`);
  console.log("═══════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("❌ Uncaught error:", err.message);
  process.exit(1);
});
