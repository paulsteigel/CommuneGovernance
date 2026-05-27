// app/(lanh-dao)/verify/[subId].jsx
// LANH_DAO — Xét duyệt bypass (batch mode only, đơn giản hơn CB_CM).
// R1: Chỉ LANH_DAO được approve — đây là bypass toàn bộ, không per_indicator.

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

const DECISIONS = [
  { key: "confirm", label: "Xác nhận ✓", color: COLORS.primary,    bg: COLORS.primaryPale },
  { key: "flag",    label: "Cần xem lại", color: COLORS.accentLight, bg: COLORS.pendingBg },
  { key: "reject",  label: "Từ chối ✗",  color: COLORS.danger,      bg: COLORS.dangerBg },
];

export default function LanhDaoVerifyScreen() {
  const { subId } = useLocalSearchParams();
  const router    = useRouter();
  const { user, manifest, xa_code, token } = useAuthStore();

  // Tìm submission từ manifest
  const submission = useMemo(() =>
    (manifest?.pending_verifications || []).find(s => s.submission_id === subId),
    [manifest, subId]
  );

  // Tìm request info
  const request = useMemo(() =>
    (manifest?.requests || []).find(r => r.req_id === submission?.req_id),
    [manifest, submission]
  );

  // Indicator map — FIX BUG-A3: dùng chi_so_id (không phải id)
  const indicatorMap = useMemo(() => {
    const map = {};
    (manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
    return map;
  }, [manifest]);

  const chiSoIds = request?.chi_so_ids || [];

  const [decision, setDecision] = useState(null);
  const [comment,  setComment]  = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit() {
    if (!decision) {
      Alert.alert("Chưa chọn quyết định", "Vui lòng chọn Xác nhận hoặc Từ chối.");
      return;
    }

    const label = DECISIONS.find(d => d.key === decision)?.label || decision;
    Alert.alert(
      "Xác nhận xét duyệt",
      `Bạn sẽ ${label.toUpperCase()} bộ số liệu này với tư cách Lãnh đạo xã.`,
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
        user_id:        user.user_id,
        xa_code,
        submission_id:  subId,
        verify_mode:    "batch",
        decision,
        verify_comment: comment.trim() || undefined,
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

        <ScrollView contentContainerStyle={styles.scroll}>

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

          {/* Values */}
          <Text style={styles.sectionTitle}>Số liệu đã nộp</Text>
          {chiSoIds.length === 0 ? (
            <Text style={styles.noData}>Không có chỉ tiêu nào</Text>
          ) : chiSoIds.map(id => {
            const ind = indicatorMap[id];
            const val = submission.values?.[id];
            return (
              <View key={id} style={styles.valueRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.indName}>{ind?.ten_chi_so || id}</Text>
                  <Text style={styles.indId}>{id}</Text>
                </View>
                <Text style={styles.indValue}>
                  {val !== undefined
                    ? `${val}${ind?.don_vi_do ? " " + ind.don_vi_do : ""}`
                    : "—"}
                </Text>
              </View>
            );
          })}

          {/* Decision */}
          <Text style={styles.sectionTitle}>Quyết định</Text>
          <View style={styles.decisionRow}>
            {DECISIONS.map(d => (
              <TouchableOpacity
                key={d.key}
                style={[
                  styles.decisionBtn,
                  { borderColor: d.color, backgroundColor: decision === d.key ? d.color : d.bg },
                ]}
                onPress={() => setDecision(d.key)}
                activeOpacity={0.8}
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

          {/* Comment */}
          <Text style={styles.sectionTitle}>Ghi chú lãnh đạo (tùy chọn)</Text>
          <View style={styles.commentWrap}>
            <TextInput
              style={styles.commentInput}
              placeholder="Nhập ghi chú..."
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
            style={[styles.submitBtn, !decision && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!decision}
            activeOpacity={0.85}
          >
            <Ionicons name="shield-checkmark" size={22} color={COLORS.white} />
            <Text style={styles.submitBtnText}>Lưu quyết định</Text>
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
  infoValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontWeight: "600", flex: 1, textAlign: "right" },

  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: SPACING.md, marginTop: SPACING.md },
  noData:       { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint, marginBottom: SPACING.md },

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

  decisionRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  decisionBtn: {
    flex:            1,
    borderWidth:     2,
    borderRadius:    RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems:      "center",
  },
  decisionText: { ...TYPOGRAPHY.labelMedium, textAlign: "center" },

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
    backgroundColor: COLORS.primary,
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
