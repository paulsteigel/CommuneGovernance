// app/(cb-thon)/submit/[reqId].jsx
import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useAuthStore } from "../../../store/authStore";
import { pushData } from "../../../services/api";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../../constants/theme";

export default function SubmitScreen() {
  const { reqId } = useLocalSearchParams();
  const router    = useRouter();
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const addToOfflineQueue = useAuthStore(s => s.addToOfflineQueue);

  const request = useMemo(() =>
    (manifest?.requests || []).find(r => r.req_id === reqId),
    [manifest, reqId]
  );

  // ✅ Fix: dùng chi_so_id làm key thay vì id
  const indicatorMap = useMemo(() => {
    const map = {};
    (manifest?.indicators || []).forEach(ind => {
      map[ind.chi_so_id] = ind;
    });
    return map;
  }, [manifest]);

  const chiSoIds = request?.chi_so_ids || [];

  const [values,    setValues]    = useState(() => {
    const init = {};
    chiSoIds.forEach(id => { init[id] = ""; });
    return init;
  });
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function setValue(id, val) {
    setValues(prev => ({ ...prev, [id]: val }));
  }

  const allFilled  = chiSoIds.every(id => values[id].trim() !== "");
  const allNumeric = chiSoIds.every(id => !isNaN(Number(values[id].trim())) && values[id].trim() !== "");

  async function handleSubmit() {
    if (!allFilled || !allNumeric) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập đầy đủ và đúng định dạng số cho tất cả chỉ tiêu.");
      return;
    }

    const numericValues = {};
    chiSoIds.forEach(id => { numericValues[id] = Number(values[id]); });

    const submission = {
      req_id:              reqId,
      device_collected_at: new Date().toISOString(),
      values:              numericValues,
    };

    const netState = await NetInfo.fetch();
    const isOnline = netState.isConnected && netState.isInternetReachable;

    setLoading(true);

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
      Alert.alert("Gửi thành công! ✓", "Số liệu đã được gửi và đang chờ xét duyệt.",
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
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>Không tìm thấy yêu cầu {reqId}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Nhập số liệu", headerBackTitle: "Quay lại" }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message="Đang gửi số liệu..." />}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            <View style={styles.reqCard}>
              <Text style={styles.reqTitle}>{request.tieu_de}</Text>
              <View style={styles.reqMeta}>
                <Ionicons name="calendar-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.reqMetaText}>Hạn nộp: {request.deadline}</Text>
              </View>
              <View style={styles.reqMeta}>
                <Ionicons name="home-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.reqMetaText}>Thôn: {user?.don_vi}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Nhập số liệu theo chỉ tiêu</Text>
            <Text style={styles.sectionSub}>Điền số vào từng ô — chỉ nhập số, không nhập chữ</Text>

            {chiSoIds.map((id, idx) => {
              // ✅ Fix: tra cứu đúng theo chi_so_id
              const ind     = indicatorMap[id];
              const label   = ind ? ind.ten_chi_so : id;
              const unit    = ind?.don_vi_do;
              const val     = values[id];
              const invalid = val !== "" && isNaN(Number(val));

              return (
                <View key={id} style={styles.fieldCard}>
                  <View style={styles.fieldHeader}>
                    <View style={styles.indexBadge}>
                      <Text style={styles.indexText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <Text style={styles.fieldId}>{id}{unit ? ` · Đơn vị: ${unit}` : ""}</Text>
                    </View>
                  </View>

                  <View style={[styles.inputWrap, invalid && styles.inputInvalid]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Nhập số..."
                      placeholderTextColor={COLORS.textHint}
                      value={val}
                      onChangeText={v => setValue(id, v)}
                      keyboardType="numeric"
                      returnKeyType={idx < chiSoIds.length - 1 ? "next" : "done"}
                    />
                    {unit ? <Text style={styles.unitLabel}>{unit}</Text> : null}
                    {val !== "" && !invalid && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                    )}
                  </View>
                  {invalid && <Text style={styles.fieldError}>⚠ Vui lòng nhập đúng định dạng số</Text>}
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.submitBtn, (!allFilled || !allNumeric) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!allFilled || !allNumeric || loading || submitted}
              activeOpacity={0.85}
            >
              <Ionicons name={submitted ? "checkmark-done" : "send"} size={22} color={COLORS.white} />
              <Text style={styles.submitBtnText}>{submitted ? "Đã gửi" : "Gửi số liệu"}</Text>
            </TouchableOpacity>

            <Text style={styles.hint}>* Nếu không có mạng, số liệu sẽ được lưu và tự động gửi khi có kết nối.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: COLORS.background },
  scroll:  { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center:  { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  errorText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger, textAlign: "center" },
  reqCard: { backgroundColor: COLORS.primaryPale, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.lg, borderLeftWidth: 4, borderLeftColor: COLORS.primary, gap: SPACING.xs },
  reqTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  reqMeta:  { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  reqMetaText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: 2 },
  sectionSub:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary, marginBottom: SPACING.md },
  fieldCard:    { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.md },
  fieldHeader:  { flexDirection: "row", alignItems: "flex-start", gap: SPACING.md },
  indexBadge:   { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center", marginTop: 2 },
  indexText:    { ...TYPOGRAPHY.labelMedium, color: COLORS.white },
  fieldLabel:   { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  fieldId:      { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  inputWrap:    { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.background, paddingHorizontal: SPACING.md, minHeight: TOUCH_TARGET, gap: SPACING.sm },
  inputInvalid: { borderColor: COLORS.danger },
  input:        { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, flex: 1, height: TOUCH_TARGET },
  unitLabel:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  fieldError:   { ...TYPOGRAPHY.caption, color: COLORS.danger },
  submitBtn:    { flexDirection: "row", backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: TOUCH_TARGET + 8, justifyContent: "center", alignItems: "center", gap: SPACING.sm, marginTop: SPACING.md, ...SHADOW.elevated },
  submitBtnDisabled: { backgroundColor: COLORS.textHint },
  submitBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
  hint:         { ...TYPOGRAPHY.caption, color: COLORS.textHint, textAlign: "center", marginTop: SPACING.lg },
});
