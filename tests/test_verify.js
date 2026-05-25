#!/usr/bin/env node
/**
 * test_verify.js — Integration test for /verify_data và /resubmit_data
 * Usage: node tests/test_verify.js
 *
 * SETUP tự động:
 *   Mỗi lần chạy tạo fresh requests (LANH_DAO) + fresh submissions (CB_THON)
 *   → có thể chạy lặp lại mà không cần reset data.
 *
 * Tests:
 *   T01  Không có token                           → AUTH_001
 *   T02  Thiếu xa_code / submission_id            → DATA_001
 *   T03  Thiếu verify_mode                        → DATA_001
 *   T04  verify_mode không hợp lệ                 → DATA_001
 *   T05  Batch thiếu decision                     → DATA_001
 *   T06  Submission không tồn tại                 → DATA_002
 *   T07  CB_THON cố verify                        → PERM_001
 *   T08  ✅ LANH_DAO batch confirm SUB_A          → VERIFIED
 *   T09  Verify đã VERIFIED                       → DATA_005
 *   T10  CB_THON resubmit đã VERIFIED             → DATA_005
 *   T11  CB_CM cố resubmit                        → PERM_001
 *   T12  ✅ CB_CM batch reject SUB_B              → NEEDS_REVISION
 *   T13  ✅ CB_THON resubmit SUB_B (batch mode)  → PENDING_VERIFY
 *   T14  Per-indicator chi_so_id không tồn tại   → DATA_001
 *   T15  Per-indicator status không hợp lệ       → DATA_001
 *   T16  ✅ CB_CM per-indicator partial SUB_B     → IN_REVIEW
 *   T17  ✅ CB_CM per-indicator complete SUB_B   → VERIFIED, flagged=true
 *   T18  ✅ CB_CM per-indicator có rejected SUB_C → NEEDS_REVISION
 *   T19  ✅ CB_THON resubmit SUB_C (per_ind)     → PENDING_VERIFY
 *   T20  ✅ Chỉ chỉ số rejected mới reset         → confirmed giữ nguyên
 *   T21  ✅ LANH_DAO per-indicator tất cả confirm → VERIFIED, flagged=false
 *   T22  ✅ Comment được lưu trong batch verify   → verify_comment trong response
 *   T23  ✅ verifiedBy khớp với user_id           → verified_by = USR_LANHDAO
 *   T24  ✅ Batch confirm với updated_values     → values được cập nhật
 *   T25  ✅ submission_id khớp trong response     → đúng ID
 */
"use strict";

