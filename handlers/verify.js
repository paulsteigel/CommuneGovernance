'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const VERIFY_ROLES    = ['CB_CM', 'LANH_DAO'];
const SUBMIT_ROLES    = ['CB_THON'];
const VERIFY_MODES    = ['batch', 'per_indicator'];
const BATCH_DECISIONS = ['confirm', 'reject'];
const IND_STATUSES    = ['confirmed', 'needs_review', 'rejected'];
const VERIFY_STATES   = ['submitted', 'in_review'];   // states verifier can act on
const RESUB_STATES    = ['needs_revision'];            // states CB_THON can resubmit from

// ─── Pure helper: compute batch outcome from indicators map ───────────────────

/**
 * Given a map of { indicatorId: { status, ... } }, derive the new submission status.
 *
 * Rules (in priority order):
 *   any rejected   → needs_revision
 *   any pending    → in_review       (save-progress case)
 *   any needs_review (no rejected)  → verified + flagged
 *   all confirmed  → verified
 */
function computeOutcome(indicators) {
  const statuses = Object.values(indicators).map(i => i.status);

  if (statuses.some(s => s === 'rejected'))     return { status: 'needs_revision', flagged: false };
  if (statuses.some(s => s === 'pending'))      return { status: 'in_review',      flagged: false };
  if (statuses.some(s => s === 'needs_review')) return { status: 'verified',       flagged: true  };
  return                                               { status: 'verified',       flagged: false };
}

// ─── verifySubmission ─────────────────────────────────────────────────────────

/**
 * CB_CM or LANH_DAO verifies a submission.
 *
 * payload {
 *   submissionId  string   required
 *   verifyMode    string   "batch" | "per_indicator"
 *
 *   // batch only:
 *   decision      string   "confirm" | "reject"
 *
 *   // per_indicator only (can be partial — save progress):
 *   indicators    object   { [indicatorId]: { status, reviewNote? } }
 *
 *   comment       string   optional general comment (both modes)
 * }
 *
 * context { user: { userId, role, xa } }
 */
async function verifySubmission(payload, context, { db, now }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const { user } = context;
  if (!user) {
    return { success: false, code: 401, message: 'Unauthorized' };
  }
  if (!VERIFY_ROLES.includes(user.role)) {
    return { success: false, code: 403, message: 'Forbidden: only CB_CM or LANH_DAO can verify' };
  }

  // ── 2. Input validation ────────────────────────────────────────────────────
  const { submissionId, verifyMode, decision, indicators = {}, comment } = payload;

  if (!submissionId) {
    return { success: false, code: 400, message: 'Missing required field: submissionId' };
  }
  if (!verifyMode) {
    return { success: false, code: 400, message: 'Missing required field: verifyMode' };
  }
  if (!VERIFY_MODES.includes(verifyMode)) {
    return { success: false, code: 400, message: `Invalid verifyMode. Must be: ${VERIFY_MODES.join(' | ')}` };
  }
  if (verifyMode === 'batch') {
    if (!decision) {
      return { success: false, code: 400, message: 'Batch mode requires field: decision (confirm | reject)' };
    }
    if (!BATCH_DECISIONS.includes(decision)) {
      return { success: false, code: 400, message: `Invalid decision. Must be: ${BATCH_DECISIONS.join(' | ')}` };
    }
  }

  // ── 3. Fetch submission ────────────────────────────────────────────────────
  const subRef  = db.collection('submissions').doc(submissionId);
  const subSnap = await subRef.get();

  if (!subSnap.exists) {
    return { success: false, code: 404, message: `Submission not found: ${submissionId}` };
  }

  const sub = subSnap.data();

  // ── 4. State guard ─────────────────────────────────────────────────────────
  if (!VERIFY_STATES.includes(sub.status)) {
    return {
      success: false,
      code: 409,
      message: `Cannot verify submission with status "${sub.status}". Must be: ${VERIFY_STATES.join(' | ')}`,
    };
  }

  // ── 5. Build updated indicator map ─────────────────────────────────────────
  const existing = sub.indicators || {};
  let updated;

  if (verifyMode === 'batch') {
    const batchStatus = decision === 'confirm' ? 'confirmed' : 'rejected';
    updated = Object.fromEntries(
      Object.entries(existing).map(([id, ind]) => [
        id,
        { ...ind, status: batchStatus },
      ])
    );
  } else {
    // per_indicator — validate incoming entries first
    for (const [indId, indData] of Object.entries(indicators)) {
      if (!(indId in existing)) {
        return { success: false, code: 400, message: `Unknown indicator ID: ${indId}` };
      }
      if (indData.status && !IND_STATUSES.includes(indData.status)) {
        return {
          success: false,
          code: 400,
          message: `Invalid status "${indData.status}" for indicator ${indId}. Must be: ${IND_STATUSES.join(' | ')}`,
        };
      }
    }

    // Merge: untouched indicators keep status 'pending' (or their current status)
    updated = { ...existing };
    for (const [indId, indData] of Object.entries(indicators)) {
      updated[indId] = {
        ...existing[indId],
        ...(indData.status     !== undefined && { status:     indData.status     }),
        ...(indData.reviewNote !== undefined && { reviewNote: indData.reviewNote }),
      };
    }
  }

  // ── 6. Compute outcome ─────────────────────────────────────────────────────
  const { status: newStatus, flagged } = computeOutcome(updated);

  // ── 7. Persist ─────────────────────────────────────────────────────────────
  const patch = {
    indicators:    updated,
    status:        newStatus,
    flagged,
    verifyMode,
    verifiedBy:    user.userId,
    verifiedAt:    now,
    updatedAt:     now,
    ...(comment !== undefined && { verifyComment: comment }),
  };

  await subRef.update(patch);

  return {
    success:    true,
    submissionId,
    status:     newStatus,
    flagged,
    verifyMode,
    verifiedBy: user.userId,
  };
}

