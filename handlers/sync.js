// handlers/sync.js
"use strict";

// ============================================================
// SYNC TO SHEETS HANDLER
//
// syncToSheets — Chạy lúc nửa đêm (Cloud Scheduler).
//               Export toàn bộ VERIFIED submissions chưa sync
//               lên Google Sheets. Mỗi request = 1 tab.
//
// Thiết kế quota-efficient:
//   - Dùng timestamp checkpoint (last_sync_at) thay vì flag
//     per-document → KHÔNG cần sửa verify.js hay document schema
//   - 1 query per xa lấy submissions VERIFIED sau checkpoint
//   - Batch write Google Sheets (1 API call per spreadsheet)
//   - Update checkpoint 1 lần sau khi sync thành công
//
// Quota per xa (N = số submissions mới verified):
//   1 read  — sync_state doc
//   1 read  — submissions query (VERIFIED + verified_at > checkpoint)
//   R reads — batch get R request docs  (R = unique req_ids)
//   1 read  — indicators collection (cho header tên chỉ số)
//   3+ Sheets API calls (get tabs, create if needed, batchUpdate values)
//   1 write — sync_state update (checkpoint)
//   ───────────────────────────────────────────────────────────
//   Firestore: (R+3) reads + 1 write — không phụ thuộc N!
//
// Protected by X-Internal-Secret header (set in index.js).
// ============================================================

const { db, admin, paths, serverTimestamp } = require("../utils/firestore");
const { successResponse, errorResponse }    = require("../utils/response");
const { ERROR_CODES, SUBMISSION_STATUS }    = require("../utils/constants");
const { google }                            = require("googleapis");

// ─── Google Sheets auth (Application Default Credentials on Cloud Run) ──────

const sheetsAuth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Firestore Timestamp → readable string "DD/MM/YYYY HH:MM" */
function fmtTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
  } catch { return ""; }
}

/** Translate verify status to Vietnamese label */
function reviewLabel(status) {
  return { confirmed: "Xác nhận ✓", needs_review: "Xem lại ⚠", rejected: "Từ chối ✗", pending: "Chờ" }[status] || status || "";
}

/**
 * Build sheet rows for one request's submissions.
 * Returns { headers: string[], rows: string[][] }
 */
function buildSheetData(submissions, request, indicatorMap) {
  const chiSoIds = request.chi_so_ids || [];

  // Static column headers
  const staticHeaders = [
    "Thôn", "Ngày gửi", "Người gửi",
    "Đã chỉnh sửa", "Ngày chỉnh sửa",
    "Người verify", "Ngày verify",
    "Chế độ verify", "Cần xem lại", "Ghi chú verify",
  ];

  // Dynamic indicator columns (value + review per indicator)
  const indHeaders = chiSoIds.flatMap(id => {
    const ind = indicatorMap[id];
    const label = ind
      ? `${id} — ${ind.ten_chi_so}${ind.don_vi_do ? ` (${ind.don_vi_do})` : ""}`
      : id;
    return [label, `${id} — Kết quả xét duyệt`];
  });

  const headers = [...staticHeaders, ...indHeaders];

  const rows = submissions.map(sub => {
    const staticRow = [
      sub.thon_code                  || "",
      fmtTimestamp(sub.submitted_at),
      sub.submitted_by               || "",
      sub.resubmitted_at ? "Có"       : "Không",
      fmtTimestamp(sub.resubmitted_at),
      sub.verified_by                || "",
      fmtTimestamp(sub.verified_at),
      sub.verify_mode === "batch" ? "Theo bộ số liệu" : "Theo từng chỉ số",
      sub.flagged ? "⚠ Có"           : "Không",
      sub.verify_comment             || "",
    ];

    const indRow = chiSoIds.flatMap(id => [
      sub.values?.[id] ?? "",
      reviewLabel(sub.indicator_reviews?.[id]?.status),
    ]);

    return [...staticRow, ...indRow];
  });

  return { headers, rows };
}

/**
 * Get existing sheet tab names in a spreadsheet.
 * Returns Set<string>
 */
async function getExistingTabs(sheetsClient, spreadsheetId) {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  return new Set((meta.data.sheets || []).map(s => s.properties.title));
}

/**
 * Create missing tabs in one batchUpdate call.
 */
async function createMissingTabs(sheetsClient, spreadsheetId, tabNames) {
  if (tabNames.length === 0) return;
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabNames.map(title => ({
        addSheet: { properties: { title } },
      })),
    },
  });
}

/**
 * Write headers + rows to sheet tabs (one Sheets API call for all tabs).
 * Uses ROWS major dimension. Clears tab first to avoid duplicates.
 */
async function writeToSheets(sheetsClient, spreadsheetId, tabDataList) {
  if (tabDataList.length === 0) return;

  // Build batchUpdate data list: one entry per tab
  const data = tabDataList.map(({ tabName, headers, rows }) => ({
    range:          `'${tabName}'!A1`,
    majorDimension: "ROWS",
    values:         [headers, ...rows],
  }));

  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",  // allows date parsing
      data,
    },
  });
}

// ─── syncToSheets ─────────────────────────────────────────────────────────────

/**
 * POST /sync_to_sheets
 * (Protected by X-Internal-Secret header — already checked in index.js)
 *
 * Body: {
 *   xa_code?:  string  (optional — sync specific xa; omit to sync all ACTIVE)
 *   year?:     number  (optional — filter, default = current year)
 *   dry_run?:  boolean (optional — build data but skip Sheets write, for testing)
 * }
 */
