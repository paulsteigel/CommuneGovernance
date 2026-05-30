// app/(cb-cm)/indicator-create.jsx
// Tạo mới hoặc chỉnh sửa chỉ số (DRAFT/REJECTED only).
//
// FIX: sau createIndicator thành công, optimistic-add indicator mới vào
//      manifest.my_indicators cục bộ (AsyncStorage + Zustand).
//      Không gọi thêm pullManifest → 0 Firestore reads tiêu thêm.
//      User quay lại tab Chỉ số thấy ngay chỉ số mới với status DRAFT.

import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { createIndicator } from "../../services/api";
import LoadingOverlay from "../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";

const KIEU_OPTIONS = [
  { key: "so",      label: "Số",         sub: "Nhập giá trị số (ha, hộ, tấn...)" },
  { key: "boolean", label: "Có / Không", sub: "Câu hỏi đúng/sai" },
  { key: "text",    label: "Văn bản",    sub: "Mô tả, ghi chú ngắn" },
];

const LINH_VUC_OPTIONS = [
  { key: "NONG_NGHIEP",   label: "Nông nghiệp" },
  { key: "XA_HOI",        label: "Xã hội" },
  { key: "CO_SO_HA_TANG", label: "Hạ tầng" },
  { key: "AN_NINH",       label: "An ninh" },
  { key: "KINH_TE",       label: "Kinh tế" },
];

