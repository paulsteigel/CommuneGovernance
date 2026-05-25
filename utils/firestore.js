"use strict";

const admin = require("firebase-admin");

// ============================================================
// FIRESTORE SINGLETON
// Initialized once at module load; Cloud Functions reuse the
// same instance across warm invocations (no extra quota cost).
// ============================================================

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ============================================================
// PATH HELPERS
// Centralized path builders — change paths in one place only.
// ============================================================

const paths = {
  user:          (userId)              => db.collection("users").doc(userId),
  xa:            (xaCode)             => db.collection("config").doc("xa_registry").collection(xaCode).doc(xaCode),
  manifest:      (xaCode)             => db.collection("communes").doc(xaCode).collection("manifests").doc("current"),
  indicators:    (xaCode)             => db.collection("communes").doc(xaCode).collection("indicators"),
  indicator:     (xaCode, id)         => db.collection("communes").doc(xaCode).collection("indicators").doc(id),
  requests:      (xaCode)             => db.collection("communes").doc(xaCode).collection("requests"),
  request:       (xaCode, reqId)      => db.collection("communes").doc(xaCode).collection("requests").doc(reqId),
  submissions:   (xaCode)             => db.collection("communes").doc(xaCode).collection("submissions"),
  submission:    (xaCode, subId)      => db.collection("communes").doc(xaCode).collection("submissions").doc(subId),
  auditLogs:     ()                   => db.collection("audit_logs"),
};

// ============================================================
// BATCH HELPERS
// Always use these instead of doc().get() in a loop.
// ============================================================

/**
 * Get multiple documents by reference in one round-trip (getAll).
 * Returns a map of { docId: data | null }.
 * @param {FirebaseFirestore.DocumentReference[]} refs
 * @returns {Promise<Object>}
 */
async function batchGet(refs) {
  if (!refs || refs.length === 0) return {};
  const snaps = await db.getAll(...refs);
  const result = {};
  for (const snap of snaps) {
    result[snap.id] = snap.exists ? { id: snap.id, ...snap.data() } : null;
  }
  return result;
}

/**
 * Run a collection query and return all docs as an array of plain objects.
 * @param {FirebaseFirestore.Query} query
 * @returns {Promise<Array>}
 */
async function queryAll(query) {
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Write multiple documents atomically (up to 500 ops per batch).
 * @param {Array<{ ref: FirebaseFirestore.DocumentReference, data: object, merge?: boolean }>} ops
 * @returns {Promise<void>}
 */
async function batchWrite(ops) {
  if (!ops || ops.length === 0) return;

  // Split into chunks of 500 (Firestore limit)
  const CHUNK_SIZE = 500;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const { ref, data, merge = false } of chunk) {
      if (merge) {
        batch.set(ref, data, { merge: true });
      } else {
        batch.set(ref, data);
      }
    }
    await batch.commit();
  }
}

/**
 * Server timestamp shorthand.
 */
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

module.exports = {
  db,
  admin,
  paths,
  batchGet,
  queryAll,
  batchWrite,
  serverTimestamp,
};
