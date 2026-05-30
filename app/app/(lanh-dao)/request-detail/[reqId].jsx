// app/(lanh-dao)/request-detail/[reqId].jsx
// Chi tiết yêu cầu thu thập — LANH_DAO view
//
// Hiển thị:
//   • Header: tiêu đề, trạng thái, deadline, linh vực
//   • Tiến độ tổng hợp: progress bar + stats
//   • Bảng từng thôn: trạng thái, ai nộp, ai duyệt
//   • Actions: Hoàn thành / Hủy yêu cầu / Loại thôn

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, Alert, Modal,
  TextInput, ActivityIndicator, SectionList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../../store/authStore";
import { getDashboard, updateRequestStatus, pullManifest } from "../../../services/api";
import StatusBadge from "../../../components/StatusBadge";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../../constants/theme";
import { REQUEST_STATUS_LABELS } from "../../../constants/config";

const THON_STATUS_COLOR = {
  VERIFIED:        COLORS.primary,
  IN_REVIEW:       COLORS.inReview,
  PENDING_VERIFY:  COLORS.accentLight,
  NEEDS_REVISION:  COLORS.danger,
  not_submitted:   COLORS.textHint,
  excluded:        COLORS.textHint,
};

const THON_STATUS_LABEL = {
  VERIFIED:        "Đã duyệt ✓",
  IN_REVIEW:       "Đang xem xét",
  PENDING_VERIFY:  "Chờ duyệt",
  NEEDS_REVISION:  "Cần chỉnh sửa",
  not_submitted:   "Chưa nộp",
  excluded:        "Đã loại",
};

