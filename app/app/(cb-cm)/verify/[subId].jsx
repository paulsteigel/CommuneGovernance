// app/(cb-cm)/verify/[subId].jsx
// CB_CHUYEN_MON — Xét duyệt một submission.
// Hỗ trợ 2 mode: batch (xác nhận/từ chối toàn bộ) và per_indicator.

import React, { useState, useMemo } from "react";
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

const INDICATOR_DECISIONS = [
  { key: "confirmed",   label: "Xác nhận ✓",  color: COLORS.verified },
  { key: "needs_review", label: "Xem lại ⚠",  color: COLORS.accentLight },
  { key: "rejected",    label: "Từ chối ✗",   color: COLORS.danger },
];

export default function VerifyScreen() {
  const { subId }  = useLocalSearchParams();
  const router     = useRouter();
  const { user, manifest, xa_code, token } = useAuthStore();

  // Find submission from manifest
  const submission = useMemo(() =>
    (manifest?.pending_verifications || []).find(s => s.submission_id === subId),
    [manifest, subId]
  );

  // Find request info
  const request = useMemo(() =>
    (manifest?.requests || []).find(r => r.req_id === submission?.req_id),
    [manifest, submission]
  );

  // Indicator map
  const indicatorMap = useMemo(() => {
    const map = {};
    (manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
    return map;
  }, [manifest]);

  const chiSoIds = request?.chi_so_ids || [];

  // Verify mode: "batch" or "per_indicator"
  const [mode,       setMode]      = useState("batch");
  const [decision,   setDecision]  = useState(null); // "confirm" | "reject" | "flag"
  const [comment,    setComment]   = useState("");
  const [indReviews, setIndReviews] = useState(() => {
    const init = {};
    chiSoIds.forEach(id => { init[id] = { status: "confirmed", comment: "" }; });
    return init;
  });
  const [loading, setLoading] = useState(false);

  function setIndStatus(id, status) {
    setIndReviews(prev => ({ ...prev, [id]: { ...prev[id], status } }));
  }

  async function handleSubmit() {
    if (mode === "batch" && !decision) {
      Alert.alert("Chưa chọn quyết định", "Vui lòng chọn Xác nhận hoặc Từ chối.");
      return;
    }

    Alert.alert(
      "Xác nhận xét duyệt",
      mode === "batch"
        ? `Bạn sẽ ${decision === "confirm" ? "XÁC NHẬN" : decision === "reject" ? "TỪ CHỐI" : "GẮN CỜ"} toàn bộ bộ số liệu này.`
        : "Lưu kết quả xét duyệt từng chỉ tiêu.",
      [
        { text: "Hủy", style: "cancel" },
        { text: "Đồng ý", onPress: doVerify },
      ]
    );
  }

  async function doVerify() {
    setLoading(true);
    try {
      await verifyData({
        token,
        user_id:       user.user_id,
        xa_code,
        submission_id: subId,
        verify_mode:   mode,
        decision:      mode === "batch" ? decision : "confirm",
        indicator_reviews: mode === "per_indicator" ? indReviews : undefined,
        verify_comment: comment.trim() || undefined,
      });

      Alert.alert("Xét duyệt thành công ✓", "Đã lưu kết quả xét duyệt.", [
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
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>Không tìm thấy bản ghi {subId}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Xét duyệt số liệu", headerBackTitle: "Quay lại" }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message="Đang lưu xét duyệt..." />}

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Info card */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Thôn</Text>
              <Text style={styles.infoValue}>{submission.thon_code}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Người gửi</Text>
              <Text style={styles.infoValue}>{submission.submitted_by}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Ngày gửi</Text>
              <Text style={styles.infoValue}>{submission.submitted_at?.slice(0, 10) || "—"}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Trạng thái</Text>
              <StatusBadge status={submission.status} size="small" />
            </View>
          </View>

          {/* Values */}
          <Text style={styles.sectionTitle}>Số liệu đã nộp</Text>

          {chiSoIds.map(id => {
            const ind = indicatorMap[id];
            const val = submission.values?.[id];
            return (
              <View key={id} style={styles.valueRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.indName}>{ind?.ten_chi_so || id}</Text>
                  <Text style={styles.indId}>{id}</Text>
                </View>
                <Text style={styles.indValue}>
                  {val !== undefined ? `${val}${ind?.don_vi_do ? " " + ind.don_vi_do : ""}` : "—"}
                </Text>
              </View>
            );
          })}

          {/* Mode toggle */}
          <Text style={styles.sectionTitle}>Chế độ xét duyệt</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === "batch" && styles.modeBtnActive]}
              onPress={() => setMode("batch")}
            >
              <Ionicons name="checkmark-done" size={18} color={mode === "batch" ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.modeBtnText, mode === "batch" && styles.modeBtnTextActive]}>
                Theo bộ số liệu
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === "per_indicator" && styles.modeBtnActive]}
              onPress={() => setMode("per_indicator")}
            >
              <Ionicons name="list" size={18} color={mode === "per_indicator" ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.modeBtnText, mode === "per_indicator" && styles.modeBtnTextActive]}>
                Từng chỉ tiêu
              </Text>
            </TouchableOpacity>
          </View>

          {/* Batch decision */}
          {mode === "batch" && (
            <View style={styles.decisionRow}>
              {[
                { key: "confirm", label: "Xác nhận ✓", color: COLORS.primary,    bg: COLORS.primaryPale },
                { key: "flag",    label: "Cần xem lại", color: COLORS.accentLight, bg: COLORS.pendingBg },
                { key: "reject",  label: "Từ chối ✗",  color: COLORS.danger,      bg: COLORS.dangerBg },
              ].map(d => (
                <TouchableOpacity
                  key={d.key}
                  style={[
                    styles.decisionBtn,
                    { borderColor: d.color, backgroundColor: decision === d.key ? d.color : d.bg },
                  ]}
                  onPress={() => setDecision(d.key)}
                >
                  <Text style={[
                    styles.decisionText,
                    { color: decision === d.key ? COLORS.white : d.color },
                  ]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Per-indicator decisions */}
          {mode === "per_indicator" && chiSoIds.map(id => {
            const ind     = indicatorMap[id];
            const current = indReviews[id]?.status || "confirmed";
            return (
              <View key={id} style={styles.indReviewCard}>
                <Text style={styles.indReviewName}>{ind?.ten_chi_so || id}</Text>
                <Text style={styles.indReviewVal}>
                  Giá trị: <Text style={{ fontWeight: "700" }}>{submission.values?.[id] ?? "—"}</Text>
                  {ind?.don_vi_do ? ` ${ind.don_vi_do}` : ""}
                </Text>
                <View style={styles.indDecisionRow}>
                  {INDICATOR_DECISIONS.map(d => (
                    <TouchableOpacity
                      key={d.key}
                      style={[
                        styles.indDecBtn,
                        { borderColor: d.color },
                        current === d.key && { backgroundColor: d.color },
                      ]}
                      onPress={() => setIndStatus(id, d.key)}
                    >
                      <Text style={[
                        styles.indDecText,
                        { color: current === d.key ? COLORS.white : d.color },
                      ]}>
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}

          {/* Comment */}
          <Text style={styles.sectionTitle}>Ghi chú (tùy chọn)</Text>
          <View style={styles.commentWrap}>
            <TextInput
              style={styles.commentInput}
              placeholder="Nhập ghi chú xét duyệt..."
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
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  errorText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger },

  infoCard: {
    backgroundColor: COLORS.white,
    borderRadius:    RADIUS.lg,
    padding:         SPACING.lg,
    marginBottom:    SPACING.lg,
    ...SHADOW.card,
    gap:             SPACING.sm,
  },
  infoRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  infoValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontWeight: "600" },

  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: SPACING.md, marginTop: SPACING.md },

  valueRow: {
    flexDirection:   "row",
    alignItems:      "center",
    backgroundColor: COLORS.white,
    borderRadius:    RADIUS.md,
    padding:         SPACING.md,
    marginBottom:    SPACING.sm,
    ...SHADOW.card,
  },
  indName:  { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indId:    { ...TYPOGRAPHY.caption,   color: COLORS.textHint },
  indValue: { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },

  modeRow:       { flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.md },
  modeBtn: {
    flex:            1,
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             SPACING.xs,
    borderWidth:     1.5,
    borderColor:     COLORS.border,
    borderRadius:    RADIUS.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
  },
  modeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modeBtnText:   { ...TYPOGRAPHY.labelLarge, color: COLORS.textSecondary },
  modeBtnTextActive: { color: COLORS.white },

  decisionRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  decisionBtn: {
    flex:            1,
    borderWidth:     2,
    borderRadius:    RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems:      "center",
  },
  decisionText: { ...TYPOGRAPHY.labelMedium, textAlign: "center" },

  indReviewCard: {
    backgroundColor: COLORS.white,
    borderRadius:    RADIUS.md,
    padding:         SPACING.md,
    marginBottom:    SPACING.md,
    ...SHADOW.card,
    gap:             SPACING.sm,
  },
  indReviewName: { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indReviewVal:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  indDecisionRow: { flexDirection: "row", gap: SPACING.sm },
  indDecBtn: {
    flex:            1,
    borderWidth:     1.5,
    borderRadius:    RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems:      "center",
  },
  indDecText: { ...TYPOGRAPHY.caption, fontWeight: "600", textAlign: "center" },

  commentWrap: {
    backgroundColor: COLORS.white,
    borderRadius:    RADIUS.md,
    borderWidth:     1.5,
    borderColor:     COLORS.border,
    padding:         SPACING.md,
    marginBottom:    SPACING.md,
    minHeight:       100,
  },
  commentInput: { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, minHeight: 80 },

  submitBtn: {
    flexDirection:   "row",
    backgroundColor: COLORS.primaryLight,
    borderRadius:    RADIUS.md,
    height:          TOUCH_TARGET + 8,
    justifyContent:  "center",
    alignItems:      "center",
    gap:             SPACING.sm,
    ...SHADOW.elevated,
  },
  submitBtnDisabled: { backgroundColor: COLORS.textHint },
  submitBtnText:     { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
});
