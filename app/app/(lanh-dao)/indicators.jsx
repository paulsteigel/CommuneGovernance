// app/(lanh-dao)/indicators.jsx
// LANH_DAO xét duyệt bộ chỉ số do CB_CM submit.

import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { pullManifest, approveIndicator, rejectIndicator } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";

const KIEU_LABEL = { so: "Số", text: "Văn bản", boolean: "Có/Không", anh: "Hình ảnh" };
const LINH_VUC_LABEL = {
  NONG_NGHIEP: "Nông nghiệp", XA_HOI: "Xã hội",
  CO_SO_HA_TANG: "Hạ tầng", AN_NINH: "An ninh", KINH_TE: "Kinh tế",
};

export default function LanhDaoIndicators() {
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);

  const [refreshing,    setRefreshing]    = useState(false);
  const [processing,    setProcessing]    = useState(null); // chi_so_id
  const [rejectModal,   setRejectModal]   = useState(null); // { chi_so_id, ten_chi_so }
  const [rejectReason,  setRejectReason]  = useState("");

  const pending = manifest?.pending_indicators || [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await pullManifest({
        token, user_id: user.user_id, xa_code, year,
        current_version: manifest?.manifest_version,
      });
      if (!data.up_to_date) await updateManifest(data.manifest);
    } catch (e) { console.warn(e.message); }
    setRefreshing(false);
  }, [token, user, xa_code, year, manifest]);

  async function handleApprove(ind) {
    Alert.alert(
      "Duyệt chỉ số",
      `Xác nhận duyệt "${ind.ten_chi_so}"${ind.don_vi_do ? ` (${ind.don_vi_do})` : ""}?\n\nSau khi duyệt, chỉ số này sẽ được kích hoạt và CB_CM có thể sử dụng khi tạo yêu cầu thu thập.`,
      [
        { text: "Hủy", style: "cancel" },
        { text: "Duyệt ✓", onPress: async () => {
          setProcessing(ind.chi_so_id);
          try {
            await approveIndicator({ token, user_id: user.user_id, xa_code, year, chi_so_id: ind.chi_so_id });
            Alert.alert("Đã duyệt ✓", `"${ind.ten_chi_so}" đã được kích hoạt.`);
            onRefresh();
          } catch (err) { Alert.alert("Lỗi", err.message); }
          finally { setProcessing(null); }
        }},
      ]
    );
  }

  function openRejectModal(ind) {
    setRejectReason("");
    setRejectModal({ chi_so_id: ind.chi_so_id, ten_chi_so: ind.ten_chi_so });
  }

  async function handleReject() {
    if (!rejectModal) return;
    setProcessing(rejectModal.chi_so_id);
    try {
      await rejectIndicator({
        token, user_id: user.user_id, xa_code, year,
        chi_so_id: rejectModal.chi_so_id,
        rejection_reason: rejectReason.trim() || null,
      });
      setRejectModal(null);
      Alert.alert("Đã từ chối", "CB_CM sẽ chỉnh sửa và gửi lại.");
      onRefresh();
    } catch (err) { Alert.alert("Lỗi", err.message); }
    finally { setProcessing(null); }
  }

  function renderItem({ item: ind }) {
    const isProcessing = processing === ind.chi_so_id;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.indName}>{ind.ten_chi_so}</Text>
            <Text style={styles.indMeta}>
              {LINH_VUC_LABEL[ind.linh_vuc] || ind.linh_vuc}
              {" · "}{KIEU_LABEL[ind.kieu_du_lieu] || ind.kieu_du_lieu}
              {ind.don_vi_do ? ` · ${ind.don_vi_do}` : ""}
            </Text>
          </View>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Chờ duyệt</Text>
          </View>
        </View>

        {ind.mo_ta && (
          <Text style={styles.indDesc} numberOfLines={2}>{ind.mo_ta}</Text>
        )}

        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={COLORS.textSecondary} />
          <Text style={styles.metaText}>CB: {ind.created_by}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textSecondary} />
          <Text style={styles.metaText}>{ind.created_at?.slice(0, 10) || "—"}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.rejectBtn, isProcessing && { opacity: 0.5 }]}
            onPress={() => openRejectModal(ind)}
            disabled={isProcessing}
          >
            <Ionicons name="close-outline" size={18} color={COLORS.danger} />
            <Text style={styles.rejectBtnText}>Từ chối</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.approveBtn, isProcessing && { opacity: 0.5 }]}
            onPress={() => handleApprove(ind)}
            disabled={isProcessing}
          >
            <Ionicons name="checkmark-outline" size={18} color={COLORS.white} />
            <Text style={styles.approveBtnText}>Duyệt</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Xét duyệt chỉ số</Text>
        <Text style={styles.headerSub}>Lãnh đạo xã · {pending.length} chờ duyệt</Text>
      </View>

      <FlatList
        data={pending}
        keyExtractor={item => item.chi_so_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={64} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>Không có chỉ số chờ duyệt</Text>
            <Text style={styles.emptySub}>Kéo xuống để làm mới</Text>
          </View>
        }
      />

      {/* Reject Modal */}
      <Modal visible={!!rejectModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Từ chối chỉ số</Text>
              <Text style={styles.modalSub}>
                "{rejectModal?.ten_chi_so}"
              </Text>
              <Text style={styles.label}>Lý do từ chối (tùy chọn)</Text>
              <TextInput
                style={styles.reasonInput}
                placeholder="Nhập lý do để CB_CM biết cách sửa..."
                placeholderTextColor={COLORS.textHint}
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                autoFocus
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setRejectModal(null)}
                >
                  <Text style={styles.modalCancelText}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalRejectBtn}
                  onPress={handleReject}
                >
                  <Text style={styles.modalRejectText}>Xác nhận từ chối</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 4 },
  list:  { padding: SPACING.md, paddingBottom: SPACING.xxl },
  card:  { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  cardTop:     { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm },
  indName:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indMeta:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  indDesc:     { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary, fontStyle: "italic" },
  pendingBadge:{ backgroundColor: "#FEF3C7", borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  pendingBadgeText: { ...TYPOGRAPHY.caption, color: "#92400E", fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:{ ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  metaDot: { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  actions: { flexDirection: "row", gap: SPACING.sm },
  rejectBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs, borderWidth: 1.5, borderColor: COLORS.danger, borderRadius: RADIUS.md, paddingVertical: SPACING.md, backgroundColor: COLORS.dangerBg },
  rejectBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.danger },
  approveBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md },
  approveBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.white },
  empty: { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  emptySub:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard:    { backgroundColor: COLORS.white, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.xl, gap: SPACING.md },
  modalTitle:   { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  modalSub:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger, fontStyle: "italic" },
  label:        { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  reasonInput:  { backgroundColor: COLORS.background, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, height: 100, ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary },
  modalActions: { flexDirection: "row", gap: SPACING.sm },
  modalCancelBtn: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, height: TOUCH_TARGET, justifyContent: "center", alignItems: "center" },
  modalCancelText: { ...TYPOGRAPHY.labelLarge, color: COLORS.textSecondary },
  modalRejectBtn:  { flex: 2, backgroundColor: COLORS.danger, borderRadius: RADIUS.md, height: TOUCH_TARGET, justifyContent: "center", alignItems: "center" },
  modalRejectText: { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
});