// ─── resubmitData ─────────────────────────────────────────────────────────────

/**
 * CB_THON resubmits after rejection.
 *
 * payload {
 *   submissionId   string   required
 *   updatedValues  object   { [indicatorId]: newValue }  — corrected values
 * }
 *
 * Reopen rules (mirrors rejection scope):
 *   verifyMode === 'batch'        → ALL indicators reset to pending
 *   verifyMode === 'per_indicator'→ only 'rejected' indicators reset; others untouched
 */
async function resubmitData(payload, context, { db, now }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const { user } = context;
  if (!user) {
    return { success: false, code: 401, message: 'Unauthorized' };
  }
  if (!SUBMIT_ROLES.includes(user.role)) {
    return { success: false, code: 403, message: 'Forbidden: only CB_THON can resubmit' };
  }

  // ── 2. Validate ────────────────────────────────────────────────────────────
  const { submissionId, updatedValues = {} } = payload;
  if (!submissionId) {
    return { success: false, code: 400, message: 'Missing required field: submissionId' };
  }

  // ── 3. Fetch ───────────────────────────────────────────────────────────────
  const subRef  = db.collection('submissions').doc(submissionId);
  const subSnap = await subRef.get();

  if (!subSnap.exists) {
    return { success: false, code: 404, message: `Submission not found: ${submissionId}` };
  }

  const sub = subSnap.data();

  // ── 4. State guard ─────────────────────────────────────────────────────────
  if (!RESUB_STATES.includes(sub.status)) {
    return {
      success: false,
      code: 409,
      message: `Cannot resubmit with status "${sub.status}". Must be: needs_revision`,
    };
  }

  // ── 5. Reopen indicators ───────────────────────────────────────────────────
  const existing = sub.indicators || {};
  const isBatch  = sub.verifyMode === 'batch';

  const reopened = Object.fromEntries(
    Object.entries(existing).map(([id, ind]) => {
      const shouldReset = isBatch || ind.status === 'rejected';
      if (!shouldReset) return [id, ind]; // keep confirmed / needs_review as-is

      return [id, {
        ...ind,
        status:      'pending',
        reviewNote:  undefined,
        ...(updatedValues[id] !== undefined && { value: updatedValues[id] }),
      }];
    })
  );

  // ── 6. Persist ─────────────────────────────────────────────────────────────
  await subRef.update({
    indicators:     reopened,
    status:         'submitted',
    flagged:        false,
    verifiedBy:     null,
    verifiedAt:     null,
    verifyComment:  null,
    resubmittedBy:  user.userId,
    resubmittedAt:  now,
    updatedAt:      now,
  });

  return {
    success:       true,
    submissionId,
    status:        'submitted',
    reopenedMode:  sub.verifyMode,
    resubmittedBy: user.userId,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { verifySubmission, resubmitData, computeOutcome };