"use strict";

const express   = require("express");
const { onRequest } = require("firebase-functions/v2/https");

const { asyncHandler }  = require("./utils/response");
const authHandler       = require("./handlers/auth");

// Handlers loaded lazily — Cloud Functions cold start stays fast.
// Only auth is eagerly loaded; others are required on first call.
let dataHandler, indicatorsHandler, requestsHandler,
    verifyHandler, dashboardHandler, syncHandler;

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" })); // enough for batch submissions
app.use(express.urlencoded({ extended: false }));

// Basic security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// ── Health check (no auth, no Firestore read) ─────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Auth endpoints ────────────────────────────────────────────
app.post("/login",         asyncHandler(authHandler.login));
app.post("/logout",        asyncHandler(authHandler.logout));
app.post("/pull_manifest", asyncHandler(authHandler.pullManifest));

// ── Data endpoints (offline-first, CB_THON) ───────────────────
app.post("/push_data", asyncHandler(async (req, res) => {
  if (!dataHandler) dataHandler = require("./handlers/data");
  return dataHandler.pushData(req, res);
}));

// ── Management endpoints (online, CB_CM + LANH_DAO) ───────────
app.post("/create_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.createIndicator(req, res);
}));

app.post("/approve_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.approveIndicator(req, res);
}));

app.post("/create_request", asyncHandler(async (req, res) => {
  if (!requestsHandler) requestsHandler = require("./handlers/requests");
  return requestsHandler.createRequest(req, res);
}));

app.post("/verify_data", asyncHandler(async (req, res) => {
  if (!verifyHandler) verifyHandler = require("./handlers/verify");
  return verifyHandler.verifyData(req, res);
}));

// ── Reporting endpoint ────────────────────────────────────────
app.get("/dashboard", asyncHandler(async (req, res) => {
  if (!dashboardHandler) dashboardHandler = require("./handlers/dashboard");
  // GET: parse query params into body-like shape for consistency
  req.body = { ...req.body, ...req.query };
  return dashboardHandler.getDashboard(req, res);
}));

// ── Internal endpoint (Cloud Scheduler — not exposed publicly) ─
// Protect with a shared secret header: X-Internal-Secret
app.post("/sync_to_sheets", asyncHandler(async (req, res) => {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  if (!syncHandler) syncHandler = require("./handlers/sync");
  return syncHandler.syncToSheets(req, res);
}));

// ── 404 catch-all ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error_code: "SYS_001",
    message: "Endpoint không tồn tại",
  });
});

// ── Export as Cloud Function (v2) ─────────────────────────────
exports.careApi = onRequest(
  {
    region:        process.env.REGION || "asia-southeast1",
    timeoutSeconds: 60,
    memory:        "256MiB",
    minInstances:  0, // scale to zero — $0 when idle
  },
  app
);
