// app/(cb-thon)/submit/[reqId].jsx
// Handles 3 modes based on request.submission_status:
//   null             → new submission (pushData)
//   NEEDS_REVISION   → resubmit (resubmitData) — show rejection reason + pre-fill
//   PENDING_VERIFY / IN_REVIEW / VERIFIED → read-only view
import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useAuthStore } from "../../../store/authStore";
import { pushData, resubmitData } from "../../../services/api";
// NOTE: add resubmitData to services/api.js if not already there:
//   export async function resubmitData(body) {
//     return post("/resubmit_data", body);
//   }
import LoadingOverlay from "../../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../../constants/theme";

const READ_ONLY_STATUSES = ["PENDING_VERIFY", "IN_REVIEW", "VERIFIED"];

const READ_ONLY_LABELS = {
  PENDING_VERIFY: { text: "Đang chờ cán bộ chuyên môn xét duyệt", color: "#F59E0B", icon: "time-outline" },
  IN_REVIEW:      { text: "Cán bộ chuyên môn đang xem xét",        color: "#3B82F6", icon: "eye-outline"  },
  VERIFIED:       { text: "Số liệu đã được xác nhận ✓",            color: COLORS.primary, icon: "checkmark-circle" },
};

export default function SubmitScreen() {
  const { reqId } = useLocalSearchParams();
  const router    = useRouter();
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const addToOfflineQueue = useAuthStore(s => s.addToOfflineQueue);

  const request = useMemo(() =>
    (manifest?.requests || []).find(r => r.req_id === reqId),
    [manifest, reqId]
  );

  const indicatorMap = useMemo(() => {
    const map = {};
    (manifest?.indicators || []).forEach(ind => { map[ind.chi_so_id] = ind; });
    return map;
  }, [manifest]);

  const chiSoIds   = request?.chi_so_ids || [];
  const subStatus  = request?.submission_status || null;
  const isReadOnly = READ_ONLY_STATUSES.includes(subStatus);
  const isResubmit = subStatus === "NEEDS_REVISION";
  const isNew      = !subStatus;

  // ── Initial values ────────────────────────────────────────
  // Read-only / resubmit: pre-fill from submitted_values
  // New: empty
  const [values, setValues] = useState(() => {
    const init = {};
    chiSoIds.forEach(id => {
      const ind     = indicatorMap[id];
      const isBool  = ind?.kieu_du_lieu === "boolean";
      const prevVal = request?.submitted_values?.[id];

      if (isReadOnly || isResubmit) {
        // Pre-fill with submitted values
        if (isBool) {
          init[id] = prevVal === true || prevVal === 1;
        } else {
          init[id] = prevVal !== undefined ? String(prevVal) : "";
        }
      } else {
        init[id] = isBool ? false : "";
      }
    });
    return init;
  });

  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function setValue(id, val) {
    setValues(prev => ({ ...prev, [id]: val }));
  }

  // ── Validation (skip for read-only) ───────────────────────
  const allValid = isReadOnly || chiSoIds.every(id => {
    const ind = indicatorMap[id];
    if (ind?.kieu_du_lieu === "boolean") return true;
    const v = String(values[id]).trim();
    return v !== "" && !isNaN(Number(v));
  });

  const allFilled = isReadOnly || chiSoIds.every(id => {
    const ind = indicatorMap[id];
    if (ind?.kieu_du_lieu === "boolean") return true;
    return String(values[id]).trim() !== "";
  });

  // ── Build submission values ───────────────────────────────
  function buildValues() {
    const result = {};
    chiSoIds.forEach(id => {
      const ind = indicatorMap[id];
      if (ind?.kieu_du_lieu === "boolean") {
        result[id] = values[id] === true;
      } else {
        result[id] = Number(values[id]);
      }
    });
    return result;
  }

  async function handleSubmit() {
    if (!allFilled || !allValid) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập đầy đủ và đúng định dạng cho tất cả chỉ tiêu.");
      return;
    }

    const actionLabel = isResubmit ? "GỬI LẠI" : "GỬI";
    Alert.alert(
      isResubmit ? "Xác nhận gửi lại" : "Xác nhận gửi số liệu",
      `Bạn sẽ ${actionLabel} số liệu này để xét duyệt.`,
      [
        { text: "Hủy", style: "cancel" },
        { text: "Đồng ý", onPress: doSubmit },
      ]
    );
  }

  async function doSubmit() {
    const netState = await NetInfo.fetch();
    const isOnline = netState.isConnected && netState.isInternetReachable;

    setLoading(true);

    // ── Resubmit mode (NEEDS_REVISION → PENDING_VERIFY) ─────
    if (isResubmit) {
      if (!isOnline) {
        setLoading(false);
        Alert.alert("Cần kết nối mạng", "Gửi lại yêu cầu kết nối internet.");
        return;
      }
      try {
        await resubmitData({
          token,
          user_id:        user.user_id,
          xa_code,
          submission_id:  request.submission_id,
          updated_values: buildValues(),
        });
        setSubmitted(true);
        setLoading(false);
        Alert.alert(
          "Gửi lại thành công ✓",
          "Số liệu đã được gửi lại và đang chờ cán bộ chuyên môn xét duyệt.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      } catch (err) {
        setLoading(false);
        Alert.alert("Gửi thất bại", err.message || "Vui lòng thử lại.");
      }
      return;
    }

    // ── New submission mode ──────────────────────────────────
    const submission = {
      req_id:              reqId,
      device_collected_at: new Date().toISOString(),
      values:              buildValues(),
    };

    if (!isOnline) {
      await addToOfflineQueue({
        token, user_id: user.user_id, xa_code, year,
        manifest_version_used: manifest?.manifest_version || "v0",
        submissions: [submission],
      });
      setLoading(false);
      Alert.alert(
        "Lưu tạm thời",
        "Không có mạng. Số liệu đã được lưu và sẽ tự động gửi khi có kết nối.",
        [{ text: "OK", onPress: () => router.back() }]
      );
      return;
    }

    try {
      await pushData({
        token, user_id: user.user_id, xa_code, year,
        manifest_version_used: manifest?.manifest_version || "v0",
        submissions: [submission],
      });
      setSubmitted(true);
      setLoading(false);
      Alert.alert(
        "Gửi thành công ✓",
        "Số liệu đã được gửi và đang chờ xét duyệt.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      setLoading(false);
      Alert.alert("Gửi thất bại", err.message || "Vui lòng thử lại.");
    }
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: "Nhập số liệu" }} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>Không tìm thấy yêu cầu {reqId}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const readOnlyInfo = READ_ONLY_LABELS[subStatus];

  return (
    <>
      <Stack.Screen options={{
        title: isResubmit ? "Gửi lại số liệu" : isReadOnly ? "Xem số liệu" : "Nhập số liệu",
        headerBackTitle: "Quay lại",
      }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message={isResubmit ? "Đang gửi lại..." : "Đang gửi số liệu..."} />}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            {/* ── Request info card ── */}
            <View style={styles.reqCard}>
              <Text style={styles.reqTitle}>{request.tieu_de}</Text>
              <View style={styles.reqMeta}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.reqMetaText}>Hạn nộp: {request.deadline}</Text>
              </View>
              <View style={styles.reqMeta}>
                <Ionicons name="home-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.reqMetaText}>Thôn: {user?.don_vi}</Text>
              </View>
            </View>

            {/* ── Read-only status banner ── */}
            {isReadOnly && readOnlyInfo && (
              <View style={[styles.statusBanner, { backgroundColor: readOnlyInfo.color + "22", borderColor: readOnlyInfo.color }]}>
                <Ionicons name={readOnlyInfo.icon} size={18} color={readOnlyInfo.color} />
                <Text style={[styles.statusBannerText, { color: readOnlyInfo.color }]}>
                  {readOnlyInfo.text}
                </Text>
              </View>
            )}

            {/* ── Rejection reason banner (NEEDS_REVISION) ── */}
            {isResubmit && request.verify_comment && (
              <View style={styles.rejectionBanner}>
                <View style={styles.rejectionHeader}>
                  <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
                  <Text style={styles.rejectionTitle}>Lý do cần sửa lại</Text>
                </View>
                <Text style={styles.rejectionText}>{request.verify_comment}</Text>
              </View>
            )}

            {/* ── Indicator list ── */}
            <Text style={styles.sectionTitle}>
              {isReadOnly ? "Số liệu đã nộp" : isResubmit ? "Chỉnh sửa số liệu" : "Nhập số liệu theo chỉ tiêu"}
            </Text>
            {!isReadOnly && !isResubmit && (
              <Text style={styles.sectionSub}>Điền vào từng ô — chỉ nhập số, không nhập chữ</Text>
            )}

            {chiSoIds.map((id, idx) => {
              const ind      = indicatorMap[id];
              const label    = ind?.ten_chi_so || id;
              const unit     = ind?.don_vi_do;
              const isBool   = ind?.kieu_du_lieu === "boolean";
              const val      = values[id];
              const strVal   = String(val).trim();
              const invalid  = !isBool && strVal !== "" && isNaN(Number(strVal));

              // Per-indicator rejection highlight
              const indReview = request.indicator_reviews?.[id];
              const isRejected = indReview?.status === "rejected";

              return (
                <View
                  key={id}
                  style={[styles.fieldCard, isRejected && styles.fieldCardRejected]}
                >
                  <View style={styles.fieldHeader}>
                    <View style={[styles.indexBadge, isRejected && { backgroundColor: COLORS.danger }]}>
                      <Text style={styles.indexText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <Text style={styles.fieldId}>
                        {id}{unit ? ` · Đơn vị: ${unit}` : ""}
                      </Text>
                    </View>
                  </View>

                  {/* Rejection note per indicator */}
                  {isRejected && indReview?.review_note && (
                    <Text style={styles.indRejectionNote}>⚠ {indReview.review_note}</Text>
                  )}

                  {/* ── Boolean field: toggle ── */}
                  {isBool ? (
                    <View style={styles.boolRow}>
                      <Text style={styles.boolLabel}>{val ? "Có" : "Không"}</Text>
                      {!isReadOnly ? (
                        <Switch
                          value={val === true}
                          onValueChange={v => setValue(id, v)}
                          trackColor={{ false: COLORS.border, true: COLORS.primary }}
                          thumbColor={COLORS.white}
                        />
                      ) : (
                        <View style={[styles.boolReadOnly, { backgroundColor: val ? COLORS.primaryPale : COLORS.background }]}>
                          <Ionicons
                            name={val ? "checkmark-circle" : "close-circle"}
                            size={20}
                            color={val ? COLORS.primary : COLORS.textHint}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
                  /* ── Numeric field ── */
                    <View style={[styles.inputWrap, invalid && styles.inputInvalid, isReadOnly && styles.inputReadOnly]}>
                      <TextInput
                        style={styles.input}
                        placeholder="Nhập số..."
                        placeholderTextColor={COLORS.textHint}
                        value={strVal}
                        onChangeText={v => !isReadOnly && setValue(id, v)}
                        keyboardType="numeric"
                        returnKeyType={idx < chiSoIds.length - 1 ? "next" : "done"}
                        editable={!isReadOnly}
                      />
                      {unit ? <Text style={styles.unitLabel}>{unit}</Text> : null}
                      {!isReadOnly && strVal !== "" && !invalid && (
                        <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                      )}
                    </View>
                  )}
                  {invalid && <Text style={styles.fieldError}>⚠ Vui lòng nhập đúng định dạng số</Text>}
                </View>
              );
            })}

            {/* ── Submit button (hidden when read-only) ── */}
            {!isReadOnly && (
              <>
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    (!allFilled || !allValid || submitted) && styles.submitBtnDisabled,
                    isResubmit && styles.submitBtnResubmit,
                  ]}
                  onPress={handleSubmit}
                  disabled={!allFilled || !allValid || loading || submitted}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={submitted ? "checkmark-done" : isResubmit ? "refresh" : "send"}
                    size={22}
                    color={COLORS.white}
                  />
                  <Text style={styles.submitBtnText}>
                    {submitted ? "Đã gửi" : isResubmit ? "Gửi lại số liệu" : "Gửi số liệu"}
                  </Text>
                </TouchableOpacity>
                {!isResubmit && (
                  <Text style={styles.hint}>
                    * Nếu không có mạng, số liệu sẽ được lưu và tự động gửi khi có kết nối.
                  </Text>
                )}
              </>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.background },
  scroll:       { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center:       { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  errorText:    { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger, textAlign: "center" },

  reqCard:      { backgroundColor: COLORS.primaryPale, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, gap: SPACING.xs },
  reqTitle:     { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  reqMeta:      { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  reqMetaText:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },

  statusBanner: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  statusBannerText: { ...TYPOGRAPHY.bodyMedium, fontWeight: "600", flex: 1 },

  rejectionBanner: { backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.danger, gap: SPACING.xs },
  rejectionHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  rejectionTitle:  { ...TYPOGRAPHY.labelLarge, color: COLORS.danger },
  rejectionText:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger },

  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: 2 },
  sectionSub:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary, marginBottom: SPACING.md },

  fieldCard:    { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.md },
  fieldCardRejected: { borderWidth: 1.5, borderColor: COLORS.danger },
  fieldHeader:  { flexDirection: "row", alignItems: "flex-start", gap: SPACING.md },
  indexBadge:   { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center", marginTop: 2 },
  indexText:    { ...TYPOGRAPHY.labelMedium, color: COLORS.white },
  fieldLabel:   { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  fieldId:      { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  indRejectionNote: { ...TYPOGRAPHY.caption, color: COLORS.danger, fontStyle: "italic" },

  // Boolean field
  boolRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: SPACING.xs },
  boolLabel:    { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  boolReadOnly: { borderRadius: RADIUS.full, padding: SPACING.xs },

  // Numeric field
  inputWrap:    { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.background, paddingHorizontal: SPACING.md, minHeight: TOUCH_TARGET, gap: SPACING.sm },
  inputInvalid: { borderColor: COLORS.danger },
  inputReadOnly:{ backgroundColor: COLORS.background, opacity: 0.7 },
  input:        { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, flex: 1, height: TOUCH_TARGET },
  unitLabel:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  fieldError:   { ...TYPOGRAPHY.caption, color: COLORS.danger },

  // Submit button
  submitBtn:         { flexDirection: "row", backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: TOUCH_TARGET + 8, justifyContent: "center", alignItems: "center", gap: SPACING.sm, marginTop: SPACING.md, ...SHADOW.elevated },
  submitBtnResubmit: { backgroundColor: COLORS.accent },
  submitBtnDisabled: { backgroundColor: COLORS.textHint },
  submitBtnText:     { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
  hint:              { ...TYPOGRAPHY.caption, color: COLORS.textHint, textAlign: "center", marginTop: SPACING.lg },
});
