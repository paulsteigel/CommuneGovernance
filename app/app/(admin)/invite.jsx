// app/(admin)/invite.jsx
// Admin — tạo và chia sẻ link mời cán bộ đăng ký

import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Share, Alert, Clipboard, ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { createInviteLink } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";

export default function InviteScreen() {
  const { token, user, xa_code } = useAuthStore();

  const [loading,  setLoading]  = useState(false);
  const [linkData, setLinkData] = useState(null);

  async function handleCreate() {
    setLoading(true);
    try {
      const data = await createInviteLink({ token, user_id: user.user_id, xa_code });
      setLinkData(data);
    } catch (e) {
      Alert.alert("Lỗi", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!linkData) return;
    try {
      await Share.share({
        message: `📋 Đăng ký tài khoản VillageLink cho xã ${xa_code}:\n\n${linkData.web_link}\n\nLink có hiệu lực đến: ${linkData.expires_at?.slice(0, 10)}\n\nSau khi đăng ký, liên hệ Admin để được kích hoạt.`,
        title:   "Link đăng ký VillageLink",
      });
    } catch (e) {
      // User cancelled share
    }
  }

  function handleCopy() {
    if (!linkData) return;
    Clipboard.setString(linkData.web_link);
    Alert.alert("Đã sao chép", "Link đăng ký đã được sao chép vào clipboard");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mời cán bộ đăng ký</Text>
        <Text style={styles.headerSub}>Tạo link mời, chia sẻ qua Zalo</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* How it works */}
        <View style={styles.howCard}>
          <Text style={styles.howTitle}>Cách thức hoạt động</Text>
          {[
            { num: "1", text: "Nhấn \"Tạo link\" để tạo link đăng ký mới (hiệu lực 30 ngày)" },
            { num: "2", text: "Chia sẻ link qua Zalo cho cán bộ cần đăng ký" },
            { num: "3", text: "Cán bộ điền thông tin cá nhân và tự đặt mật khẩu" },
            { num: "4", text: "Quay lại tab \"Người dùng\" để phê duyệt và gán vai trò" },
          ].map(step => (
            <View key={step.num} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{step.num}</Text>
              </View>
              <Text style={styles.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Create button */}
        <TouchableOpacity
          style={[styles.createBtn, loading && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={COLORS.white} size="small" />
            : <>
                <Ionicons name="link" size={22} color={COLORS.white} />
                <Text style={styles.createBtnText}>Tạo link đăng ký mới</Text>
              </>
          }
        </TouchableOpacity>

        {/* Link result */}
        {linkData && (
          <View style={styles.linkCard}>
            <View style={styles.linkCardHeader}>
              <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
              <Text style={styles.linkCardTitle}>Link đã sẵn sàng!</Text>
            </View>

            <View style={styles.linkBox}>
              <Text style={styles.linkText} numberOfLines={3} selectable>
                {linkData.web_link}
              </Text>
            </View>

            <Text style={styles.expiryText}>
              Hết hạn: {linkData.expires_at?.slice(0, 10)}
            </Text>

            <View style={styles.shareRow}>
              <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
                <Ionicons name="copy-outline" size={18} color={COLORS.primary} />
                <Text style={styles.copyBtnText}>Sao chép</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
                <Ionicons name="share-social-outline" size={18} color={COLORS.white} />
                <Text style={styles.shareBtnText}>Chia sẻ qua Zalo</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.inReview} />
              <Text style={styles.noteText}>
                Một link có thể dùng nhiều lần trong thời hạn hiệu lực.
                Sau khi cán bộ đăng ký, vào tab "Người dùng" để phê duyệt.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.background },
  header:        { backgroundColor: COLORS.primary, padding: SPACING.lg, paddingTop: SPACING.xl },
  headerTitle:   { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:     { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  content:       { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl },
  howCard:       {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.lg, gap: SPACING.md, ...SHADOW.card,
  },
  howTitle:      { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  step:          { flexDirection: "row", gap: SPACING.md, alignItems: "flex-start" },
  stepNum:       {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primaryPale,
    justifyContent: "center", alignItems: "center",
    marginTop: 1, flexShrink: 0,
  },
  stepNumText:   { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  stepText:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, flex: 1, lineHeight: 24 },
  createBtn:     {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    height: TOUCH_TARGET + 4, gap: SPACING.sm, ...SHADOW.card,
  },
  createBtnText: { ...TYPOGRAPHY.titleMedium, color: COLORS.white },
  linkCard:      {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.lg, gap: SPACING.md, ...SHADOW.card,
    borderWidth: 2, borderColor: COLORS.primaryPale,
  },
  linkCardHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  linkCardTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  linkBox:       {
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  linkText:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary, fontFamily: "monospace" },
  expiryText:    { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  shareRow:      { flexDirection: "row", gap: SPACING.sm },
  copyBtn:       {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    height: TOUCH_TARGET - 8, gap: SPACING.xs, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.primary,
  },
  copyBtnText:   { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  shareBtn:      {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
    height: TOUCH_TARGET - 8, gap: SPACING.xs, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  shareBtnText:  { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
  noteBox:       {
    flexDirection: "row", gap: SPACING.sm, alignItems: "flex-start",
    backgroundColor: COLORS.inReviewBg || "#E3F2FD",
    borderRadius: RADIUS.md, padding: SPACING.md,
  },
  noteText:      { ...TYPOGRAPHY.caption, color: COLORS.inReview, flex: 1, lineHeight: 20 },
});
