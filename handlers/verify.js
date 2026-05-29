// handlers/verify.js
"use strict";

const { db, paths, serverTimestamp }     = require("../utils/firestore");
const { validateToken }                  = require("../middleware/validateToken");
const { checkPermission }                = require("../middleware/checkPermission");
const { logAudit }                       = require("../middleware/logAudit");
const { successResponse, errorResponse } = require("../utils/response");
const {
  ACTIONS, ERROR_CODES,
  SUBMISSION_STATUS,
} = require("../utils/constants");

const VERIFY_MODES    = ["batch", "per_indicator"];
const BATCH_DECISIONS = ["confirm", "reject"];
const REVIEW_STATUSES = ["confirmed", "needs_review", "rejected"];

// States that allow verify to proceed
const VERIFIABLE_STATES = [
  SUBMISSION_STATUS.PENDING_VERIFY,
  SUBMISSION_STATUS.IN_REVIEW,
];

// ── Outcome computation ──────────────────────────────────────
function computeOutcome(indicator_reviews) {
  const statuses = Object.values(indicator_reviews).map(r => r.status);
  if (statuses.some(s => s === "rejected"))     return { status: SUBMISSION_STATUS.NEEDS_REVISION, flagged: false };
  if (statuses.some(s => s === "pending"))      return { status: SUBMISSION_STATUS.IN_REVIEW,      flagged: false };
  if (statuses.some(s => s === "needs_review")) return { status: SUBMISSION_STATUS.VERIFIED,        flagged: true  };
  return                                               { status: SUBMISSION_STATUS.VERIFIED,        flagged: false };
}

// ─── verifyData ───────────────────────────────────────────────

async function verifyData(req, res) {

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await validateToken(req);

  const {
    xa_code, submission_id, verify_mode, decision,
    indicator_reviews: incoming = {},
    // FIX B1: accept both field names for backwards compat
    comment,
    verify_comment,
  } = req.body;

  // Use whichever was sent; "comment" is the canonical name
  const effectiveComment = comment ?? verify_comment ?? undefined;

  // ── 2. Input validation ───────────────────────────────────
  if (!xa_code || !submission_id) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc submission_id");
  }
  if (!verify_mode || !VERIFY_MODES.includes(verify_mode)) {
    return errorResponse(res, ERROR_CODES.DATA_001,
      `verify_mode không hợp lệ. Phải là: ${VERIFY_MODES.join(" | ")}`);
  }
  if (verify_mode === "batch") {
    if (!decision || !BATCH_DECISIONS.includes(decision)) {
      return errorResponse(res, ERROR_CODES.DATA_001,
        `Batch mode yêu cầu decision: ${BATCH_DECISIONS.join(" | ")}`);
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
      `Không thể xác nhận submission ở trạng thái "${sub.status}". ` +
      `Submission phải ở trạng thái: ${VERIFIABLE_STATES.join(" | ")}. ` +
      `Trạng thái "NEEDS_REVISION" cần CB_THON gửi lại trước.`);
  }

  // ── 5. Fetch request ──────────────────────────────────────
  const reqRef  = paths.request(xa_code, sub.req_id);
  const reqSnap = await reqRef.get();

  if (!reqSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_002,
      `Request ${sub.req_id} không tồn tại`);
  }

  const request = reqSnap.data();

  // ── 6. Permission check ───────────────────────────────────
  checkPermission(user, ACTIONS.VERIFY_DATA, {
    nhanh:         request.nhanh,
    linh_vuc_list: request.linh_vuc_list || [],
  });

  // ── 7. Per-indicator: validate incoming reviews ───────────
  if (verify_mode === "per_indicator") {
    for (const [chi_so_id, review] of Object.entries(incoming)) {
      if (!(chi_so_id in sub.values)) {
        return errorResponse(res, ERROR_CODES.DATA_001,
          `Chỉ số "${chi_so_id}" không có trong submission này`);
      }
      if (review.status && !REVIEW_STATUSES.includes(review.status)) {
        return errorResponse(res, ERROR_CODES.DATA_001,
          `Trạng thái "${review.status}" không hợp lệ. Phải là: ${REVIEW_STATUSES.join(" | ")}`);
      }
    }
  }

  // ── 8. Build updated indicator_reviews ────────────────────
  const chiSoIds = Object.keys(sub.values);
  let updated_reviews;

  if (verify_mode === "batch") {
    const batchStatus = decision === "confirm" ? "confirmed" : "rejected";
    updated_reviews = Object.fromEntries(
      chiSoIds.map(id => [id, { status: batchStatus }])
    );
  } else {
    const base = sub.indicator_reviews || {};
    updated_reviews = Object.fromEntries(
      chiSoIds.map(id => [id, base[id] || { status: "pending" }])
    );
    for (const [chi_so_id, review] of Object.entries(incoming)) {
      updated_reviews[chi_so_id] = {
        ...updated_reviews[chi_so_id],
        ...(review.status      !== undefined && { status:      review.status      }),
        ...(review.review_note !== undefined && { review_note: review.review_note }),
      };
    }
  }

  // ── 9. Compute outcome ────────────────────────────────────
  const { status: newStatus, flagged } = computeOutcome(updated_reviews);

  // ── 10. Persist ───────────────────────────────────────────
  const now = serverTimestamp();

  await subRef.update({
    status:            newStatus,
    indicator_reviews: updated_reviews,
    verify_mode,
    flagged,
    verified_by:       user.user_id,
    verified_at:       now,
    rejection_reason:  null,
    ...(effectiveComment !== undefined && { verify_comment: effectiveComment }),
    updated_at: now,
  });

  // ── 11. Audit log ─────────────────────────────────────────
  await logAudit(user, ACTIONS.VERIFY_DATA, {
    xa_code, submission_id,
    req_id:      sub.req_id,
    verify_mode, new_status: newStatus, flagged,
    ...(decision && { decision }),
    ...(effectiveComment && { comment: effectiveComment }),
  }, req);

  return successResponse(res, {
    submission_id,
    status:      newStatus,
    verify_mode, flagged,
    verified_by: user.user_id,
    message:
      newStatus === SUBMISSION_STATUS.VERIFIED
        ? "Xác nhận thành công."
        : newStatus === SUBMISSION_STATUS.IN_REVIEW
          ? "Đã lưu tiến trình. Chưa hoàn tất."
          : "Đã ghi nhận cần chỉnh sửa. CB_THON sẽ nhận thông báo để gửi lại.",
  });
}