async function syncToSheets(req, res) {
  const startTime = Date.now();
  const dryRun    = req.body.dry_run === true || req.body.dry_run === "true";
  const yearParam = req.body.year ? Number(req.body.year) : new Date().getFullYear();
  const xaFilter  = req.body.xa_code || null;

  // ── 1. Get list of xas to sync ────────────────────────────
  let xaList = [];
  if (xaFilter) {
    xaList = [{ xa_code: xaFilter }];
  } else {
    const xaSnap = await db.collection("xa_registry")
      .where("status", "==", "ACTIVE")
      .get();
    xaList = xaSnap.docs.map(d => d.data());
  }

  if (xaList.length === 0) {
    return successResponse(res, {
      synced_xas: 0, total_rows_synced: 0,
      message: "Không tìm thấy xã nào để sync",
      duration_ms: Date.now() - startTime,
    });
  }

  // ── 2. Process each xa ────────────────────────────────────
  const results      = [];
  let totalRowsSynced = 0;

  for (const xa of xaList) {
    const xa_code    = xa.xa_code;
    const sheets_id  = xa.sheets_id;
    const xaResult   = { xa_code, rows_synced: 0, skipped: false, error: null };

    try {
      // ── 2a. Read sync checkpoint ──────────────────────────
      const syncStateRef = db.collection("communes").doc(xa_code)
                             .collection("config").doc("sync_state");
      const syncStateSnap = await syncStateRef.get();
      const lastSyncAt    = syncStateSnap.exists
        ? (syncStateSnap.data().last_sheets_sync_at || new admin.firestore.Timestamp(0, 0))
        : new admin.firestore.Timestamp(0, 0);

      // ── 2b. Fetch new verified submissions since checkpoint
      const subsSnap = await paths.submissions(xa_code)
        .where("status",      "==", SUBMISSION_STATUS.VERIFIED)
        .where("verified_at", ">",  lastSyncAt)
        .get();

      if (subsSnap.empty) {
        xaResult.skipped = true;
        xaResult.message = "Không có submission mới cần sync";
        results.push(xaResult);
        continue;
      }

      const subs = subsSnap.docs.map(d => d.data());

      // ── 2c. Batch-fetch request docs ──────────────────────
      const uniqueReqIds = [...new Set(subs.map(s => s.req_id))];
      const reqRefs      = uniqueReqIds.map(id => paths.request(xa_code, id));
      const reqSnaps     = await db.getAll(...reqRefs);
      const requestMap   = {};
      reqSnaps.forEach(s => { if (s.exists) requestMap[s.id] = s.data(); });

      // ── 2d. Fetch indicators (for column headers) ─────────
      const indSnap    = await paths.indicators(xa_code).get();
      const indicatorMap = {};
      indSnap.docs.forEach(d => { indicatorMap[d.id] = d.data(); });

      // ── 2e. Group submissions by req_id ───────────────────
      const subsByReq = {};
      for (const sub of subs) {
        if (!subsByReq[sub.req_id]) subsByReq[sub.req_id] = [];
        subsByReq[sub.req_id].push(sub);
      }

      // ── 2f. Build tab data for each req_id ────────────────
      const tabDataList = [];
      for (const req_id of uniqueReqIds) {
        const request = requestMap[req_id];
        if (!request) continue;
        const reqSubs = subsByReq[req_id] || [];
        const { headers, rows } = buildSheetData(reqSubs, request, indicatorMap);
        tabDataList.push({ tabName: req_id, headers, rows });
      }

      const rowCount = tabDataList.reduce((acc, t) => acc + t.rows.length, 0);

      if (!dryRun && sheets_id && sheets_id !== "TEST_SHEETS_ID") {
        // ── 2g. Write to Google Sheets ──────────────────────
        const sheetsClient = google.sheets({ version: "v4", auth: sheetsAuth });

        const existingTabs  = await getExistingTabs(sheetsClient, sheets_id);
        const tabsToCreate  = tabDataList
          .map(t => t.tabName)
          .filter(name => !existingTabs.has(name));
        await createMissingTabs(sheetsClient, sheets_id, tabsToCreate);
        await writeToSheets(sheetsClient, sheets_id, tabDataList);
      }

      // ── 2h. Update checkpoint (only on real sync or dry run flag) ──
      if (!dryRun) {
        await syncStateRef.set(
          { last_sheets_sync_at: serverTimestamp(), updated_at: serverTimestamp() },
          { merge: true }
        );
      }

      xaResult.rows_synced    = rowCount;
      xaResult.tabs_updated   = tabDataList.map(t => t.tabName);
      xaResult.dry_run        = dryRun;
      totalRowsSynced        += rowCount;

    } catch (err) {
      // Never let one xa's failure block others
      console.error(`[SYNC] Error processing xa ${xa_code}:`, err.message);
      xaResult.error = err.message;
    }

    results.push(xaResult);
  }

  // ── 3. Log to Cloud Functions console (no Firestore write for audit) ──────
  console.log(`[SYNC] Completed: ${totalRowsSynced} rows across ${xaList.length} xas in ${Date.now() - startTime}ms${dryRun ? " (DRY RUN)" : ""}`);

  return successResponse(res, {
    synced_xas:       results.filter(r => r.rows_synced > 0).length,
    total_rows_synced: totalRowsSynced,
    dry_run:          dryRun,
    results,
    duration_ms:      Date.now() - startTime,
  });
}

module.exports = { syncToSheets };
