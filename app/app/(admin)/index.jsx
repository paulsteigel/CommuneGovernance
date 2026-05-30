// app/(admin)/index.jsx
// Admin — quản lý người dùng: xem chờ duyệt, phê duyệt + gán vai trò

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Modal, TextInput, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { listPendingUsers, approveUser } from "../../services/api";
import LoadingOverlay from "../../components/LoadingOverlay";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";
import { ROLES } from "../../constants/config";

const ROLE_OPTIONS = [
  { value: ROLES.CB_THON,       label: "Cán bộ thôn",       icon: "home-outline" },
  { value: ROLES.CB_CHUYEN_MON, label: "Cán bộ chuyên môn", icon: "briefcase-outline" },
  { value: ROLES.LANH_DAO,      label: "Lãnh đạo xã",       icon: "star-outline" },
];

const NHANH_OPTIONS = ["UBND", "MTTQ", "DANG", "HDND"];

export default function AdminUsersScreen() {
  const { token, user, xa_code } = useAuthStore();

  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  // Approve modal state
  const [approveModal,  setApproveModal]  = useState(false);
  const [selectedUser,  setSelectedUser]  = useState(null);
  const [selRole,       setSelRole]       = useState("");
  const [selNhanh,      setSelNhanh]      = useState("");
  const [donVi,         setDonVi]         = useState("");
  const [submitting,    setSubmitting]    = useState(false);

  async function load() {
    try {
      const data = await listPendingUsers({ token, user_id: user.user_id, xa_code });
      setPendingUsers(data.users || []);
    } catch (e) {
      console.warn("List pending:", e.message);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, []);

  function openApprove(usr) {
    setSelectedUser(usr);
    setSelRole("");
    setSelNhanh("");
    setDonVi("");
    setApproveModal(true);
  }

  async function doApprove() {
    if (!selRole || !selNhanh) {
      Alert.alert("Thiếu thông tin", "Vui lòng chọn vai trò và nhánh");
      return;
    }
    setSubmitting(true);
    try {
      const result = await approveUser({
        token, user_id: user.user_id, xa_code,
        target_user_id: selectedUser.user_id,
        vai_tro:        selRole,
        nhanh:          selNhanh,
        don_vi:         donVi.trim() || null,
      });
      setApproveModal(false);
      setPendingUsers(prev => prev.filter(u => u.user_id !== selectedUser.user_id));
      Alert.alert("✅ Đã kích hoạt", result.message);
    } catch (e) {
      Alert.alert("Lỗi", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function renderUser({ item }) {
    const date = item.created_at?.slice(0, 10) || "—";
    return (
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>
              {(item.ho_ten || "?")[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{item.ho_ten}</Text>
            <Text style={styles.userMeta}>
              <Ionicons name="call-outline" size={12} /> {item.phone}
            </Text>
            <Text style={styles.userMeta}>{item.chuc_danh}</Text>
            <Text style={styles.userDate}>Đăng ký: {date}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.approveBtn}
          onPress={() => openApprove(item)}
        >
          <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
          <Text style={styles.approveBtnText}>Phê duyệt</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) return <SafeAreaView style={styles.safe}><LoadingOverlay /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quản lý người dùng</Text>
        <Text style={styles.headerSub}>{xa_code} · {pendingUsers.length} chờ duyệt</Text>
      </View>

      {pendingUsers.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle-outline" size={64} color={COLORS.primaryPale} />
          <Text style={styles.emptyTitle}>Không có yêu cầu mới</Text>
          <Text style={styles.emptyBody}>Tất cả cán bộ đã được duyệt</Text>
        </View>
      ) : (
        <FlatList
          data={pendingUsers}
          keyExtractor={item => item.user_id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              colors={[COLORS.primary]} />
          }
        />
      )}

      {/* Approve Modal */}
      <Modal visible={approveModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Phê duyệt tài khoản</Text>
              {selectedUser && (
                <View style={styles.userInfoCompact}>
                  <Text style={styles.userName}>{selectedUser.ho_ten}</Text>
                  <Text style={styles.userMeta}>{selectedUser.phone} · {selectedUser.chuc_danh}</Text>
                  <Text style={styles.userMeta}>CCCD: {selectedUser.cccd}</Text>
                </View>
              )}

              {/* Role selection */}
              <Text style={styles.fieldLabel}>Vai trò *</Text>
              <View style={styles.optionRow}>
                {ROLE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionChip, selRole === opt.value && styles.optionChipActive]}
                    onPress={() => setSelRole(opt.value)}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={16}
                      color={selRole === opt.value ? COLORS.white : COLORS.textSecondary}
                    />
                    <Text style={[styles.optionText,
                      selRole === opt.value && { color: COLORS.white }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Nhanh selection */}
              <Text style={styles.fieldLabel}>Nhánh *</Text>
              <View style={styles.optionRow}>
                {NHANH_OPTIONS.map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.nhanhChip, selNhanh === n && styles.nhanhChipActive]}
                    onPress={() => setSelNhanh(n)}
                  >
                    <Text style={[styles.nhanhText, selNhanh === n && { color: COLORS.white }]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Don vi */}
              <Text style={styles.fieldLabel}>Đơn vị / Thôn</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Ví dụ: thon_binh_an hoặc Phòng Nông nghiệp"
                value={donVi}
                onChangeText={setDonVi}
                placeholderTextColor={COLORS.textHint}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setApproveModal(false)}
                  disabled={submitting}
                >
                  <Text style={styles.modalCancelText}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, submitting && { opacity: 0.6 }]}
                  onPress={doApprove}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color={COLORS.white} size="small" />
                    : <Text style={styles.modalConfirmText}>Kích hoạt</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.background },
  header:       { backgroundColor: COLORS.primary, padding: SPACING.lg, paddingTop: SPACING.xl },
  headerTitle:  { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:    { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  list:         { padding: SPACING.md, gap: SPACING.sm },
  userCard:     {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: SPACING.md, gap: SPACING.sm, ...SHADOW.card,
  },
  userInfo:     { flexDirection: "row", gap: SPACING.md, alignItems: "flex-start" },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryPale,
    justifyContent: "center", alignItems: "center",
  },
  avatarLetter: { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  userName:     { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  userMeta:     { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  userDate:     { ...TYPOGRAPHY.caption, color: COLORS.textHint, marginTop: 2 },
  approveBtn:   {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    height: TOUCH_TARGET - 8, gap: SPACING.xs,
  },
  approveBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
  emptyState:   { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  emptyTitle:   { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  emptyBody:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalScroll:  { maxHeight: "90%" },
  modalCard:    {
    backgroundColor: COLORS.white, borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl, padding: SPACING.xl, gap: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  modalTitle:   { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  userInfoCompact: {
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    padding: SPACING.md, gap: 4,
  },
  fieldLabel:   { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  optionRow:    { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  optionChip:   {
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  optionChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionText:   { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  nhanhChip:    {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
  },
  nhanhChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  nhanhText:    { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  textInput:    {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary,
    height: TOUCH_TARGET,
  },
  modalActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.xs },
  modalCancelBtn: {
    flex: 1, height: TOUCH_TARGET, justifyContent: "center",
    alignItems: "center", borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  modalCancelText: { ...TYPOGRAPHY.labelLarge, color: COLORS.textSecondary },
  modalConfirmBtn: {
    flex: 2, height: TOUCH_TARGET, justifyContent: "center",
    alignItems: "center", borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  modalConfirmText: { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
});