function normStr(s) {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function IndicatorCreate() {
  const { edit_id } = useLocalSearchParams();
  const router      = useRouter();

  const { user, manifest, xa_code, year, token } = useAuthStore();
  // updateManifest ghi trực tiếp vào AsyncStorage + Zustand — không tốn read
  const updateManifest = useAuthStore(s => s.updateManifest);

  const existing = useMemo(() => {
    if (!edit_id) return null;
    return (manifest?.my_indicators || []).find(i => i.chi_so_id === edit_id) || null;
  }, [edit_id, manifest]);

  const allowedLv = user?.linh_vuc_codes || [];
  const defaultLv = allowedLv[0] || LINH_VUC_OPTIONS[0].key;

  const [tenChiSo,   setTenChiSo]   = useState(existing?.ten_chi_so  || "");
  const [donViDo,    setDonViDo]    = useState(existing?.don_vi_do   || "");
  const [kieuDuLieu, setKieuDuLieu] = useState(existing?.kieu_du_lieu || "so");
  const [linhVuc,    setLinhVuc]    = useState(existing?.linh_vuc    || defaultLv);
  const [moTa,       setMoTa]       = useState(existing?.mo_ta       || "");
  const [valMin,     setValMin]     = useState(
    existing?.validation?.min !== undefined ? String(existing.validation.min) : ""
  );
  const [valMax,     setValMax]     = useState(
    existing?.validation?.max !== undefined ? String(existing.validation.max) : ""
  );
  const [loading, setLoading] = useState(false);

  const duplicateWarning = useMemo(() => {
    if (!tenChiSo.trim()) return null;
    const nameNorm = normStr(tenChiSo);
    const unitNorm = normStr(donViDo);
    const dupe = (manifest?.indicators || []).find(ind => {
      if (ind.chi_so_id === edit_id) return false;
      return normStr(ind.ten_chi_so) === nameNorm &&
             normStr(ind.don_vi_do || "") === unitNorm;
    });
    if (!dupe) return null;
    return `Chỉ số "${dupe.ten_chi_so}"${dupe.don_vi_do ? ` (${dupe.don_vi_do})` : ""} đã ACTIVE (${dupe.chi_so_id}). Hãy dùng chỉ số đó khi tạo request thay vì tạo mới.`;
  }, [tenChiSo, donViDo, manifest, edit_id]);

  async function handleSave() {
    if (!tenChiSo.trim()) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập tên chỉ số.");
      return;
    }
    if (duplicateWarning) {
      Alert.alert(
        "Chỉ số đã tồn tại",
        duplicateWarning + "\n\nBạn vẫn muốn tạo?",
        [
          { text: "Hủy", style: "cancel" },
          { text: "Vẫn tạo", onPress: doSave },
        ]
      );
      return;
    }
    doSave();
  }

  async function doSave() {
    setLoading(true);
    try {
      const result = await createIndicator({
        token, user_id: user.user_id, xa_code, year,
        ten_chi_so:   tenChiSo.trim(),
        don_vi_do:    donViDo.trim() || null,
        kieu_du_lieu: kieuDuLieu,
        linh_vuc:     linhVuc,
        mo_ta:        moTa.trim() || null,
        validation: {
          required: true,
          ...(kieuDuLieu === "so" && valMin !== "" && { min: Number(valMin) }),
          ...(kieuDuLieu === "so" && valMax !== "" && { max: Number(valMax) }),
        },
      });

      // ── Optimistic local update ────────────────────────────────
      // Backend trả { chi_so_id, status: "DRAFT" }.
      // Append vào manifest.my_indicators cục bộ → tab Chỉ số thấy ngay.
      // Dùng getState() để tránh stale closure trong async callback.
      const currentManifest = useAuthStore.getState().manifest;
      const newInd = {
        chi_so_id:        result.chi_so_id,
        ten_chi_so:       tenChiSo.trim(),
        don_vi_do:        donViDo.trim() || null,
        kieu_du_lieu:     kieuDuLieu,
        linh_vuc:         linhVuc,
        mo_ta:            moTa.trim() || null,
        status:           "DRAFT",
        rejection_reason: null,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      };
      await updateManifest({
        ...currentManifest,
        my_indicators: [...(currentManifest?.my_indicators || []), newInd],
      });
      // ─────────────────────────────────────────────────────────

      Alert.alert(
        "Đã lưu ✓",
        "Chỉ số đã tạo ở trạng thái Nháp. Vào tab Chỉ số → bấm 'Gửi duyệt' khi hoàn chỉnh.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert("Lỗi", err.message);
    } finally {
      setLoading(false);
    }
  }

  const isEditingActive = existing?.status === "ACTIVE" || existing?.status === "PENDING";

  return (
    <>
      <Stack.Screen options={{
        title: edit_id ? "Chỉnh sửa chỉ số" : "Tạo chỉ số mới",
        headerShown: true,
        headerBackTitle: "Quay lại",
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
      }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message="Đang lưu..." />}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            {isEditingActive && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning-outline" size={16} color="#92400E" />
                <Text style={styles.warningText}>
                  Chỉ số đang ở trạng thái {existing.status} — một số trường không thể sửa.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Tên chỉ số <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={[styles.input, duplicateWarning && styles.inputWarn]}
              placeholder="VD: Diện tích lúa, Số hộ nghèo..."
              placeholderTextColor={COLORS.textHint}
              value={tenChiSo}
              onChangeText={setTenChiSo}
              editable={!isEditingActive}
            />
            {duplicateWarning && (
              <View style={styles.dupWarn}>
                <Ionicons name="alert-circle-outline" size={14} color="#92400E" />
                <Text style={styles.dupWarnText} numberOfLines={3}>{duplicateWarning}</Text>
              </View>
            )}

            <Text style={styles.label}>Đơn vị đo</Text>
            <TextInput
              style={styles.input}
              placeholder="VD: ha, hộ, tấn, km... (để trống nếu không có)"
              placeholderTextColor={COLORS.textHint}
              value={donViDo}
              onChangeText={setDonViDo}
              editable={!isEditingActive}
            />

            <Text style={styles.label}>Kiểu dữ liệu <Text style={styles.required}>*</Text></Text>
            <View style={styles.optionGroup}>
              {KIEU_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.optionCard, kieuDuLieu === opt.key && styles.optionCardActive]}
                  onPress={() => !isEditingActive && setKieuDuLieu(opt.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.optionLabel, kieuDuLieu === opt.key && styles.optionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.optionSub, kieuDuLieu === opt.key && { color: COLORS.white }]}>
                    {opt.sub}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Lĩnh vực <Text style={styles.required}>*</Text></Text>
            <View style={styles.linhVucRow}>
              {LINH_VUC_OPTIONS.filter(opt =>
                allowedLv.length === 0 || allowedLv.includes(opt.key)
              ).map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.lvChip, linhVuc === opt.key && styles.lvChipActive]}
                  onPress={() => !isEditingActive && setLinhVuc(opt.key)}
                >
                  <Text style={[styles.lvChipText, linhVuc === opt.key && styles.lvChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {kieuDuLieu === "so" && (
              <>
                <Text style={styles.label}>Giới hạn giá trị (tùy chọn)</Text>
                <View style={styles.minMaxRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Tối thiểu</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={COLORS.textHint}
                      value={valMin}
                      onChangeText={setValMin}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Tối đa</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Không giới hạn"
                      placeholderTextColor={COLORS.textHint}
                      value={valMax}
                      onChangeText={setValMax}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </>
            )}

            <Text style={styles.label}>Mô tả (tùy chọn)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Mô tả chi tiết về chỉ số này..."
              placeholderTextColor={COLORS.textHint}
              value={moTa}
              onChangeText={setMoTa}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {!isEditingActive && (
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                <Ionicons name="save-outline" size={22} color={COLORS.white} />
                <Text style={styles.saveBtnText}>Lưu nháp</Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  warningBanner: { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm, backgroundColor: "#FEF3C7", borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: "#F59E0B" },
  warningText:   { ...TYPOGRAPHY.bodyMedium, color: "#92400E", flex: 1 },
  label:    { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.md },
  subLabel: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginBottom: 4 },
  required: { color: COLORS.danger },
  input:    { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: TOUCH_TARGET, ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary },
  inputWarn:{ borderColor: "#F59E0B" },
  inputMultiline: { height: 80, paddingTop: SPACING.sm },
  dupWarn:  { flexDirection: "row", alignItems: "flex-start", gap: SPACING.xs, backgroundColor: "#FEF3C7", borderRadius: RADIUS.sm, padding: SPACING.sm, marginTop: 4 },
  dupWarnText: { ...TYPOGRAPHY.caption, color: "#92400E", flex: 1 },
  optionGroup: { gap: SPACING.sm },
  optionCard:  { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md },
  optionCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionLabel: { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  optionLabelActive: { color: COLORS.white },
  optionSub:   { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  linhVucRow:  { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  lvChip:      { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2, borderRadius: RADIUS.full, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  lvChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  lvChipText:  { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  lvChipTextActive: { color: COLORS.white },
  minMaxRow:   { flexDirection: "row", gap: SPACING.md },
  saveBtn:     { flexDirection: "row", backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: TOUCH_TARGET + 8, justifyContent: "center", alignItems: "center", gap: SPACING.sm, marginTop: SPACING.lg, ...SHADOW.elevated },
  saveBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
});