#!/usr/bin/env node
/**
 * seed_test_data.js — Reset & seed all Firestore test data
 * v3: simpler user_ids (thon01/cbcm01/lanhdao), phone login, Abc password
 * Usage: node tests/seed_test_data.js
 */
"use strict";

const admin  = require("firebase-admin");
const crypto = require("crypto");
const path   = require("path");

const serviceAccount = require(path.join(__dirname, "../service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db        = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

function generateSalt()     { return crypto.randomBytes(16).toString("hex"); }
function hashPassword(p, s) { return crypto.createHash("sha256").update(p + s).digest("hex"); }
function generateToken()    { return crypto.randomBytes(32).toString("hex"); }

const XA_CODE = "XATEST";
const YEAR    = 2026;
const PASS    = "Abc";

const USERS = [
  {
    user_id: "thon01", ho_ten: "Nguyen Van Thon 1",
    phone: "0901000001", cccd: "079100000001",
    chuc_danh: "Truong thon THON01",
    vai_tro: "CB_THON", don_vi: "THON01", nhanh: "UBND", linh_vuc_codes: [],
  },
  {
    user_id: "thon02", ho_ten: "Nguyen Van Thon 2",
    phone: "0901000011", cccd: "079100000011",
    chuc_danh: "Truong thon THON02",
    vai_tro: "CB_THON", don_vi: "THON02", nhanh: "UBND", linh_vuc_codes: [],
  },
  {
    user_id: "cbcm01", ho_ten: "Le Thi Chuyen Mon",
    phone: "0901000002", cccd: "079100000002",
    chuc_danh: "Can bo Phong Nong nghiep",
    vai_tro: "CB_CHUYEN_MON", don_vi: "PHONG_NONG_NGHIEP", nhanh: "UBND",
    linh_vuc_codes: ["NONG_NGHIEP", "XA_HOI"],
  },
  {
    user_id: "lanhdao", ho_ten: "Tran Van Lanh Dao",
    phone: "0901000003", cccd: "079100000003",
    chuc_danh: "Chu tich UBND xa",
    vai_tro: "LANH_DAO", don_vi: "XA", nhanh: "UBND", linh_vuc_codes: [],
  },
  {
    user_id: "admin01", ho_ten: "Nguyen Thi Admin",
    phone: "0901000004", cccd: "079100000004",
    chuc_danh: "Van phong UBND - Quan tri he thong",
    vai_tro: "ADMIN", don_vi: "XA", nhanh: "UBND", linh_vuc_codes: [],
  },
];

const INDICATORS = [
  {
    chi_so_id: "CS001", ten_chi_so: "Diện tích canh tác lúa 2 vụ",
    mo_ta: "Tong dien tich canh tac lua 2 vụ trong thon",
    don_vi_do: "ha", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND", validation: { required: true, min: 0, max: 10000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS002", ten_chi_so: "Số hộ nghèo",
    mo_ta: "So ho duoc xep loai ngheo trong thon",
    don_vi_do: "ho", kieu_du_lieu: "so", linh_vuc: "XA_HOI",
    nhanh: "UBND", validation: { required: true, min: 0, max: 1000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS003", ten_chi_so: "Chiều dài đường nội đồng đi lại được bằng xe máy",
    mo_ta: "Tổng chiều dài đường nội đồng trong thôn có thể đi lại được bằng xe máy",
    don_vi_do: "km", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND", validation: { required: true, min: 0, max: 1000 }, status: "ACTIVE",
  },
  {
    chi_so_id: "CS_DRAFT01", ten_chi_so: "So luong ao ca",
    mo_ta: "Tong so ao nuoi ca trong thon",
    don_vi_do: "ao", kieu_du_lieu: "so", linh_vuc: "NONG_NGHIEP",
    nhanh: "UBND", validation: { required: true, min: 0, max: 500 }, status: "DRAFT",
  },
];

async function deleteCollection(collRef) {
  const snap = await collRef.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function seed() {
  console.log("\n====================================================");
  console.log("  Seeding Firestore test data  v3");
  console.log("  Xa: " + XA_CODE + "  |  Nam: " + YEAR + "  |  Pass: " + PASS + "  (cap A)");
  console.log("====================================================\n");

  const now       = Timestamp.now();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  console.log("Clearing old submissions...");
  const deleted = await deleteCollection(
    db.collection("communes").doc(XA_CODE).collection("submissions")
  );
  console.log("  Deleted " + deleted + " old submission(s)\n");

  const batch = db.batch();

  // xa_registry
  batch.set(db.collection("xa_registry").doc(XA_CODE), {
    xa_code: XA_CODE, xa_name: "Xa Trieu Son (Test)", tinh: "Quang Tri",
    drive_folder_id: "TEST_DRIVE_FOLDER", status: "ACTIVE", created_at: now,
  });
  console.log("OK xa_registry/XATEST");

  // users
  for (const u of USERS) {
    const salt  = generateSalt();
    const hash  = hashPassword(PASS, salt);
    const token = generateToken();
    batch.set(db.collection("users").doc(u.user_id), {
      user_id:        u.user_id,
      xa_code:        XA_CODE,
      ho_ten:         u.ho_ten,
      phone:          u.phone,
      cccd:           u.cccd,
      chuc_danh:      u.chuc_danh,
      vai_tro:        u.vai_tro,
      don_vi:         u.don_vi,
      nhanh:          u.nhanh,
      linh_vuc_codes: u.linh_vuc_codes,
      other_branches: [],
      password_hash:  hash,
      password_salt:  salt,
      session_token:  token,
      token_expires_at: expiresAt,
      status:         "ACTIVE",
      last_login_at:  now,
      created_at:     now,
    });
    console.log("OK users/" + u.user_id.padEnd(10) + "  phone: " + u.phone + "  (" + u.vai_tro + ")");
  }

  // indicators
  for (const ind of INDICATORS) {
    batch.set(
      db.collection("communes").doc(XA_CODE).collection("indicators").doc(ind.chi_so_id),
      {
        ...ind,
        created_by:  "lanhdao",
        approved_by: ind.status === "ACTIVE" ? "lanhdao" : null,
        approved_at: ind.status === "ACTIVE" ? now : null,
        created_at: now, updated_at: now, year: YEAR,
      }
    );
  }
  console.log("\nOK indicators: " + INDICATORS.map(i => i.chi_so_id).join(", "));

  // requests
  const manifestVersion = "v" + new Date().toISOString().replace(/[-:.TZ]/g,"").substring(0,15);

  const requests = [
    {
      req_id: "REQ001", tieu_de: "Bao cao nong nghiep Q2/2025",
      tao_boi: "lanhdao", nhanh: "UBND",
      danh_sach_thon: ["THON01", "THON02"],
      chi_so_ids: ["CS001", "CS002", "CS003"],
      linh_vuc_list: ["NONG_NGHIEP", "XA_HOI", "CO_SO_HA_TANG"],
      deadline: "2025-12-31", ghi_chu: "So lieu tinh den cuoi nam 2025",
      status: "IN_PROGRESS", excluded_thon: [],
    },
    {
      req_id: "REQ002", tieu_de: "Bao cao Q1/2025 (da hoan thanh)",
      tao_boi: "lanhdao", nhanh: "UBND",
      danh_sach_thon: ["THON01"],
      chi_so_ids: ["CS001"],
      linh_vuc_list: ["NONG_NGHIEP"],
      deadline: "2025-03-31", ghi_chu: "Request hoan thanh de test public view",
      status: "COMPLETED", excluded_thon: [],
      published_at: now, published_by: "lanhdao",
    },
  ];

  for (const r of requests) {
    batch.set(
      db.collection("communes").doc(XA_CODE).collection("requests").doc(r.req_id),
      { ...r, manifest_version: manifestVersion, created_at: now, year: YEAR }
    );
  }
  console.log("OK requests: REQ001 (IN_PROGRESS), REQ002 (COMPLETED)");

  // submissions
  const sub1At = Timestamp.fromDate(new Date(Date.now() - 2  * 60 * 60 * 1000));
  const sub2At = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("submissions").doc("SUB001"),
    {
      submission_id: "SUB001", req_id: "REQ001", thon_code: "THON01",
      nhanh: "UBND", year: YEAR,
      submitted_by: "thon01", submitted_at: sub1At, device_collected_at: sub1At,
      values: { CS001: 45.5, CS002: 12, CS003: true },
      status: "PENDING_VERIFY", revision_number: 0,
      reviewed_by: null, reviewed_at: null, review_started_at: null,
      review_comment: null, indicator_reviews: {},
      is_bypass: false, escalated_at: null,
      manifest_version_used: manifestVersion,
    }
  );

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("submissions").doc("SUB002"),
    {
      submission_id: "SUB002", req_id: "REQ001", thon_code: "THON02",
      nhanh: "UBND", year: YEAR,
      submitted_by: "thon01", submitted_at: sub2At, device_collected_at: sub2At,
      values: { CS001: 30.0, CS002: 8, CS003: false },
      status: "NEEDS_REVISION", revision_number: 1,
      reviewed_by: "cbcm01",
      reviewed_at:       Timestamp.fromDate(new Date(Date.now() - 12 * 60 * 60 * 1000)),
      review_started_at: Timestamp.fromDate(new Date(Date.now() - 13 * 60 * 60 * 1000)),
      review_comment: "So lieu dien tich lua co ve thap bat thuong, de nghi kiem tra lai.",
      indicator_reviews: { CS001: { status: "ISSUE", comment: "Can xac minh lai" } },
      is_bypass: false, escalated_at: null,
      manifest_version_used: manifestVersion,
    }
  );

  // VERIFIED submission cho REQ002 (public view test)
  batch.set(
    db.collection("communes").doc(XA_CODE).collection("submissions").doc("SUB_C01"),
    {
      submission_id: "SUB_C01", req_id: "REQ002", thon_code: "THON01",
      nhanh: "UBND", year: YEAR,
      submitted_by: "thon01",
      submitted_at: Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000)),
      values: { CS001: 50.0 },
      status: "VERIFIED", revision_number: 0,
      reviewed_by: "cbcm01",
      reviewed_at: Timestamp.fromDate(new Date(Date.now() - 36 * 60 * 60 * 1000)),
      review_comment: null, indicator_reviews: {},
      is_bypass: false, escalated_at: null,
      manifest_version_used: manifestVersion,
    }
  );
  console.log("OK submissions: SUB001 (PENDING_VERIFY), SUB002 (NEEDS_REVISION), SUB_C01 (VERIFIED)");

  // manifest
  const activeIndicators = INDICATORS.filter(i => i.status === "ACTIVE");
  const openRequests     = requests.filter(r => r.status === "OPEN" || r.status === "IN_PROGRESS");

  batch.set(
    db.collection("communes").doc(XA_CODE).collection("manifests").doc("current"),
    {
      version: manifestVersion, generated_at: now,
      xa_code: XA_CODE, xa_name: "Xa Trieu Son (Test)", year: YEAR,
      indicators: activeIndicators.map(({ chi_so_id, ten_chi_so, mo_ta,
                                          don_vi_do, kieu_du_lieu, linh_vuc, validation }) => ({
        chi_so_id, ten_chi_so, mo_ta, don_vi_do, kieu_du_lieu, linh_vuc, validation,
      })),
      requests: openRequests.map(({ req_id, tieu_de, chi_so_ids, nhanh,
                                    danh_sach_thon, deadline, ghi_chu, tao_boi }) => ({
        req_id, tieu_de, chi_so_ids, nhanh, danh_sach_thon, deadline, ghi_chu, tao_boi,
      })),
      drive_folder_id: "TEST_DRIVE_FOLDER",
    }
  );
  console.log("OK manifests/current  (version: " + manifestVersion + ")\n");

  await batch.commit();

  console.log("====================================================");
  console.log("  DONE — Dang nhap bang so dien thoai + Abc");
  console.log("====================================================");
  console.log("");
  console.log("  Truong thon  ->  0901000001  /  Abc  (thon01)");
  console.log("  Can bo CM    ->  0901000002  /  Abc  (cbcm01)");
  console.log("  Lanh dao     ->  0901000003  /  Abc  (lanhdao)");
  console.log("  Admin        ->  0901000004  /  Abc  (admin01)");
  console.log("");
  console.log("  Public URL (kiem tra sau deploy):");
  console.log("  GET https://careapi-cx7avsd4pa-as.a.run.app/public/xa/XATEST/results");
  console.log("====================================================\n");
}

seed()
  .then(() => process.exit(0))
  .catch(err => { console.error("FAILED: " + err.message); process.exit(1); });