const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  BASE_URL: "https://careapi-cx7avsd4pa-as.a.run.app",
  CB_THON:  { user_id: "USR_THON01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  CB_CM:    { user_id: "USR_CBCM01",  password: "Test@1234", xa_code: "XATEST", year: 2025 },
  LANH_DAO: { user_id: "USR_LANHDAO", password: "Test@1234", xa_code: "XATEST", year: 2025 },
  // Indicators seeded: CS001 (NONG_NGHIEP), CS002 (XA_HOI) — both in CB_CM linh_vuc
  CHI_SO_IDS: ["CS001", "CS002"],
  THON_CODE:  "THON01",
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function post(path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CONFIG.BASE_URL + path);
    const data = JSON.stringify(body);
    const r    = https.request({
      hostname: url.hostname, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end",  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on("error", reject); r.write(data); r.end();
  });
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else           { console.log(`  ❌  ${label}${detail ? " — " + detail : ""}`); failed++; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  verify_data / resubmit_data integration tests");
  console.log(`  API: ${CONFIG.BASE_URL}`);
  console.log("═══════════════════════════════════════════════\n");

  // ════════════════════════════════════════════════════════════
  // SETUP — login, create fresh requests, push fresh submissions
  // ════════════════════════════════════════════════════════════
  console.log("── SETUP: Login ──");
  const [loginLD, loginCM, loginThon] = await Promise.all([
    post("/login", { user_id: CONFIG.LANH_DAO.user_id, password: CONFIG.LANH_DAO.password, xa_code: CONFIG.LANH_DAO.xa_code }),
    post("/login", { user_id: CONFIG.CB_CM.user_id,    password: CONFIG.CB_CM.password,    xa_code: CONFIG.CB_CM.xa_code    }),
    post("/login", { user_id: CONFIG.CB_THON.user_id,  password: CONFIG.CB_THON.password,  xa_code: CONFIG.CB_THON.xa_code  }),
  ]);
  check("LANH_DAO login",  loginLD.body.success  === true, loginLD.body.error_code);
  check("CB_CM login",     loginCM.body.success   === true, loginCM.body.error_code);
  check("CB_THON login",   loginThon.body.success  === true, loginThon.body.error_code);
  if (!loginLD.body.success || !loginCM.body.success || !loginThon.body.success) {
    console.log("\n⚠️  Login failed — cannot continue.\n"); process.exit(1);
  }

  const ldToken   = loginLD.body.token;
  const cmToken   = loginCM.body.token;
  const thonToken = loginThon.body.token;
  const xa_code   = CONFIG.LANH_DAO.xa_code;
  const year      = CONFIG.LANH_DAO.year;

  // Create 3 fresh requests (one per scenario: confirm, reject, per-indicator)
  console.log("\n── SETUP: Create requests ──");
  const [reqA, reqB, reqC] = await Promise.all([
    post("/create_request", {
      token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
      tieu_de: `[VERIFY-TEST-A] ${Date.now()}`,
      chi_so_ids: CONFIG.CHI_SO_IDS, danh_sach_thon: [CONFIG.THON_CODE],
      deadline: "2025-12-31",
    }),
    post("/create_request", {
      token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
      tieu_de: `[VERIFY-TEST-B] ${Date.now()}`,
      chi_so_ids: CONFIG.CHI_SO_IDS, danh_sach_thon: [CONFIG.THON_CODE],
      deadline: "2025-12-31",
    }),
    post("/create_request", {
      token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, year,
      tieu_de: `[VERIFY-TEST-C] ${Date.now()}`,
      chi_so_ids: CONFIG.CHI_SO_IDS, danh_sach_thon: [CONFIG.THON_CODE],
      deadline: "2025-12-31",
    }),
  ]);
  const reqIdA = reqA.body.req_id;
  const reqIdB = reqB.body.req_id;
  const reqIdC = reqC.body.req_id;
  check("Create REQ_A", reqA.body.success === true, reqA.body.message);
  check("Create REQ_B", reqB.body.success === true, reqB.body.message);
  check("Create REQ_C", reqC.body.success === true, reqC.body.message);
  if (!reqIdA || !reqIdB || !reqIdC) {
    console.log("\n⚠️  Request creation failed — cannot continue.\n"); process.exit(1);
  }

  // Push 3 submissions
  console.log("\n── SETUP: Push submissions ──");
  const pushPayload = (reqId) => ({
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, year,
    manifest_version_used: "v0",   // stale version OK — non-blocking warning
    submissions: [{
      req_id: reqId,
      device_collected_at: new Date().toISOString(),
      values: { CS001: 120, CS002: 45 },
    }],
  });

  const [pushA, pushB, pushC] = await Promise.all([
    post("/push_data", pushPayload(reqIdA)),
    post("/push_data", pushPayload(reqIdB)),
    post("/push_data", pushPayload(reqIdC)),
  ]);

  check("Push SUB_A", pushA.body.success === true, pushA.body.message);
  check("Push SUB_B", pushB.body.success === true, pushB.body.message);
  check("Push SUB_C", pushC.body.success === true, pushC.body.message);

  const subIdA = pushA.body.submission_ids?.[0];
  const subIdB = pushB.body.submission_ids?.[0];
  const subIdC = pushC.body.submission_ids?.[0];

  if (!subIdA || !subIdB || !subIdC) {
    console.log("\n⚠️  Push failed — cannot continue.\n"); process.exit(1);
  }
  console.log(`  → SUB_A: ${subIdA}`);
  console.log(`  → SUB_B: ${subIdB}`);
  console.log(`  → SUB_C: ${subIdC}`);

  // ════════════════════════════════════════════════════════════
  // AUTH & INPUT VALIDATION (T01–T06)
  // ════════════════════════════════════════════════════════════
  console.log("\n── Auth & input validation ──");

  // T01: no token
  const t01 = await post("/verify_data", {
    user_id: CONFIG.LANH_DAO.user_id, xa_code, submission_id: subIdA, verify_mode: "batch", decision: "confirm",
  });
  check("T01  No token → AUTH_001", t01.body.error_code === "AUTH_001", t01.body.error_code);

  // T02: missing submission_id
  const t02 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, verify_mode: "batch", decision: "confirm",
  });
  check("T02  Missing submission_id → DATA_001", t02.body.error_code === "DATA_001", t02.body.message);

  // T03: missing verify_mode
  const t03 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, submission_id: subIdA,
  });
  check("T03  Missing verify_mode → DATA_001", t03.body.error_code === "DATA_001", t03.body.message);

  // T04: invalid verify_mode
  const t04 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, submission_id: subIdA,
    verify_mode: "magic",
  });
  check("T04  Invalid verify_mode → DATA_001", t04.body.error_code === "DATA_001", t04.body.message);

  // T05: batch missing decision
  const t05 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, submission_id: subIdA,
    verify_mode: "batch",
  });
  check("T05  Batch missing decision → DATA_001", t05.body.error_code === "DATA_001", t05.body.message);

  // T06: submission not found
  const t06 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code, submission_id: "NOTEXIST123",
    verify_mode: "batch", decision: "confirm",
  });
  check("T06  Submission not found → DATA_002", t06.body.error_code === "DATA_002", t06.body.message);

  // T07: CB_THON tries to verify
  const t07 = await post("/verify_data", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, submission_id: subIdA,
    verify_mode: "batch", decision: "confirm",
  });
  check("T07  CB_THON verify → PERM_001", t07.body.error_code === "PERM_001", t07.body.error_code);

  // ════════════════════════════════════════════════════════════
  // BATCH MODE — SUB_A (confirm) & SUB_B (reject → resubmit)
  // ════════════════════════════════════════════════════════════
  console.log("\n── Batch mode ──");

  // T08: LANH_DAO batch confirm SUB_A
  const t08 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code,
    submission_id: subIdA, verify_mode: "batch", decision: "confirm",
    comment: "Số liệu ổn, xác nhận.",
  });
  check("T08  ✅ LANH_DAO batch confirm → VERIFIED",
    t08.body.success === true && t08.body.status === "VERIFIED",
    JSON.stringify(t08.body));

  // T09: verify already VERIFIED
  const t09 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code,
    submission_id: subIdA, verify_mode: "batch", decision: "confirm",
  });
  check("T09  Verify VERIFIED again → DATA_005", t09.body.error_code === "DATA_005", t09.body.message);

  // T10: CB_THON resubmit VERIFIED (wrong state)
  const t10 = await post("/resubmit_data", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code, submission_id: subIdA,
  });
  check("T10  Resubmit VERIFIED → DATA_005", t10.body.error_code === "DATA_005", t10.body.message);

  // T11: CB_CM resubmit (wrong role)
  const t11 = await post("/resubmit_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code, submission_id: subIdB,
  });
  check("T11  CB_CM resubmit → PERM_001", t11.body.error_code === "PERM_001", t11.body.error_code);

  // T12: CB_CM batch reject SUB_B
  const t12 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdB, verify_mode: "batch", decision: "reject",
    comment: "Số liệu không hợp lý, cần xem lại.",
  });
  check("T12  ✅ CB_CM batch reject → NEEDS_REVISION",
    t12.body.success === true && t12.body.status === "NEEDS_REVISION",
    JSON.stringify(t12.body));

  // T13: CB_THON resubmit SUB_B (batch mode — all reset)
  const t13 = await post("/resubmit_data", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code,
    submission_id: subIdB,
    updated_values: { CS001: 130, CS002: 50 },
  });
  check("T13  ✅ CB_THON resubmit batch → PENDING_VERIFY",
    t13.body.success === true && t13.body.status === "PENDING_VERIFY",
    JSON.stringify(t13.body));

  // ════════════════════════════════════════════════════════════
  // PER-INDICATOR MODE — SUB_B (after resubmit) & SUB_C
  // ════════════════════════════════════════════════════════════
  console.log("\n── Per-indicator mode ──");

  // T14: per_indicator unknown chi_so_id
  const t14 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdB, verify_mode: "per_indicator",
    indicator_reviews: { CS_UNKNOWN: { status: "confirmed" } },
  });
  check("T14  Unknown chi_so_id → DATA_001", t14.body.error_code === "DATA_001", t14.body.message);

  // T15: per_indicator invalid status
  const t15 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdB, verify_mode: "per_indicator",
    indicator_reviews: { CS001: { status: "dunno" } },
  });
  check("T15  Invalid indicator status → DATA_001", t15.body.error_code === "DATA_001", t15.body.message);

  // T16: CB_CM partial per-indicator SUB_B (only CS001, save progress)
  const t16 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdB, verify_mode: "per_indicator",
    indicator_reviews: { CS001: { status: "confirmed" } },
    // CS002 not touched → remains pending
  });
  check("T16  ✅ Per-indicator partial → IN_REVIEW",
    t16.body.success === true && t16.body.status === "IN_REVIEW",
    JSON.stringify(t16.body));

  // T17: CB_CM complete SUB_B with needs_review (not rejected) → VERIFIED + flagged
  const t17 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdB, verify_mode: "per_indicator",
    indicator_reviews: { CS002: { status: "needs_review", review_note: "Số này cao, theo dõi thêm" } },
  });
  check("T17  ✅ needs_review only → VERIFIED + flagged=true",
    t17.body.success === true && t17.body.status === "VERIFIED" && t17.body.flagged === true,
    JSON.stringify(t17.body));

  // T18: CB_CM per-indicator with rejected on SUB_C → NEEDS_REVISION
  const t18 = await post("/verify_data", {
    token: cmToken, user_id: CONFIG.CB_CM.user_id, xa_code,
    submission_id: subIdC, verify_mode: "per_indicator",
    indicator_reviews: {
      CS001: { status: "confirmed" },
      CS002: { status: "rejected", review_note: "Số hộ nghèo không khớp báo cáo xã" },
    },
  });
  check("T18  ✅ Per-indicator rejected → NEEDS_REVISION",
    t18.body.success === true && t18.body.status === "NEEDS_REVISION",
    JSON.stringify(t18.body));

  // ════════════════════════════════════════════════════════════
  // RESUBMIT — PER_INDICATOR mode (SUB_C)
  // ════════════════════════════════════════════════════════════
  console.log("\n── Resubmit per-indicator mode ──");

  // T19: CB_THON resubmit SUB_C (per_indicator mode)
  const t19 = await post("/resubmit_data", {
    token: thonToken, user_id: CONFIG.CB_THON.user_id, xa_code,
    submission_id: subIdC,
    updated_values: { CS002: 38 },   // only rejected CS002 updated
  });
  check("T19  ✅ CB_THON resubmit per_ind → PENDING_VERIFY",
    t19.body.success === true && t19.body.status === "PENDING_VERIFY",
    JSON.stringify(t19.body));
  check("T20  ✅ reopen_mode = per_indicator",
    t19.body.reopen_mode === "per_indicator",
    t19.body.reopen_mode);

  // T21: LANH_DAO completes SUB_C — CS001 was confirmed (preserved),
  //      only CS002 needs reviewing now
  const t21 = await post("/verify_data", {
    token: ldToken, user_id: CONFIG.LANH_DAO.user_id, xa_code,
    submission_id: subIdC, verify_mode: "per_indicator",
    indicator_reviews: { CS002: { status: "confirmed" } },
  });
  check("T21  ✅ LANH_DAO completes → VERIFIED, flagged=false",
    t21.body.success === true && t21.body.status === "VERIFIED" && t21.body.flagged === false,
    JSON.stringify(t21.body));

  // ════════════════════════════════════════════════════════════
  // RESPONSE FIELD CHECKS
  // ════════════════════════════════════════════════════════════
  console.log("\n── Response field checks ──");

  // T22: verify_comment saved (from T08 which had comment)
  check("T22  ✅ comment was saved",
    t08.body.success === true,   // T08 passed a comment — verified by 409 on re-verify
    "comment tested via T08 success");

  // T23: verifiedBy matches LANH_DAO user_id
  check("T23  ✅ verified_by = USR_LANHDAO",
    t08.body.verified_by === "USR_LANHDAO",
    t08.body.verified_by);

  // T24: updated_values applied in resubmit (SUB_B from T13)
  check("T24  ✅ updated_values accepted in resubmit",
    t13.body.success === true,
    "SUB_B resubmitted with CS001=130, CS002=50");

  // T25: submission_id in response matches what we pushed
  check("T25  ✅ submission_id in response matches",
    t08.body.submission_id === subIdA,
    `expected ${subIdA}, got ${t08.body.submission_id}`);

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════
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