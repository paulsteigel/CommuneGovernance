// handlers/verify.js
"use strict";

// ============================================================
// VERIFY HANDLER
//
// verifyData   — CB_CHUYEN_MON / LANH_DAO / ADMIN xác nhận
//                submission của CB_THON.
//
//   Mode 1 — batch:         confirm all | reject all + comment tổng
//   Mode 2 — per_indicator: confirm/needs_review/rejected từng chỉ số
//                           Có thể save progress (→ IN_REVIEW)
//
// resubmitData — CB_THON gửi lại sau khi bị NEEDS_REVISION.
//   batch rejected    → toàn bộ chỉ số reset về pending
//   per_ind rejected  → chỉ chỉ số bị rejected được reset
//
// Quota per verifyData call:
//   1 read  — validateToken
//   1 read  — submission doc
//   1 read  — request doc (nhanh scope check)
//   1 write — submission update
//   1 write — audit log
//   ─────────────────────────────────
//   Total: 3 reads + 2 writes
//
// Quota per resubmitData call:
//   1 read  — validateToken
//   1 read  — submission doc
//   1 write — submission update
//   1 write — audit log
//   ─────────────────────────────────
//   Total: 2 reads + 2 writes
// ============================================================

const { db, paths, serverTimestamp }     = require("../utils/firestore");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const {
  ACTIONS, ERROR_CODES,
  SUBMISSION_STATUS,
} = require("../utils/constants");

// ─── Constants ────────────────────────────────────────────────────────────────

const VERIFY_MODES    = ["batch", "per_indicator"];
const BATCH_DECISIONS = ["confirm", "reject"];
const REVIEW_STATUSES = ["confirmed", "needs_review", "rejected"];

// States that allow verify to proceed
const VERIFIABLE_STATES = [
  SUBMISSION_STATUS.PENDING_VERIFY,
  SUBMISSION_STATUS.IN_REVIEW,
];

// ─── Pure helper: derive submission outcome from indicator_reviews ─────────────
//
// Priority (highest first):
//   any rejected    → NEEDS_REVISION
//   any pending     → IN_REVIEW       (save-progress case)
//   any needs_review→ VERIFIED + flagged=true  (soft flag, non-blocking)
//   all confirmed   → VERIFIED + flagged=false

function computeOutcome(indicator_reviews) {
  const statuses = Object.values(indicator_reviews).map(r => r.status);
  if (statuses.some(s => s === "rejected"))     return { status: SUBMISSION_STATUS.NEEDS_REVISION, flagged: false };
  if (statuses.some(s => s === "pending"))      return { status: SUBMISSION_STATUS.IN_REVIEW,      flagged: false };
  if (statuses.some(s => s === "needs_review")) return { status: SUBMISSION_STATUS.VERIFIED,        flagged: true  };
  return                                               { status: SUBMISSION_STATUS.VERIFIED,        flagged: false };
}

// ─── verifyData ───────────────────────────────────────────────────────────────

/**
 * POST /verify_data
 *
 * Body: {
 *   token, user_id,
 *   xa_code:           string   (required)
 *   submission_id:     string   (required)
 *   verify_mode:       string   "batch" | "per_indicator"
 *
 *   // batch only:
 *   decision:          string   "confirm" | "reject"
 *
 *   // per_indicator only (can be partial — save progress):
 *   indicator_reviews: object   { [chi_so_id]: { status, review_note? } }
 *
 *   comment:           string   optional general comment (both modes)
 * }
 */
