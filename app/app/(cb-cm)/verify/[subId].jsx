// app/(cb-cm)/verify/[subId].jsx
// CB_CHUYEN_MON — Xét duyệt submission (PENDING_VERIFY hoặc IN_REVIEW).
// Batch mode:         Xác nhận / Từ chối + ghi chú
// Per-indicator mode: checkbox toggle từng chỉ tiêu + ghi chú

import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../../store/authStore";
import { verifyData } from "../../../services/api";
import StatusBadge from "../../../components/StatusBadge";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../../constants/theme";

export default function VerifyScreen() {
  const { subId } = useLocalSearchParams();
  const router    = useRouter();
  const { user, manifest, xa_code, token } = useAuthStore();

  const submission = useMemo(() =>
    (manifest?.pending_verifications || []).find(s => s.submission_id === subId),
    [manifest, subId]
  );

  const request = useMemo(() =>
    (manifest?.requests || []).find(r => r.req_id === submission?.req_id),
    [manifest, submission]
  );

  const indicatorMap = useMemo(() => {
    const map = {};
    // FIX BUG-A3: use chi_so_id (not ind.id)
    (manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
    return map;
  }, [manifest]);

  const chiSoIds = request?.chi_so_ids || [];

  const [mode,     setMode]     = useState("batch");
  const [decision, setDecision] = useState(null);
  const [comment,  setComment]  = useState("");
  const [loading,  setLoading]  = useState(false);

  const [checked, setChecked] = useState(() => {
    const init = {};
    chiSoIds.forEach(id => { init[id] = true; });
    return init;
  });

  const allChecked  = chiSoIds.length > 0 && chiSoIds.every(id => checked[id]);
  const someChecked = chiSoIds.some(id => checked[id]);

  const toggleAll = useCallback(() => {
    const next = !allChecked;
    const upd  = {};
    chiSoIds.forEach(id => { upd[id] = next; });
    setChecked(upd);
  }, [allChecked, chiSoIds]);

  const toggleOne = useCallback((id) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  function buildIndReviews() {
    const reviews = {};
    chiSoIds.forEach(id => {
      reviews[id] = { status: checked[id] ? "confirmed" : "rejected" };
    });
    return reviews;
  }

  async function handleSubmit() {
    if (mode === "batch" && !decision) {
      Alert.alert("Chưa chọn quyết định", "Vui lòng chọn Xác nhận hoặc Từ chối.");
      return;
    }

    const confirmText = mode === "batch"
      ? `Bạn sẽ ${decision === "confirm" ? "XÁC NHẬN" : "TỪ CHỐI"} toàn bộ bộ số liệu này.`
      : `${chiSoIds.filter(id => checked[id]).length}/${chiSoIds.length} chỉ tiêu được xác nhận.`;

    Alert.alert("Xác nhận xét duyệt", confirmText, [
      { text: "Hủy", style: "cancel" },
      { text: "Đồng ý", onPress: doVerify },
    ]);
  }

  async function doVerify() {
    setLoading(true);
    try {
      await verifyData({
        token,
        user_id:           user.user_id,
        xa_code,
        submission_id:     subId,
        verify_mode:       mode,
        decision:          mode === "batch" ? decision : undefined,
        indicator_reviews: mode === "per_indicator" ? buildIndReviews() : undefined,
        // FIX A6: send "comment" (canonical name), not "verify_comment"
        comment:           comment.trim() || undefined,
      });

      Alert.alert("Xét duyệt thành công ✓", "Đã lưu kết quả.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Lỗi", err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!submission) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: "Xét duyệt số liệu" }} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>Không tìm thấy bản ghi</Text>
          <Text style={styles.errorSub}>{subId}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Xét duyệt số liệu", headerBackTitle: "Quay lại" }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message="Đang lưu xét duyệt..." />}

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Info card */}
          <View style={styles.infoCard}>
            {[
              { label: "Yêu cầu",   value: submission.tieu_de || submission.req_id },
              { label: "Thôn",      value: submission.thon_code },
              { label: "Người gửi", value: submission.submitted_by },
              { label: "Ngày gửi",  value: submission.submitted_at?.slice(0, 10) || "—" },
            ].map(row => (
              <View key={row.label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Trạng thái</Text>
              <StatusBadge status={submission.status} size="small" />
            </View>
          </View>

          {/* Mode toggle */}
          <View style={styles.modeRow}>
            {[
              { key: "batch",         label: "Theo bộ số liệu", icon: "checkmark-done" },
              { key: "per_indicator", label: "Từng chỉ tiêu",   icon: "list" },
            ].map(m => (
              <TouchableOpacity
                key={m.key}
                style={[styles.modeBtn, mode === m.key && styles.modeBtnActive]}
                onPress={() => setMode(m.key)}
              >
                <Ionicons name={m.icon} size={16} color={mode === m.key ? COLORS.white : COLORS.textSecondary} />
                <Text style={[styles.modeBtnText, mode === m.key && styles.modeBtnTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* BATCH MODE */}
          {mode === "batch" && (
            <>
              <Text style={styles.sectionTitle}>Quyết định</Text>
              <View style={styles.decisionRow}>
                {[
                  { key: "confirm", label: "Xác nhận ✓", color: COLORS.primary, bg: COLORS.primaryPale },
                  { key: "reject",  label: "Từ chối ✗",  color: COLORS.danger,  bg: COLORS.dangerBg },
                ].map(d => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.decisionBtn,
                      { borderColor: d.color, backgroundColor: decision === d.key ? d.color : d.bg }]}
                    onPress={() => setDecision(d.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.decisionText, { color: decision === d.key ? COLORS.white : d.color }]}>
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* PER-INDICATOR MODE */}
          {mode === "per_indicator" && (
            <>
              <Text style={styles.sectionTitle}>Chọn chỉ tiêu đạt chuẩn</Text>
              <View style={styles.table}>
                <TouchableOpacity style={styles.tableHeader} onPress={toggleAll} activeOpacity={0.7}>
                  <Text style={styles.tableHeaderText}>Chỉ tiêu</Text>
                  <Text style={[styles.tableHeaderText, styles.colValue]}>Giá trị</Text>
                  <View style={styles.colCheck}>
                    <Ionicons
                      name={allChecked ? "checkbox" : someChecked ? "remove-circle" : "square-outline"}
                      size={22}
                      color={allChecked ? COLORS.primary : someChecked ? COLORS.accentLight : COLORS.textHint}
                    />
                    <Text style={styles.toggleAllLabel}>Tất cả</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.tableDivider} />
                {chiSoIds.map((id, idx) => {
                  const ind    = indicatorMap[id];
                  const val    = submission.values?.[id];
                  const isLast = idx === chiSoIds.length - 1;
                  return (
                    <View key={id}>
                      <TouchableOpacity style={styles.tableRow} onPress={() => toggleOne(id)} activeOpacity={0.6}>
                        <View style={styles.colName}>
                          <Text style={styles.indName} numberOfLines={2}>{ind?.ten_chi_so || id}</Text>
                          <Text style={styles.indId}>{id}</Text>
                        </View>
                        <Text style={styles.colValue}>
                          {val !== undefined
                            ? typeof val === "boolean"
                              ? (val ? "Có" : "Không")
                              : `${val}${ind?.don_vi_do ? " " + ind.don_vi_do : ""}`
                            : "—"}
                        </Text>
                        <View style={[styles.colCheck, { justifyContent: "center" }]}>
                          <Ionicons
                            name={checked[id] ? "checkbox" : "square-outline"}
                            size={24}
                            color={checked[id] ? COLORS.primary : COLORS.textHint}
                          />
                        </View>
                      </TouchableOpacity>
                      {!isLast && <View style={styles.rowDivider} />}
                    </View>
                  );
                })}
                <View style={styles.tableDivider} />
                <View style={styles.tableFooter}>
                  <Text style={styles.tableFooterText}>
                    Xác nhận:{" "}
                    <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
                      {chiSoIds.filter(id => checked[id]).length}
                    </Text>
                    {" / "}{chiSoIds.length}
                  </Text>
                  {chiSoIds.filter(id => !checked[id]).length > 0 && (
                    <Text style={styles.tableFooterReject}>
                      Từ chối: {chiSoIds.filter(id => !checked[id]).length}
                    </Text>
                  )}
                </View>
              </View>
            </>
          )}

          {/* Comment */}
          <Text style={styles.sectionTitle}>Ghi chú xét duyệt (tùy chọn)</Text>
          <View style={styles.commentWrap}>
            <TextInput
              style={styles.commentInput}
              placeholder="Nhận xét của cán bộ chuyên môn..."
              placeholderTextColor={COLORS.textHint}
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, (mode === "batch" && !decision) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={mode === "batch" && !decision}
            activeOpacity={0.85}
          >
            <Ionicons name="shield-checkmark" size={22} color={COLORS.white} />
            <Text style={styles.submitBtnText}>Lưu kết quả xét duyệt</Text>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.sm, padding: SPACING.xl },
  errorText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger },
  errorSub:  { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  infoCard:  { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.lg, ...SHADOW.card, gap: SPACING.sm },
  infoRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  infoValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontWeight: "600", flex: 1, textAlign: "right" },
  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: SPACING.sm, marginTop: SPACING.md },
  modeRow:          { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.sm },
  modeBtn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: SPACING.md, backgroundColor: COLORS.white },
  modeBtnActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modeBtnText:      { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  modeBtnTextActive:{ color: COLORS.white },
  decisionRow:  { flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.md },
  decisionBtn:  { flex: 1, borderWidth: 2, borderRadius: RADIUS.md, paddingVertical: SPACING.lg, alignItems: "center" },
  decisionText: { ...TYPOGRAPHY.titleMedium, textAlign: "center" },
  table:           { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, marginBottom: SPACING.md, ...SHADOW.card, overflow: "hidden" },
  tableHeader:     { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: COLORS.primaryPale },
  tableHeaderText: { ...TYPOGRAPHY.labelMedium, color: COLORS.primary, flex: 1 },
  colName:         { flex: 1, paddingRight: SPACING.sm },
  colValue:        { width: 80, textAlign: "right", ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  colCheck:        { width: 56, alignItems: "center", flexDirection: "column" },
  toggleAllLabel:  { ...TYPOGRAPHY.caption, color: COLORS.primary, marginTop: 2 },
  tableDivider:    { height: 1, backgroundColor: COLORS.divider },
  tableRow:        { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  rowDivider:      { height: 1, backgroundColor: COLORS.background, marginHorizontal: SPACING.md },
  indName:         { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontWeight: "600" },
  indId:           { ...TYPOGRAPHY.caption, color: COLORS.textHint, marginTop: 2 },
  tableFooter:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: COLORS.background },
  tableFooterText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  tableFooterReject: { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger },
  commentWrap:  { backgroundColor: COLORS.white, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.md, minHeight: 100 },
  commentInput: { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, minHeight: 80 },
  submitBtn:         { flexDirection: "row", backgroundColor: COLORS.primaryLight || COLORS.primary, borderRadius: RADIUS.md, height: TOUCH_TARGET + 8, justifyContent: "center", alignItems: "center", gap: SPACING.sm, ...SHADOW.elevated },
  submitBtnDisabled: { backgroundColor: COLORS.textHint },
  submitBtnText:     { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
});