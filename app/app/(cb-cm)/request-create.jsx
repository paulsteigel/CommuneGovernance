// app/(cb-cm)/request-create.jsx
// Tạo yêu cầu thu thập số liệu mới.
// Chỉ số: chọn từ manifest.indicators (ACTIVE, theo linh_vuc CB_CM).
// Thôn: chip từ danh sách rút ra từ requests hiện có + nhập thủ công.
// Sau khi tạo: force-pull manifest để index.jsx thấy request mới ngay.

import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { createRequest, pullManifest } from "../../services/api";
import LoadingOverlay from "../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";

const LINH_VUC_LABEL = {
  NONG_NGHIEP: "Nông nghiệp", XA_HOI: "Xã hội",
  CO_SO_HA_TANG: "Hạ tầng",  AN_NINH: "An ninh", KINH_TE: "Kinh tế",
};

export default function RequestCreate() {
  const router = useRouter();
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);

  // Thôn list từ requests đã có trong manifest
  const knownThons = useMemo(() => {
    const set = new Set();
    (manifest?.requests || []).forEach(r =>
      (r.danh_sach_thon || []).forEach(t => set.add(t))
    );
    return [...set].sort();
  }, [manifest]);

  // ACTIVE indicators lọc theo linh_vuc của CB_CM
  const activeIndicators = useMemo(() => {
    const allowedLv = new Set(user?.linh_vuc_codes || []);
    return (manifest?.indicators || []).filter(ind =>
      allowedLv.size === 0 || allowedLv.has(ind.linh_vuc)
    );
  }, [manifest, user]);

  const [tieu_de,       setTieuDe]       = useState("");
  const [deadline,      setDeadline]     = useState("");
  const [ghi_chu,       setGhiChu]       = useState("");
  const [selectedInds,  setSelectedInds] = useState(new Set());
  const [selectedThons, setSelectedThons]= useState(new Set());
  const [customThon,    setCustomThon]   = useState("");
  const [loading,       setLoading]      = useState(false);

  function toggleInd(id) {
    setSelectedInds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleThon(code) {
    setSelectedThons(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function addCustomThon() {
    const code = customThon.trim().toUpperCase();
    if (!code) return;
    setSelectedThons(prev => new Set([...prev, code]));
    setCustomThon("");
  }

  async function handleCreate() {
    if (!tieu_de.trim()) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập tiêu đề yêu cầu.");
      return;
    }
    if (selectedInds.size === 0) {
      Alert.alert("Thiếu thông tin", "Vui lòng chọn ít nhất 1 chỉ số thu thập.");
      return;
    }
    if (selectedThons.size === 0) {
      Alert.alert("Thiếu thông tin", "Vui lòng chọn ít nhất 1 thôn.");
      return;
    }
    if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      Alert.alert("Sai định dạng", "Hạn nộp phải có dạng YYYY-MM-DD.\nVí dụ: 2025-12-31");
      return;
    }

    setLoading(true);
    try {
      await createRequest({
        token, user_id: user.user_id, xa_code, year,
        tieu_de:        tieu_de.trim(),
        chi_so_ids:     [...selectedInds],
        danh_sach_thon: [...selectedThons],
        deadline,
        ghi_chu:        ghi_chu.trim() || null,
      });

      // Force-pull manifest để index.jsx thấy request mới ngay
      try {
        const fresh = await pullManifest({ token, user_id: user.user_id, xa_code, year });
        if (fresh.manifest) await updateManifest(fresh.manifest);
      } catch (e) { console.warn("Manifest refresh after createRequest:", e.message); }

      Alert.alert(
        "Đã tạo yêu cầu ✓",
        `Yêu cầu "${tieu_de.trim()}" đã được tạo và gửi tới ${selectedThons.size} thôn.`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert("Lỗi", err.message);
    } finally {
      setLoading(false);
    }
  }

  // Thôn thủ công (không có trong knownThons)
  const customThons = [...selectedThons].filter(t => !knownThons.includes(t));

  return (
    <>
      <Stack.Screen options={{
        title: "Tạo yêu cầu thu thập",
        headerShown: true,
        headerBackTitle: "Quay lại",
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
      }} />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {loading && <LoadingOverlay message="Đang tạo yêu cầu..." />}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            {/* ── Tiêu đề ── */}
            <Text style={styles.label}>
              Tiêu đề yêu cầu <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="VD: Thu thập số liệu nông nghiệp Q3 2025"
              placeholderTextColor={COLORS.textHint}
              value={tieu_de}
              onChangeText={setTieuDe}
            />

            {/* ── Hạn nộp ── */}
            <Text style={styles.label}>
              Hạn nộp <Text style={styles.required}>*</Text>
              <Text style={styles.labelHint}> (YYYY-MM-DD)</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="2025-12-31"
              placeholderTextColor={COLORS.textHint}
              value={deadline}
              onChangeText={setDeadline}
              keyboardType="numeric"
              maxLength={10}
            />

            {/* ── Chỉ số thu thập ── */}
            <Text style={styles.label}>
              Chỉ số thu thập <Text style={styles.required}>*</Text>
              {selectedInds.size > 0 && (
                <Text style={styles.labelCount}> · {selectedInds.size} đã chọn</Text>
              )}
            </Text>

            {activeIndicators.length === 0 ? (
              <View style={styles.warningBox}>
                <Ionicons name="warning-outline" size={16} color="#92400E" />
                <Text style={styles.warningText}>
                  Chưa có chỉ số ACTIVE trong lĩnh vực của bạn.{"\n"}
                  Vào tab Chỉ số → tạo và gửi duyệt chỉ số trước.
                </Text>
              </View>
            ) : (
              <View style={styles.checkList}>
                {activeIndicators.map((ind, idx) => {
                  const checked = selectedInds.has(ind.chi_so_id);
                  const isLast  = idx === activeIndicators.length - 1;
                  return (
                    <TouchableOpacity
                      key={ind.chi_so_id}
                      style={[
                        styles.checkRow,
                        checked && styles.checkRowActive,
                        !isLast && styles.checkRowBorder,
                      ]}
                      onPress={() => toggleInd(ind.chi_so_id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={24}
                        color={checked ? COLORS.primary : COLORS.textHint}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.checkName, checked && { color: COLORS.primary }]}>
                          {ind.ten_chi_so}
                        </Text>
                        <Text style={styles.checkMeta}>
                          {LINH_VUC_LABEL[ind.linh_vuc] || ind.linh_vuc}
                          {ind.don_vi_do ? ` · ${ind.don_vi_do}` : ""}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── Thôn thu thập ── */}
            <Text style={styles.label}>
              Thôn thu thập <Text style={styles.required}>*</Text>
              {selectedThons.size > 0 && (
                <Text style={styles.labelCount}> · {selectedThons.size} đã chọn</Text>
              )}
            </Text>

            {/* Chips thôn từ manifest */}
            {knownThons.length > 0 && (
              <View style={styles.chips}>
                {knownThons.map(thon => {
                  const active = selectedThons.has(thon);
                  return (
                    <TouchableOpacity
                      key={thon}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleThon(thon)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {thon}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Nhập thôn thủ công */}
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={knownThons.length > 0 ? "Thêm mã thôn khác..." : "Nhập mã thôn (VD: THON01)"}
                placeholderTextColor={COLORS.textHint}
                value={customThon}
                onChangeText={v => setCustomThon(v.toUpperCase())}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={addCustomThon}
              />
              <TouchableOpacity style={styles.addBtn} onPress={addCustomThon}>
                <Ionicons name="add" size={24} color={COLORS.white} />
              </TouchableOpacity>
            </View>

            {/* Thôn thủ công đã thêm */}
            {customThons.length > 0 && (
              <View style={styles.chips}>
                {customThons.map(thon => (
                  <TouchableOpacity
                    key={thon}
                    style={[styles.chip, styles.chipActive]}
                    onPress={() => toggleThon(thon)}
                  >
                    <Text style={styles.chipTextActive}>{thon}</Text>
                    <Ionicons name="close" size={12} color={COLORS.white} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Ghi chú ── */}
            <Text style={styles.label}>Ghi chú (tùy chọn)</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="Hướng dẫn bổ sung cho cán bộ thôn..."
              placeholderTextColor={COLORS.textHint}
              value={ghi_chu}
              onChangeText={setGhiChu}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* ── Submit ── */}
            <TouchableOpacity
              style={[
                styles.createBtn,
                (activeIndicators.length === 0) && styles.createBtnDisabled,
              ]}
              onPress={handleCreate}
              disabled={activeIndicators.length === 0}
              activeOpacity={0.85}
            >
              <Ionicons name="send-outline" size={22} color={COLORS.white} />
              <Text style={styles.createBtnText}>Tạo yêu cầu</Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  label:     { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.xs },
  labelHint: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, fontWeight: "400" },
  labelCount:{ ...TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: "600" },
  required:  { color: COLORS.danger },

  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    height: TOUCH_TARGET,
    ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  inputMulti: { height: 88, paddingTop: SPACING.sm },

  warningBox: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    backgroundColor: "#FEF3C7", borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: "#F59E0B",
  },
  warningText: { ...TYPOGRAPHY.bodyMedium, color: "#92400E", flex: 1 },

  checkList: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: COLORS.border, overflow: "hidden",
    marginBottom: SPACING.xs,
  },
  checkRow: {
    flexDirection: "row", alignItems: "center",
    gap: SPACING.md, padding: SPACING.md,
  },
  checkRowActive:  { backgroundColor: COLORS.primaryPale },
  checkRowBorder:  { borderBottomWidth: 0.5, borderBottomColor: COLORS.divider },
  checkName: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontWeight: "600" },
  checkMeta: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginBottom: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.full, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.white, flexDirection: "row", alignItems: "center",
  },
  chipActive:     { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:       { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  chipTextActive: { ...TYPOGRAPHY.labelMedium, color: COLORS.white },

  addRow: { flexDirection: "row", gap: SPACING.sm, alignItems: "center", marginBottom: SPACING.sm },
  addBtn: {
    width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center",
  },

  createBtn: {
    flexDirection: "row", backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md, height: TOUCH_TARGET + 8,
    justifyContent: "center", alignItems: "center",
    gap: SPACING.sm, marginTop: SPACING.lg, ...SHADOW.elevated,
  },
  createBtnDisabled: { backgroundColor: COLORS.textHint },
  createBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
});