export default function RequestDetailScreen() {
  const { reqId }  = useLocalSearchParams();
  const router     = useRouter();
  const { token, user, xa_code, year, manifest } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reqDetail,  setReqDetail]  = useState(null);

  // Modal states
  const [completeModal, setCompleteModal]   = useState(false);
  const [cancelModal,   setCancelModal]     = useState(false);
  const [excludeModal,  setExcludeModal]    = useState(false);
  const [excludeThon,   setExcludeThon]     = useState(null);
  const [cancelReason,  setCancelReason]    = useState("");
  const [excludeReason, setExcludeReason]   = useState("");
  const [submitting,    setSubmitting]       = useState(false);

  // Find request from manifest (quick) + dashboard for per-thon detail
  const manifestReq = manifest?.requests?.find(
    r => (r.req_id || r.id) === reqId
  );

  async function fetchDetail() {
    try {
      const data = await getDashboard({
        token, user_id: user.user_id, xa_code, year, req_id: reqId,
      });
      // getDashboard with req_id returns per-thon detail
      setReqDetail(data);
    } catch (e) {
      console.warn("RequestDetail fetch:", e.message);
    }
  }

  useEffect(() => {
    fetchDetail().finally(() => setLoading(false));
  }, [reqId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDetail();
    setRefreshing(false);
  }, [reqId]);

  // ── Derive display data ────────────────────────────────────
  // Use dashboard detail if available, fallback to manifest
  const req = reqDetail?.request || manifestReq || {};
  const thonProgress = reqDetail?.thon_progress || [];

  // Build per-thon rows from dashboard data or danh_sach_thon
  const allThons  = req.danh_sach_thon || [];
  const excluded  = new Set((req.excluded_thon || []).map(e => e.thon_code));

  const thonRows = thonProgress.length > 0
    ? thonProgress
    : allThons.map(t => ({
        thon_code:    t,
        status:       excluded.has(t) ? "excluded" : "not_submitted",
        submitted_by: null,
        verified_by:  null,
        submitted_at: null,
      }));

  const verified    = thonRows.filter(t => t.status === "VERIFIED").length;
  const required    = thonRows.filter(t => t.status !== "excluded").length;
  const completePct = required > 0 ? Math.round((verified / required) * 100) : 0;
  const canComplete = verified === required && required > 0 &&
                      req.status !== "COMPLETED" && req.status !== "CANCELLED";

  const isClosed = req.status === "COMPLETED" || req.status === "CANCELLED";

  // ── Actions ───────────────────────────────────────────────
  async function doComplete() {
    setSubmitting(true);
    try {
      const result = await updateRequestStatus({
        token, user_id: user.user_id, xa_code,
        req_id: reqId, action: "complete",
      });
      // Refresh manifest
      const mData = await pullManifest({
        token, user_id: user.user_id, xa_code, year,
        current_version: manifest?.manifest_version,
      });
      if (!mData.up_to_date) updateManifest(mData.manifest);

      setCompleteModal(false);
      Alert.alert("✅ Hoàn thành!", result.message || "Kết quả đã được công bố.", [
        { text: "OK", onPress: () => { fetchDetail(); } },
      ]);
    } catch (e) {
      Alert.alert("Không thể hoàn thành", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function doCancel() {
    if (!cancelReason.trim()) {
      Alert.alert("Thiếu lý do", "Vui lòng nhập lý do hủy");
      return;
    }
    setSubmitting(true);
    try {
      await updateRequestStatus({
        token, user_id: user.user_id, xa_code,
        req_id: reqId, action: "cancel",
        cancel_reason: cancelReason.trim(),
      });
      const mData = await pullManifest({
        token, user_id: user.user_id, xa_code, year,
        current_version: manifest?.manifest_version,
      });
      if (!mData.up_to_date) updateManifest(mData.manifest);

      setCancelModal(false);
      setCancelReason("");
      Alert.alert("Đã hủy", "Yêu cầu thu thập đã bị hủy.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Lỗi", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function doExcludeThon() {
    if (!excludeReason.trim() || !excludeThon) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập lý do loại thôn");
      return;
    }
    setSubmitting(true);
    try {
      await updateRequestStatus({
        token, user_id: user.user_id, xa_code,
        req_id: reqId, action: "exclude_thon",
        thon_code: excludeThon,
        reason: excludeReason.trim(),
      });
      setExcludeModal(false);
      setExcludeReason("");
      setExcludeThon(null);
      Alert.alert("Đã loại thôn", `Thôn ${excludeThon} đã được loại khỏi yêu cầu.`);
      fetchDetail();
    } catch (e) {
      Alert.alert("Lỗi", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────
  function renderThonRow(thon) {
    const statusKey = thon.status || "not_submitted";
    const color     = THON_STATUS_COLOR[statusKey] || COLORS.textHint;
    const label     = THON_STATUS_LABEL[statusKey] || statusKey;
    const isExcl    = statusKey === "excluded";

    return (
      <View key={thon.thon_code} style={[styles.thonRow, isExcl && styles.thonRowExcluded]}>
        <View style={styles.thonLeft}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <View>
            <Text style={[styles.thonName, isExcl && { color: COLORS.textHint }]}>
              Thôn {thon.thon_code}
            </Text>
            {thon.submitted_by && (
              <Text style={styles.thonMeta}>
                Nộp: {thon.submitted_by}
                {thon.submitted_at ? ` · ${thon.submitted_at.slice(0, 10)}` : ""}
              </Text>
            )}
            {thon.verified_by && (
              <Text style={styles.thonMeta}>Duyệt: {thon.verified_by}</Text>
            )}
          </View>
        </View>
        <View style={styles.thonRight}>
          <Text style={[styles.thonStatus, { color }]}>{label}</Text>
          {!isExcl && !isClosed && statusKey === "not_submitted" && (
            <TouchableOpacity
              style={styles.excludeBtn}
              onPress={() => { setExcludeThon(thon.thon_code); setExcludeModal(true); }}
            >
              <Ionicons name="remove-circle-outline" size={18} color={COLORS.danger} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <LoadingOverlay message="Đang tải chi tiết..." />
      </SafeAreaView>
    );
  }

  const statusLabel = REQUEST_STATUS_LABELS[req.status] || req.status;
  const barColor    = completePct === 100 ? COLORS.primary
                    : completePct > 50    ? "#F59E0B"
                    : COLORS.accent;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {req.tieu_de || reqId}
          </Text>
          <Text style={styles.headerMeta}>
            {statusLabel} · {req.nhanh} · {req.deadline || "—"}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* Progress summary */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Tiến độ thực hiện</Text>
            <Text style={styles.progressPct}>{completePct}%</Text>
          </View>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, {
              width: `${completePct}%`,
              backgroundColor: barColor,
            }]} />
          </View>
          <View style={styles.statsRow}>
            {[
              { num: allThons.length,     label: "Tổng thôn",   color: COLORS.textPrimary },
              { num: required,            label: "Bắt buộc",    color: COLORS.textPrimary },
              { num: verified,            label: "Đã duyệt ✓",  color: COLORS.primary },
              { num: required - verified, label: "Còn lại",     color: required - verified > 0 ? COLORS.accent : COLORS.textHint },
            ].map(s => (
              <View key={s.label} style={styles.statItem}>
                <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Action buttons */}
        {!isClosed && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.completeBtn,
                !canComplete && styles.actionBtnDisabled]}
              onPress={() => canComplete && setCompleteModal(true)}
              disabled={!canComplete}
              activeOpacity={canComplete ? 0.8 : 1}
            >
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={canComplete ? COLORS.white : COLORS.textHint}
              />
              <Text style={[styles.actionBtnText,
                !canComplete && { color: COLORS.textHint }]}>
                Hoàn thành
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={() => setCancelModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={20} color={COLORS.danger} />
              <Text style={[styles.actionBtnText, { color: COLORS.danger }]}>
                Hủy yêu cầu
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!canComplete && !isClosed && (
          <View style={styles.hintCard}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.inReview} />
            <Text style={styles.hintText}>
              Cần {required - verified} thôn nữa được duyệt để hoàn thành.
              Có thể loại thôn không thể nộp khỏi yêu cầu.
            </Text>
          </View>
        )}

        {/* Thon list */}
        <View style={styles.thonSection}>
          <Text style={styles.sectionTitle}>
            Danh sách thôn ({allThons.length})
          </Text>
          {thonRows.map(renderThonRow)}
        </View>

        {/* Indicators */}
        {req.chi_so_ids?.length > 0 && (
          <View style={styles.indicatorSection}>
            <Text style={styles.sectionTitle}>
              Chỉ số ({req.chi_so_ids.length})
            </Text>
            {req.chi_so_ids.map(id => {
              const ind = manifest?.indicators?.find(i => i.chi_so_id === id);
              return (
                <View key={id} style={styles.indicatorRow}>
                  <Ionicons name="analytics-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.indicatorText}>
                    {ind?.ten_chi_so || id}
                    {ind?.don_vi_do ? ` (${ind.don_vi_do})` : ""}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Complete Modal ── */}
      <Modal visible={completeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="checkmark-circle" size={48} color={COLORS.primary} style={{ alignSelf: "center" }} />
            <Text style={styles.modalTitle}>Hoàn thành thu thập?</Text>
            <Text style={styles.modalBody}>
              Tất cả {verified}/{required} thôn đã được duyệt.{"\n"}
              Kết quả sẽ được công bố công khai sau khi xác nhận.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setCompleteModal(false)}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>Chưa</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, submitting && { opacity: 0.6 }]}
                onPress={doComplete}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.modalConfirmText}>Xác nhận công bố</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Cancel Modal ── */}
      <Modal visible={cancelModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="close-circle" size={48} color={COLORS.danger} style={{ alignSelf: "center" }} />
            <Text style={styles.modalTitle}>Hủy yêu cầu?</Text>
            <Text style={styles.modalBody}>
              Tất cả các bản ghi đã nộp sẽ bị hủy. Hành động này không thể hoàn tác.
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Lý do hủy (bắt buộc)..."
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
              maxLength={200}
              placeholderTextColor={COLORS.textHint}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setCancelModal(false); setCancelReason(""); }}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>Không</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDangerBtn, submitting && { opacity: 0.6 }]}
                onPress={doCancel}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.modalConfirmText}>Hủy yêu cầu</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Exclude Thon Modal ── */}
      <Modal visible={excludeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Loại thôn {excludeThon}?</Text>
            <Text style={styles.modalBody}>
              Thôn này sẽ không cần nộp số liệu cho yêu cầu này.
              Lý do sẽ được ghi lại để truy trách nhiệm.
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Lý do loại thôn (bắt buộc)..."
              value={excludeReason}
              onChangeText={setExcludeReason}
              multiline
              maxLength={200}
              placeholderTextColor={COLORS.textHint}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setExcludeModal(false); setExcludeReason(""); setExcludeThon(null); }}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDangerBtn, submitting && { opacity: 0.6 }]}
                onPress={doExcludeThon}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.modalConfirmText}>Xác nhận loại</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.background },
  header:        {
    backgroundColor:  COLORS.primary,
    flexDirection:    "row",
    alignItems:       "flex-start",
    paddingHorizontal: SPACING.md,
    paddingTop:        SPACING.md,
    paddingBottom:     SPACING.lg,
    gap:               SPACING.sm,
  },
  backBtn:       { padding: SPACING.xs, marginTop: 2 },
  headerTitle:   { ...TYPOGRAPHY.titleMedium, color: COLORS.white, flex: 1 },
  headerMeta:    { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  scroll:        { flex: 1 },
  scrollContent: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },

  progressCard:  { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, ...SHADOW.card, gap: SPACING.sm },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  progressPct:   { ...TYPOGRAPHY.titleLarge, color: COLORS.primary },
  progressBg:    { height: 12, backgroundColor: COLORS.divider, borderRadius: RADIUS.full, overflow: "hidden" },
  progressFill:  { height: "100%", borderRadius: RADIUS.full },
  statsRow:      { flexDirection: "row", marginTop: SPACING.xs },
  statItem:      { flex: 1, alignItems: "center", gap: 2 },
  statNum:       { ...TYPOGRAPHY.titleLarge },
  statLabel:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, textAlign: "center" },

  actionsRow:    { flexDirection: "row", gap: SPACING.sm },
  actionBtn:     {
    flex:           1,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    height:          TOUCH_TARGET,
    borderRadius:    RADIUS.md,
    gap:             SPACING.xs,
    ...SHADOW.card,
  },
  completeBtn:        { backgroundColor: COLORS.primary },
  cancelBtn:          { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.danger },
  actionBtnDisabled:  { backgroundColor: COLORS.divider },
  actionBtnText:      { ...TYPOGRAPHY.labelLarge, color: COLORS.white },

  hintCard:      {
    flexDirection:   "row",
    backgroundColor: COLORS.inReviewBg || "#E3F2FD",
    borderRadius:    RADIUS.md,
    padding:         SPACING.md,
    gap:             SPACING.sm,
    alignItems:      "flex-start",
  },
  hintText:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.inReview, flex: 1 },

  sectionTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: SPACING.sm },

  thonSection:   { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, ...SHADOW.card },
  thonRow:       {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    gap:             SPACING.sm,
  },
  thonRowExcluded: { opacity: 0.5 },
  thonLeft:      { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm, flex: 1 },
  statusDot:     { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  thonName:      { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  thonMeta:      { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  thonRight:     { alignItems: "flex-end", gap: SPACING.xs },
  thonStatus:    { ...TYPOGRAPHY.caption, fontWeight: "600" },
  excludeBtn:    { padding: SPACING.xs },

  indicatorSection: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, ...SHADOW.card },
  indicatorRow:  { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.xs },
  indicatorText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, flex: 1 },

  modalOverlay:  {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent:  "center",
    alignItems:      "center",
    padding:         SPACING.xl,
  },
  modalCard:     {
    backgroundColor: COLORS.white,
    borderRadius:    RADIUS.xl,
    padding:         SPACING.xl,
    width:           "100%",
    gap:             SPACING.md,
    ...SHADOW.elevated,
  },
  modalTitle:    { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary, textAlign: "center" },
  modalBody:     { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary, textAlign: "center", lineHeight: 24 },
  reasonInput:   {
    borderWidth:       1.5,
    borderColor:       COLORS.border,
    borderRadius:      RADIUS.md,
    padding:           SPACING.md,
    ...TYPOGRAPHY.bodyMedium,
    color:             COLORS.textPrimary,
    minHeight:         80,
    textAlignVertical: "top",
  },
  modalActions:  { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.xs },
  modalCancelBtn:  {
    flex:           1,
    height:          TOUCH_TARGET,
    justifyContent: "center",
    alignItems:     "center",
    borderRadius:   RADIUS.md,
    borderWidth:    1.5,
    borderColor:    COLORS.border,
  },
  modalCancelText: { ...TYPOGRAPHY.labelLarge, color: COLORS.textSecondary },
  modalConfirmBtn: {
    flex:            2,
    height:          TOUCH_TARGET,
    justifyContent:  "center",
    alignItems:      "center",
    borderRadius:    RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  modalDangerBtn: {
    flex:            2,
    height:          TOUCH_TARGET,
    justifyContent:  "center",
    alignItems:      "center",
    borderRadius:    RADIUS.md,
    backgroundColor: COLORS.danger,
  },
  modalConfirmText: { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
});
