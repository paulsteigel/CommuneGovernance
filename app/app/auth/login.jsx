// app/(auth)/login.jsx
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { login } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, TOUCH_TARGET, SHADOW } from "../../constants/theme";
import { CURRENT_YEAR } from "../../constants/config";
import LoadingOverlay from "../../components/LoadingOverlay";

export default function LoginScreen() {
  const setAuth = useAuthStore(s => s.setAuth);

  const [userId,   setUserId]   = useState("");
  const [password, setPassword] = useState("");
  const [xaCode,   setXaCode]   = useState("");
  const [year,     setYear]     = useState(String(CURRENT_YEAR));
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleLogin() {
    setError("");
    if (!userId.trim() || !password || !xaCode.trim()) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }
    setLoading(true);
    try {
      const data = await login({
        user_id:  userId.trim().toUpperCase(),
        password,
        xa_code:  xaCode.trim().toUpperCase(),
        year:     Number(year) || CURRENT_YEAR,
      });

      // ✅ Đọc đúng field từ manifest.user (ho_ten, không phải ten)
      const manifestUser = data.manifest?.user || {};
      const user = {
        user_id:        manifestUser.user_id  || userId.trim().toUpperCase(),
        vai_tro:        manifestUser.vai_tro,
        ho_ten:         manifestUser.ho_ten,
        don_vi:         manifestUser.don_vi,
        nhanh:          manifestUser.nhanh,
        xa_code:        manifestUser.xa_code,
        linh_vuc_codes: manifestUser.linh_vuc_codes || [],
      };

      await setAuth({
        token:    data.token,
        user,
        xa_code:  xaCode.trim().toUpperCase(),
        year:     Number(year) || CURRENT_YEAR,
        manifest: data.manifest,
      });

    } catch (err) {
      setError(err.message || "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {loading && <LoadingOverlay message="Đang đăng nhập..." />}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <Ionicons name="leaf" size={40} color={COLORS.white} />
            </View>
            <Text style={styles.appName}>CommuneGovernance</Text>
            <Text style={styles.appSub}>Hệ thống thu thập số liệu xã</Text>
          </View>

          {/* Form */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Đăng nhập</Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mã cán bộ</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={22} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Ví dụ: USR_THON01"
                  value={userId}
                  onChangeText={setUserId}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholderTextColor={COLORS.textHint}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mật khẩu</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={22} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Mật khẩu"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPass}
                  placeholderTextColor={COLORS.textHint}
                />
                <TouchableOpacity onPress={() => setShowPass(v => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mã xã</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="location-outline" size={22} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Ví dụ: XATEST"
                  value={xaCode}
                  onChangeText={setXaCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholderTextColor={COLORS.textHint}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Năm</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="2025"
                  value={year}
                  onChangeText={setYear}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  placeholderTextColor={COLORS.textHint}
                />
              </View>
            </View>

            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} activeOpacity={0.85}>
              <Text style={styles.loginBtnText}>Đăng nhập</Text>
              <Ionicons name="arrow-forward" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>CARE Vietnam © {CURRENT_YEAR}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: COLORS.primary },
  scroll:     { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  header:     { alignItems: "center", paddingTop: SPACING.xxl, paddingBottom: SPACING.xl },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center", marginBottom: SPACING.md,
  },
  appName:  { ...TYPOGRAPHY.displayMedium, color: COLORS.white, marginBottom: SPACING.xs },
  appSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)" },
  card:     { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: SPACING.xl, ...SHADOW.elevated, gap: SPACING.md },
  cardTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  errorBox:  { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm },
  errorText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger, flex: 1 },
  fieldGroup: { gap: SPACING.xs },
  label:    { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    backgroundColor: COLORS.background, minHeight: TOUCH_TARGET, paddingHorizontal: SPACING.md,
  },
  inputIcon: { marginRight: SPACING.sm },
  input:    { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, flex: 1, height: TOUCH_TARGET },
  eyeBtn:   { padding: SPACING.xs },
  loginBtn: {
    flexDirection: "row", backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    height: TOUCH_TARGET + 4, justifyContent: "center", alignItems: "center",
    gap: SPACING.sm, marginTop: SPACING.sm, ...SHADOW.card,
  },
  loginBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
  footer:   { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.6)", textAlign: "center", marginTop: SPACING.xl },
});
