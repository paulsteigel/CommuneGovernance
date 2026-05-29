//index.js
"use strict";

const express   = require("express");
const { onRequest } = require("firebase-functions/v2/https");

const { asyncHandler }  = require("./utils/response");
const authHandler       = require("./handlers/auth");

let dataHandler, indicatorsHandler, requestsHandler,
    verifyHandler, dashboardHandler, syncHandler, reportHandler;

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Auth ──────────────────────────────────────────────────────
app.post("/login",         asyncHandler(authHandler.login));
app.post("/logout",        asyncHandler(authHandler.logout));
app.post("/pull_manifest", asyncHandler(authHandler.pullManifest));

// ── Data (CB_THON) ────────────────────────────────────────────
app.post("/push_data", asyncHandler(async (req, res) => {
  if (!dataHandler) dataHandler = require("./handlers/data");
  return dataHandler.pushData(req, res);
}));

app.post("/resubmit_data", asyncHandler(async (req, res) => {
  if (!verifyHandler) verifyHandler = require("./handlers/verify");
  return verifyHandler.resubmitData(req, res);
}));

// ── Indicators (CB_CM + LANH_DAO) ────────────────────────────
app.post("/create_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.createIndicator(req, res);
}));

app.post("/submit_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.submitIndicator(req, res);
}));

app.post("/approve_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.approveIndicator(req, res);
}));

app.post("/reject_indicator", asyncHandler(async (req, res) => {
  if (!indicatorsHandler) indicatorsHandler = require("./handlers/indicators");
  return indicatorsHandler.rejectIndicator(req, res);
}));

// ── Requests ──────────────────────────────────────────────────
app.post("/create_request", asyncHandler(async (req, res) => {
  if (!requestsHandler) requestsHandler = require("./handlers/requests");
  return requestsHandler.createRequest(req, res);
}));

// ── Verify ────────────────────────────────────────────────────
app.post("/verify_data", asyncHandler(async (req, res) => {
  if (!verifyHandler) verifyHandler = require("./handlers/verify");
  return verifyHandler.verifyData(req, res);
}));

// ── Reporting ─────────────────────────────────────────────────
app.get("/dashboard", asyncHandler(async (req, res) => {
  if (!dashboardHandler) dashboardHandler = require("./handlers/dashboard");
  req.body = { ...req.body, ...req.query };
  return dashboardHandler.getDashboard(req, res);
}));

app.get("/report_data", asyncHandler(async (req, res) => {
  if (!reportHandler) reportHandler = require("./handlers/report");
  req.body = { ...req.body, ...req.query };
  return reportHandler.getReportData(req, res);
}));

// ── Internal ──────────────────────────────────────────────────
app.post("/sync_to_sheets", asyncHandler(async (req, res) => {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  if (!syncHandler) syncHandler = require("./handlers/sync");
  return syncHandler.syncToSheets(req, res);
}));

app.use((_req, res) => {
  res.status(404).json({ success: false, error_code: "SYS_001", message: "Endpoint không tồn tại" });
});

exports.careApi = onRequest(
  {
    region:         process.env.REGION || "asia-southeast1",
    timeoutSeconds: 60,
    memory:         "256MiB",
    minInstances:   0,
  },
  app
);
