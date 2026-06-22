// app/(admin)/setup.jsx
// Admin — cấu hình xã: tên xã, danh sách thôn, tham số hệ thống, đăng xuất

import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { getCommuneConfig, setupCommune, logout as apiLogout } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";

// ─── Vietnamese slug for thon_code ────────────────────────────
function toThonSlug(str) {
  const map = {
    a: "àáạảãâầấậẩẫăằắặẳẵ", e: "èéẹẻẽêềếệểễ",
    i: "ìíịỉĩ", o: "òóọỏõôồốộổỗơờớợởỡ",
    u: "ùúụủũưừứựửữ", y: "ỳýỵỷỹ", d: "đ",
  };
  let s = str.toLowerCase();
  for (const [k, v] of Object.entries(map))
    for (const c of v) s = s.split(c).join(k);
  return "thon_" + s.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function SetupScreen() {
  const { token, user, xa_code, clearAuth, year } = useAuthStore();

  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Commune fields
  const [tenXa,     setTenXa]    = useState("");
  const [tinh,      setTinh]     = useState("");
  const [timeout,   setTimeout_] = useState("5");
  const [thonList,  setThonList] = useState([]); // [{thon_code, ten_thon}]

  // New thôn input
  const [newThon,   setNewThon]  = useState("");

  // ── Load commune config on focus ──────────────────────────
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          const data = await getCommuneConfig({ token, user_id: user.user_id, xa_code });
          if (!active) return;
          setTenXa(data.ten_xa || "");
          setTinh(data.tinh   || "");
          setTimeout_(String(data.bypass_timeout_days ?? 5));
          setThonList(Array.isArray(data.danh_sach_thon) ? data.danh_sach_thon : []);
        } catch (e) {
          // Commune may not exist yet — start fresh
          if (!active) return;
          setTenXa(""); setTinh(""); setTimeout_("5"); setThonList([]);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [xa_code])
  );

  // ── Add thôn ─────────────────────────────────────────────
  function handleAddThon() {
    const name = newThon.trim();
    if (!name) return;
    const code = toThonSlug(name);
    if (thonList.some(t => t.thon_code === code)) {
      Alert.alert("Trùng tên", `Thôn "${name}" đã có trong danh sách`);
      return;
    }
    setThonList(prev => [...prev, { thon_code: code, ten_thon: name }]);
    setNewThon("");
  }

  function handleRemoveThon(code) {
    Alert.alert("Xóa thôn", `Xóa thôn này khỏi danh sách?`, [
      { text: "Hủy", style: "cancel" },
      { text: "Xóa", style: "destructive", onPress: () =>
          setThonList(prev => prev.filter(t => t.thon_code !== code))
      },
    ]);
  }

  // ── Save commune config ───────────────────────────────────
  async function handleSave() {
    if (!tenXa.trim()) {
      Alert.alert("Thiếu thông tin", "Vui lòng nhập tên xã");
      return;
    }
    setSaving(true);
    try {
      const result = await setupCommune({
        token, user_id: user.user_id, xa_code,
        ten_xa:              tenXa.trim(),
        tinh:                tinh.trim(),
        danh_sach_thon:      thonList,
        bypass_timeout_days: Number(timeout) || 5,
      });
      Alert.alert("✅ Đã lưu", result.message || "Cấu hình xã đã được cập nhật");
    } catch (e) {
      Alert.alert("Lỗi", e.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  }

  // ── Logout ────────────────────────────────────────────────
  async function handleLogout() {
    Alert.alert("Đăng xuất", "Bạn có chắc muốn đăng xuất?", [
      { text: "Hủy", style: "cancel" },
      {
        text: "Đăng xuất", style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            await apiLogout({ token, user_id: user.user_id, xa_code, year });
          } catch (_) { /* ignore API errors on logout */ }
          await clearAuth();
        },
      },
    ]);
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Cài đặt xã</Text>
        <Text style={s.headerSub}>{xa_code}</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={s.loadingText}>Đang tải cấu hình…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Card 1: Thông tin xã ─────────────────────── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>
                <Ionicons name="business-outline" size={16} color={COLORS.primary} />
                {"  "}Thông tin xã
              </Text>

              <View style={s.field}>
                <Text style={s.label}>Tên xã (chính thức) *</Text>
                <TextInput
                  style={s.input}
                  value={tenXa}
                  onChangeText={setTenXa}
                  placeholder="Ví dụ: Xã Triệu Sơn"
                  placeholderTextColor={COLORS.textHint}
                  autoCapitalize="words"
                />
              </View>

              <View style={s.field}>
                <Text style={s.label}>Tỉnh / Thành phố</Text>
                <TextInput
                  style={s.input}
                  value={tinh}
                  onChangeText={setTinh}
                  placeholder="Ví dụ: Quảng Trị"
                  placeholderTextColor={COLORS.textHint}
                  autoCapitalize="words"
                />
              </View>

              <View style={s.field}>
                <Text style={s.label}>Mã xã (slug hệ thống)</Text>
                <View style={s.readonlyInput}>
                  <Text style={s.readonlyText}>{xa_code}</Text>
                  <Ionicons name="lock-closed-outline" size={14} color={COLORS.textHint} />
                </View>
              </View>
            </View>

            {/* ── Card 2: Danh sách thôn ──────────────────── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>
                <Ionicons name="map-outline" size={16} color={COLORS.primary} />
                {"  "}Danh sách thôn/bản ({thonList.length})
              </Text>

              {thonList.length === 0 ? (
                <View style={s.emptyThon}>
                  <Ionicons name="location-outline" size={28} color={COLORS.textHint} />
                  <Text style={s.emptyThonText}>Chưa có thôn nào. Thêm thôn bên dưới.</Text>
                </View>
              ) : (
                <View style={s.thonGrid}>
                  {thonList.map(t => (
                    <View key={t.thon_code} style={s.thonChip}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.thonName}>{t.ten_thon}</Text>
                        <Text style={s.thonCode}>{t.thon_code}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRemoveThon(t.thon_code)}
                        style={s.thonDel}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={20} color="#EF9A9A" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Add thôn input */}
              <View style={s.addThonRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={newThon}
                  onChangeText={setNewThon}
                  placeholder="Tên thôn mới…"
                  placeholderTextColor={COLORS.textHint}
                  autoCapitalize="words"
                  onSubmitEditing={handleAddThon}
                  returnKeyType="done"
                />
                <TouchableOpacity style={s.addBtn} onPress={handleAddThon}>
                  <Ionicons name="add" size={24} color={COLORS.white} />
                </TouchableOpacity>
              </View>
              <Text style={s.fieldHint}>
                Mã thôn tự động sinh từ tên. Nhập tên rồi nhấn + để thêm.
              </Text>
            </View>

            {/* ── Card 3: Tham số hệ thống ────────────────── */}
            <View style={s.card}>
              <Text style={s.cardTitle}>
                <Ionicons name="timer-outline" size={16} color={COLORS.primary} />
                {"  "}Tham số hệ thống
              </Text>
              <View style={s.field}>
                <Text style={s.label}>Thời hạn xét duyệt (ngày)</Text>
                <TextInput
                  style={s.input}
                  value={timeout}
                  onChangeText={setTimeout_}
                  keyboardType="number-pad"
                  placeholder="5"
                  placeholderTextColor={COLORS.textHint}
                />
                <Text style={s.fieldHint}>
                  Sau số ngày này, bản gửi chưa duyệt sẽ được escalate lên Lãnh đạo
                </Text>
              </View>
            </View>

            {/* ── Save button ──────────────────────────────── */}
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={COLORS.white} size="small" />
                : <>
                    <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
                    <Text style={s.saveBtnText}>Lưu cấu hình</Text>
                  </>
              }
            </TouchableOpacity>

            {/* ── Divider ──────────────────────────────────── */}
            <View style={s.divider} />

            {/* ── User info ────────────────────────────────── */}
            <View style={s.userCard}>
              <View style={s.userAvatar}>
                <Text style={s.userAvatarLetter}>
                  {(user?.ho_ten || "A")[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.userName}>{user?.ho_ten || "Admin"}</Text>
                <Text style={s.userMeta}>{user?.phone} · {user?.vai_tro}</Text>
                <Text style={s.userMeta}>{xa_code}</Text>
              </View>
            </View>

            {/* ── Logout button ─────────────────────────────── */}
            <TouchableOpacity
              style={[s.logoutBtn, loggingOut && { opacity: 0.6 }]}
              onPress={handleLogout}
              disabled={loggingOut}
              activeOpacity={0.85}
            >
              {loggingOut
                ? <ActivityIndicator color={COLORS.danger} size="small" />
                : <>
                    <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
                    <Text style={s.logoutBtnText}>Đăng xuất</Text>
                  </>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.background },
  header:       { backgroundColor: COLORS.primary, padding: SPACING.lg, paddingTop: SPACING.xl },
  headerTitle:  { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:    { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  center:       { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.sm },
  loadingText:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
  content:      { padding: SPACING.md, gap: SPACING.md, paddingBottom: 48 },

  card:         {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.lg, gap: SPACING.md, ...SHADOW.card,
  },
  cardTitle:    { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  field:        { gap: SPACING.xs },
  label:        { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  input:        {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary,
    height: TOUCH_TARGET, backgroundColor: COLORS.white,
  },
  readonlyInput:  {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1.5, borderColor: "#E0E0E0", borderRadius: RADIUS.md,
    padding: SPACING.md, height: TOUCH_TARGET, backgroundColor: "#F5F5F5",
  },
  readonlyText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.textSecondary },
  fieldHint:    { ...TYPOGRAPHY.caption, color: COLORS.textHint },

  emptyThon:    { alignItems: "center", gap: SPACING.xs, paddingVertical: SPACING.md },
  emptyThonText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint, textAlign: "center" },

  thonGrid:     { gap: SPACING.xs },
  thonChip:     {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border,
  },
  thonName:     { ...TYPOGRAPHY.labelMedium, color: COLORS.textPrimary },
  thonCode:     { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  thonDel:      { marginLeft: SPACING.sm },

  addThonRow:   { flexDirection: "row", gap: SPACING.sm, alignItems: "center" },
  addBtn:       {
    width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center",
  },

  saveBtn:      {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    height: TOUCH_TARGET + 4, gap: SPACING.sm, ...SHADOW.card,
  },
  saveBtnText:  { ...TYPOGRAPHY.titleMedium, color: COLORS.white },

  divider:      { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.sm },

  userCard:     {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.md, ...SHADOW.card,
  },
  userAvatar:   {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryPale,
    justifyContent: "center", alignItems: "center",
  },
  userAvatarLetter: { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  userName:     { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  userMeta:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },

  logoutBtn:    {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: COLORS.danger, borderRadius: RADIUS.md,
    height: TOUCH_TARGET, gap: SPACING.sm,
    backgroundColor: COLORS.white,
  },
  logoutBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.danger },
});
