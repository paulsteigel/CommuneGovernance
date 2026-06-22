// utils/firestore.js  —  Village Linker V6
// ============================================================
// Path changes V5 → V6:
//   communes/{xa}/requests    → communes/{xa}/tasks
//   communes/{xa}/submissions → communes/{xa}/task_responses
//   config/xa_registry/...    → communes/{xa_code}  (flat commune doc)
// ============================================================
"use strict";

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ============================================================
// PATH HELPERS
// Centralised — change paths in one place only.
// Sub-collection strategy (under communes/{xa_code}/) keeps
// security rules simple and is semantically correct.
// SUPER_ADMIN cross-commune queries use collectionGroup().
// ============================================================

const paths = {
  // ── Users ──────────────────────────────────────────────────
  user:           (userId)          => db.collection("users").doc(userId),
  users:          ()                => db.collection("users"),

  // ── Commune document (root of per-commune data) ───────────
  // V6: communes/{xa_code} is the commune config doc itself.
  // Sub-collections hang off this doc.
  commune:        (xaCode)          => db.collection("communes").doc(xaCode),

  // ── Manifest (offline version-marker) ────────────────────
  manifest:       (xaCode)          => db.collection("communes").doc(xaCode)
                                          .collection("manifests").doc("current"),

  // ── Indicators ───────────────────────────────────────────
  indicators:     (xaCode)          => db.collection("communes").doc(xaCode)
                                          .collection("indicators"),
  indicator:      (xaCode, id)      => db.collection("communes").doc(xaCode)
                                          .collection("indicators").doc(id),

  // ── Tasks (V6 name — replaces V5 "requests") ─────────────
  tasks:          (xaCode)          => db.collection("communes").doc(xaCode)
                                          .collection("tasks"),
  task:           (xaCode, taskId)  => db.collection("communes").doc(xaCode)
                                          .collection("tasks").doc(taskId),

  // ── Task Responses (V6 name — replaces V5 "submissions") ──
  taskResponses:  (xaCode)          => db.collection("communes").doc(xaCode)
                                          .collection("task_responses"),
  taskResponse:   (xaCode, respId)  => db.collection("communes").doc(xaCode)
                                          .collection("task_responses").doc(respId),

  // ── Admin / auth management ───────────────────────────────
  bootstrapLinks: ()                => db.collection("bootstrap_links"),
  bootstrapLink:  (id)              => db.collection("bootstrap_links").doc(id),
  inviteLinks:    ()                => db.collection("invite_links"),
  inviteLink:     (id)              => db.collection("invite_links").doc(id),

  // ── Audit log (top-level, append-only) ───────────────────
  auditLogs:      ()                => db.collection("audit_logs"),
};

// ============================================================
// COLLECTION GROUP HELPERS
// For SUPER_ADMIN cross-commune queries.
// ============================================================

const groups = {
  tasks:          () => db.collectionGroup("tasks"),
  taskResponses:  () => db.collectionGroup("task_responses"),
  indicators:     () => db.collectionGroup("indicators"),
};

// ============================================================
// BATCH HELPERS
// ============================================================

/**
 * Batch-get multiple documents in one round-trip.
 * Returns a plain object: { [docId]: data | null }
 * @param {FirebaseFirestore.DocumentReference[]} refs
 */
async function batchGet(refs) {
  if (!refs || refs.length === 0) return {};
  const snaps  = await db.getAll(...refs);
  const result = {};
  for (const snap of snaps) {
    result[snap.id] = snap.exists ? { id: snap.id, ...snap.data() } : null;
  }
  return result;
}

/**
 * Run a Firestore query and return all docs as plain objects.
 * @param {FirebaseFirestore.Query} query
 */
async function queryAll(query) {
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Atomic batch write (auto-chunks at 500 ops — Firestore limit).
 * @param {Array<{ ref, data, merge?: bool }>} ops
 */
async function batchWrite(ops) {
  if (!ops || ops.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    for (const { ref, data, merge = false } of ops.slice(i, i + CHUNK)) {
      merge ? batch.set(ref, data, { merge: true }) : batch.set(ref, data);
    }
    await batch.commit();
  }
}

/**
 * Firestore server timestamp shorthand.
 */
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

module.exports = {
  db,
  admin,
  paths,
  groups,
  batchGet,
  queryAll,
  batchWrite,
  serverTimestamp,
};