// ─── resubmitData ─────────────────────────────────────────────

async function resubmitData(req, res) {

  const user = await validateToken(req);
  const { xa_code, submission_id, updated_values = {} } = req.body;

  if (!xa_code || !submission_id) {
    return errorResponse(res, ERROR_CODES.DATA_001, "Thiếu xa_code hoặc submission_id");
  }

  const subRef  = paths.submission(xa_code, submission_id);
  const subSnap = await subRef.get();

  if (!subSnap.exists) {
    return errorResponse(res, ERROR_CODES.DATA_002, `Submission ${submission_id} không tồn tại`);
  }

  const sub = subSnap.data();

  // Only CB_THON, only own submission
  checkPermission(user, ACTIONS.VERIFY_DATA_RESUBMIT, {
    submitted_by: sub.submitted_by,
  });

  if (sub.status !== SUBMISSION_STATUS.NEEDS_REVISION) {
    return errorResponse(res, ERROR_CODES.DATA_005,
      `Không thể gửi lại ở trạng thái "${sub.status}". Phải là: NEEDS_REVISION`);
  }

  // Reset rejected indicators, keep confirmed ones
  const existing_reviews = sub.indicator_reviews || {};
  const isBatch          = sub.verify_mode === "batch";

  const reopened_reviews = Object.fromEntries(
    Object.entries(existing_reviews).map(([id, review]) => {
      const shouldReset = isBatch || review.status === "rejected";
      if (!shouldReset) return [id, review];
      return [id, { status: "pending" }];
    })
  );

  // Apply updated values
  const new_values = { ...sub.values };
  for (const [id, val] of Object.entries(updated_values)) {
    if (id in sub.values) new_values[id] = val;
  }

  const now = serverTimestamp();

  await subRef.update({
    status:            SUBMISSION_STATUS.PENDING_VERIFY,
    indicator_reviews: reopened_reviews,
    values:            new_values,
    flagged:           false,
    verified_by:       null,
    verified_at:       null,
    verify_comment:    null,
    resubmitted_by:    user.user_id,
    resubmitted_at:    now,
    updated_at:        now,
  });

  await logAudit(user, ACTIONS.VERIFY_DATA_RESUBMIT, {
    xa_code, submission_id,
    req_id: sub.req_id,
    reopen_mode: sub.verify_mode,
    updated_fields: Object.keys(updated_values),
  }, req);

  return successResponse(res, {
    submission_id,
    status:      SUBMISSION_STATUS.PENDING_VERIFY,
    reopen_mode: sub.verify_mode,
    message:     "Đã gửi lại thành công. Chờ cán bộ chuyên môn xác nhận.",
  });
}

module.exports = { verifyData, resubmitData };