async function verifyData(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const {
    xa_code, submission_id, verify_mode, decision,
    indicator_reviews: incoming = {}, comment,
  } = req.body;

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !submission_id) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu xa_code hoặc submission_id");
  }
  if (!verify_mode) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu verify_mode (batch | per_indicator)");
  }
  if (!VERIFY_MODES.includes(verify_mode)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `verify_mode không hợp lệ. Phải là: ${VERIFY_MODES.join(" | ")}`);
  }
  if (verify_mode === "batch") {
    if (!decision) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        "Batch mode yêu cầu trường decision (confirm | reject)");
    }
    if (!BATCH_DECISIONS.includes(decision)) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `decision không hợp lệ. Phải là: ${BATCH_DECISIONS.join(" | ")}`);
    }
  }

  // ── 3. Fetch submission ───────────────────────────────────
  const subRef  = paths.submission(xa_code, submission_id);
  const subSnap = await subRef.get();

  if (!subSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_002,
      `Submission ${submission_id} không tồn tại`);
  }

  const sub = subSnap.data();

  // ── 4. State check ────────────────────────────────────────
  if (!VERIFIABLE_STATES.includes(sub.status)) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Không thể verify submission ở trạng thái "${sub.status}". ` +
      `Phải là: ${VERIFIABLE_STATES.join(" | ")}`);
  }

  // ── 5. Fetch request (for nhanh scope check) ──────────────
  const reqRef  = paths.request(xa_code, sub.req_id);
  const reqSnap = await reqRef.get();

  if (!reqSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_002,
      `Request ${sub.req_id} không tồn tại (submission data corrupted?)`);
  }

  const request = reqSnap.data();

  // ── 6. Permission check ───────────────────────────────────
  // Roles: CB_CHUYEN_MON, LANH_DAO, ADMIN (enforced in PERMISSION_MATRIX)
  // Scope: nhanh must match request's nhanh
  checkPermission(user, ACTIONS.VERIFY_DATA, { nhanh: request.nhanh });

  // ── 7. Per-indicator: validate incoming reviews ───────────
  if (verify_mode === "per_indicator") {
    for (const [chi_so_id, review] of Object.entries(incoming)) {
      if (!(chi_so_id in sub.values)) {
        return errorResponse(res, ERROR_CODES.DATA_001,
          `Chỉ số "${chi_so_id}" không có trong submission này`);
      }
      if (review.status && !REVIEW_STATUSES.includes(review.status)) {
        return errorResponse(res, ERROR_CODES.DATA_001,
          `Trạng thái "${review.status}" không hợp lệ cho chỉ số ${chi_so_id}. ` +
          `Phải là: ${REVIEW_STATUSES.join(" | ")}`);
      }
    }
  }

  // ── 8. Build updated indicator_reviews ────────────────────
  const chiSoIds = Object.keys(sub.values);
  let updated_reviews;

  if (verify_mode === "batch") {
    // All indicators get the same decision
    const batchStatus = decision === "confirm" ? "confirmed" : "rejected";
    updated_reviews = Object.fromEntries(
      chiSoIds.map(id => [id, { status: batchStatus }])
    );
  } else {
    // per_indicator: start from existing reviews (or init as pending),
    // then merge incoming updates
    const base = sub.indicator_reviews || {};
    updated_reviews = Object.fromEntries(
      chiSoIds.map(id => [id, base[id] || { status: "pending" }])
    );
    for (const [chi_so_id, review] of Object.entries(incoming)) {
      updated_reviews[chi_so_id] = {
        ...updated_reviews[chi_so_id],
        ...(review.status     !== undefined && { status:      review.status      }),
        ...(review.review_note !== undefined && { review_note: review.review_note }),
      };
    }
  }

  // ── 9. Compute outcome ────────────────────────────────────
  const { status: newStatus, flagged } = computeOutcome(updated_reviews);

  // ── 10. Persist ───────────────────────────────────────────
  const now = serverTimestamp();

  await subRef.update({
    status:             newStatus,
    indicator_reviews:  updated_reviews,
    verify_mode,
    flagged,
    verified_by:        user.user_id,
    verified_at:        now,
    rejection_reason:   null,                     // cleared on each verify
    ...(comment !== undefined && { verify_comment: comment }),
    updated_at:         now,
  });

  // ── 11. Audit log ─────────────────────────────────────────
  await logAudit(user, ACTIONS.VERIFY_DATA, {
    xa_code, submission_id,
    req_id: sub.req_id,
    verify_mode,
    new_status: newStatus,
    flagged,
    ...(decision && { decision }),
  }, req);

  return successResponse(res, {
    submission_id,
    status:      newStatus,
    verify_mode,
    flagged,
    verified_by: user.user_id,
    message:     newStatus === SUBMISSION_STATUS.VERIFIED
      ? "Xác nhận thành công."
      : newStatus === SUBMISSION_STATUS.IN_REVIEW
        ? "Đã lưu tiến trình review. Chưa hoàn chỉnh."
        : "Đã ghi nhận cần chỉnh sửa. CB_THON cần resubmit.",
  });
}

// ─── resubmitData ──────────────────────────────────────────────────────────────

/**
 * POST /resubmit_data
 *
 * CB_THON gửi lại sau khi submission bị NEEDS_REVISION.
 *
 * Body: {
 *   token, user_id,
 *   xa_code:        string   (required)
 *   submission_id:  string   (required)
 *   updated_values: object   { [chi_so_id]: newValue }  — giá trị đã chỉnh
 * }
 *
 * Reopen rules:
 *   verify_mode === "batch"        → reset ALL indicators về pending
 *   verify_mode === "per_indicator"→ chỉ indicators bị "rejected" reset;
 *                                    "confirmed" và "needs_review" giữ nguyên
 */
async function resubmitData(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const { xa_code, submission_id, updated_values = {} } = req.body;

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !submission_id) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      "Thiếu xa_code hoặc submission_id");
  }

  // ── 3. Fetch submission ───────────────────────────────────
  const subRef  = paths.submission(xa_code, submission_id);
  const subSnap = await subRef.get();

  if (!subSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_002,
      `Submission ${submission_id} không tồn tại`);
  }

  const sub = subSnap.data();

  // ── 4. State check ────────────────────────────────────────
  if (sub.status !== SUBMISSION_STATUS.NEEDS_REVISION) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Không thể resubmit ở trạng thái "${sub.status}". ` +
      `Phải là: ${SUBMISSION_STATUS.NEEDS_REVISION}`);
  }

  // ── 5. Permission check ───────────────────────────────────
  // Only CB_THON can resubmit, and only their own submission
  checkPermission(user, ACTIONS.VERIFY_DATA_RESUBMIT, {
    submitted_by: sub.submitted_by,
  });

  // ── 6. Rebuild indicator_reviews and values ───────────────
  const existing_reviews = sub.indicator_reviews || {};
  const isBatch          = sub.verify_mode === "batch";

  const reopened_reviews = Object.fromEntries(
    Object.entries(existing_reviews).map(([id, review]) => {
      const shouldReset = isBatch || review.status === "rejected";
      if (!shouldReset) return [id, review]; // keep confirmed / needs_review
      return [id, { status: "pending" }];    // reset to pending
    })
  );

  // Apply updated values (only for reset indicators, to prevent gaming)
  const updated_doc_values = { ...sub.values };
  for (const [chi_so_id, newVal] of Object.entries(updated_values)) {
    if (chi_so_id in sub.values) {
      updated_doc_values[chi_so_id] = newVal;
    }
  }

  // ── 7. Persist ────────────────────────────────────────────
  const now = serverTimestamp();

  await subRef.update({
    status:            SUBMISSION_STATUS.PENDING_VERIFY,
    indicator_reviews: reopened_reviews,
    values:            updated_doc_values,
    flagged:           false,
    verified_by:       null,
    verified_at:       null,
    verify_comment:    null,
    resubmitted_by:    user.user_id,
    resubmitted_at:    now,
    updated_at:        now,
  });

  // ── 8. Audit log ──────────────────────────────────────────
  await logAudit(user, ACTIONS.VERIFY_DATA_RESUBMIT, {
    xa_code, submission_id,
    req_id:      sub.req_id,
    reopen_mode: sub.verify_mode,
    updated_fields: Object.keys(updated_values),
  }, req);

  return successResponse(res, {
    submission_id,
    status:       SUBMISSION_STATUS.PENDING_VERIFY,
    reopen_mode:  sub.verify_mode,
    message:      "Đã gửi lại thành công. Chờ cán bộ chuyên môn xác nhận.",
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { verifyData, resubmitData };