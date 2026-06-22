//index.js
"use strict";

const express   = require("express");
const { onRequest } = require("firebase-functions/v2/https");

const { asyncHandler }  = require("./utils/response");
const authHandler       = require("./handlers/auth");

let dataHandler, indicatorsHandler, requestsHandler,
    verifyHandler, dashboardHandler, syncHandler, reportHandler,
    publicHandler, adminHandler, superAdminHandler;

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

app.patch("/update_request_status", asyncHandler(async (req, res) => {
  if (!requestsHandler) requestsHandler = require("./handlers/requests");
  return requestsHandler.updateRequestStatus(req, res);
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

// ── Public (no auth) ──────────────────────────────────────────
app.get("/public/xa/:xa_code/results", asyncHandler(async (req, res) => {
  if (!publicHandler) publicHandler = require("./handlers/public");
  return publicHandler.getPublicResults(req, res);
}));

// ── Registration (public — uses invite link) ──────────────────
// GET  /register?token=XXX  → HTML registration form
app.get("/register", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.registerPage(req, res);
}));

// POST /register → API endpoint (used by HTML form above & mobile app)
app.post("/register", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.register(req, res);
}));

// ── Admin ─────────────────────────────────────────────────────
app.post("/admin/create_invite_link", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.createInviteLink(req, res);
}));

app.post("/admin/list_pending_users", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.listPendingUsers(req, res);
}));

app.post("/admin/approve_user", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.approveUser(req, res);
}));

app.post("/admin/reset_password", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.resetPassword(req, res);
}));

app.get("/admin/commune_config", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  req.body = { ...req.body, ...req.query }; // merge token/user_id for GET
  return adminHandler.getCommuneConfig(req, res);
}));

app.post("/admin/setup_commune", asyncHandler(async (req, res) => {
  if (!adminHandler) adminHandler = require("./handlers/admin");
  return adminHandler.setupCommune(req, res);
}));

// ── Super-Admin ────────────────────────────────────────────────
app.post("/super-admin/create_commune", asyncHandler(async (req, res) => {
  if (!superAdminHandler) superAdminHandler = require("./handlers/superAdmin");
  return superAdminHandler.createCommune(req, res);
}));

app.post("/super-admin/bootstrap_link", asyncHandler(async (req, res) => {
  if (!superAdminHandler) superAdminHandler = require("./handlers/superAdmin");
  return superAdminHandler.createBootstrapLink(req, res);
}));

app.get("/super-admin/communes", asyncHandler(async (req, res) => {
  if (!superAdminHandler) superAdminHandler = require("./handlers/superAdmin");
  req.body = { ...req.body, ...req.query };
  return superAdminHandler.listCommunes(req, res);
}));

// ── Bootstrap (Admin first-time setup — public) ───────────────
app.get("/bootstrap", asyncHandler(async (req, res) => {
  if (!superAdminHandler) superAdminHandler = require("./handlers/superAdmin");
  return superAdminHandler.bootstrapPage(req, res);
}));

app.post("/bootstrap/register", asyncHandler(async (req, res) => {
  if (!superAdminHandler) superAdminHandler = require("./handlers/superAdmin");
  return superAdminHandler.bootstrapRegister(req, res);
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
