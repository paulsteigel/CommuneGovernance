// ── ADD THIS FUNCTION to services/api.js ────────────────────
//
// Place alongside the other exported functions (pushData, verifyData, etc.)
//
// POST /resubmit_data
// CB_THON gửi lại submission sau khi bị NEEDS_REVISION.
//
export async function resubmitData({ token, user_id, xa_code, submission_id, updated_values }) {
  return post("/resubmit_data", {
    token,
    user_id,
    xa_code,
    submission_id,
    updated_values,
  });
}
