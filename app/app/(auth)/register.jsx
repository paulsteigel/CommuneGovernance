// app/(auth)/register.jsx
// Màn hình đăng ký tài khoản — dùng invite link từ Admin
// Truy cập qua deep link: communegovernance://register?token=XXXX

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { registerUser } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, TOUCH_TARGET, SHADOW } from "../../constants/theme";

export default function RegisterScreen() {
  const { token: linkToken } = useLocalSearchParams();
  const router = useRouter();

  const [hoTen,    setHoTen]    = useState("");
  const [phone,    setPhone]    = useState("");
  const [cccd,     setCccd]     = useState("");
  const [email,    setEmail]    = useState("");
  const [chucDanh, setChucDanh] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleRegister() {
    setError("");
    if (!hoTen.trim() || !phone.trim() || !cccd.trim() || !chucDanh.trim() || !password) {
      setError("Vui lòng điền đầy đủ thông tin (trừ email)");
      return;
    }
    if (password.length < 6) {
      setError("Mật khẩu tối thiểu 6 ký tự");
      return;
    }
    if (!linkToken) {
      setError("Link đăng ký không hợp lệ. Vui lòng liên hệ Admin để nhận link mới.");
      return;
    }

    setLoading(true);
    try {
      const data = await registerUser({
        link_token: linkToken,
        ho_ten:     hoTen.trim(),
        phone:      phone.trim(),
        cccd:       cccd.trim(),
        email:      email.trim() || null,
        chuc_danh:  chucDanh.trim(),
        password,
      });

      Alert.alert(
        "✅ Đăng ký thành công!",
        `${data.message}\n\nVui lòng chờ Admin xã phê duyệt tài khoản. Bạn sẽ nhận thông báo qua Zalo.`,
        [{ text: "Về trang đăng nhập", onPress: () => router.replace("/(auth)/login") }]
      );
    } catch (err) {
      setError(err.message || "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <Ionicons name="person-add" size={36} color={COLORS.white} />
            </View>
            <Text style={styles.appName}>Đăng ký tài khoản</Text>
            <Text style={styles.appSub}>VillageLink · Điền thông tin để tạo tài khoản</Text>
          </View>

          <View style={styles.card}>
            {!linkToken && (
              <View style={styles.warningBox}>
                <Ionicons name="warning" size={20} color={COLORS.accent} />
                <Text style={styles.warningText}>
                  Không tìm thấy link đăng ký. Vui lòng nhờ Admin gửi lại link qua Zalo.
                </Text>
              </View>
            )}

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {[
              { label: "Họ và tên *",         value: hoTen,    set: setHoTen,    placeholder: "Nguyễn Văn A", icon: "person-outline", cap: "words" },
              { label: "Số điện thoại *",      value: phone,    set: setPhone,    placeholder: "0912 345 678",  icon: "call-outline",   cap: "none",  keyboard: "phone-pad" },
              { label: "Số CCCD *",            value: cccd,     set: setCccd,     placeholder: "079123456789",  icon: "card-outline",   cap: "none",  keyboard: "numeric" },
              { label: "Email",                value: email,    set: setEmail,    placeholder: "(Không bắt buộc)", icon: "mail-outline",  cap: "none",  keyboard: "email-address" },
              { label: "Chức danh / Vị trí *", value: chucDanh, set: setChucDanh, placeholder: "Trưởng thôn Bình An", icon: "briefcase-outline", cap: "sentences" },
            ].map(field => (
              <View key={field.label} style={styles.fieldGroup}>
                <Text style={styles.label}>{field.label}</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name={field.icon} size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={field.placeholder}
                    value={field.value}
                    onChangeText={field.set}
                    autoCapitalize={field.cap || "none"}
                    keyboardType={field.keyboard || "default"}
                    autoCorrect={false}
                    placeholderTextColor={COLORS.textHint}
                  />
                </View>
              </View>
            ))}

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mật khẩu * (tối thiểu 6 ký tự)</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Đặt mật khẩu của bạn"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                  placeholderTextColor={COLORS.textHint}
                />
                <TouchableOpacity onPress={() => setShowPass(v => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.registerBtn, (loading || !linkToken) && { opacity: 0.6 }]}
              onPress={handleRegister}
              disabled={loading || !linkToken}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color={COLORS.white} size="small" />
                : <>
                    <Text style={styles.registerBtnText}>Gửi đăng ký</Text>
                    <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
                  </>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
              <Text style={styles.backLink}>← Quay lại đăng nhập</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.primary },
  scroll:       { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  header:       { alignItems: "center", paddingTop: SPACING.xxl, paddingBottom: SPACING.xl },
  logoCircle:   {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
    marginBottom: SPACING.md,
  },
  appName:      { ...TYPOGRAPHY.displayMedium, color: COLORS.white, marginBottom: SPACING.xs },
  appSub:       { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)", textAlign: "center" },
  card:         { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: SPACING.xl, ...SHADOW.elevated, gap: SPACING.md },
  warningBox:   {
    flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm,
    backgroundColor: "#FFF3E0", borderRadius: RADIUS.md, padding: SPACING.md,
  },
  warningText:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.accent, flex: 1 },
  errorBox:     { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm },
  errorText:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger, flex: 1 },
  fieldGroup:   { gap: SPACING.xs },
  label:        { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  inputWrap:    {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    backgroundColor: COLORS.background, minHeight: TOUCH_TARGET,
    paddingHorizontal: SPACING.md,
  },
  inputIcon:    { marginRight: SPACING.sm },
  input:        { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, height: TOUCH_TARGET },
  eyeBtn:       { padding: SPACING.xs },
  registerBtn:  {
    flexDirection: "row", backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md, height: TOUCH_TARGET + 4,
    justifyContent: "center", alignItems: "center",
    gap: SPACING.sm, marginTop: SPACING.sm, ...SHADOW.card,
  },
  registerBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
  backLink:     { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint, textAlign: "center", paddingVertical: SPACING.sm },
});
