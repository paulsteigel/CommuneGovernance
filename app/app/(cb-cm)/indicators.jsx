// app/(cb-cm)/indicators.jsx
// CB_CM quản lý chỉ số của mình.
//
// FIX: sau submitIndicator thành công, optimistic-update status
//      DRAFT/REJECTED → PENDING trong manifest cục bộ.
//      Không gọi thêm pullManifest (bỏ onRefresh() sau submit).
//      → 0 Firestore reads tiêu thêm, UI cập nhật ngay:
//        - Nút "Gửi duyệt" / "Chỉnh sửa" biến mất
//        - Hint "Đang chờ lãnh đạo" hiện ra
//        - Số đếm "Chờ duyệt" tăng lên 1

import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { pullManifest, submitIndicator } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

const STATUS_CFG = {
  DRAFT:    { label: "Nháp",         color: "#888",         bg: "#F5F5F5",        icon: "create-outline" },
  PENDING:  { label: "Chờ duyệt",   color: "#F59E0B",      bg: "#FEF3C7",        icon: "time-outline" },
  ACTIVE:   { label: "Đang dùng",   color: COLORS.primary,  bg: "#EAF3DE",       icon: "checkmark-circle-outline" },
  REJECTED: { label: "Bị từ chối",  color: COLORS.danger,   bg: COLORS.dangerBg,  icon: "close-circle-outline" },
  ARCHIVED: { label: "Lưu trữ",     color: "#888",         bg: "#F5F5F5",        icon: "archive-outline" },
};

const LINH_VUC_LABEL = {
  NONG_NGHIEP: "Nông nghiệp", XA_HOI: "Xã hội",
  CO_SO_HA_TANG: "Hạ tầng",  AN_NINH: "An ninh", KINH_TE: "Kinh tế",
};

const KIEU_LABEL = { so: "Số", text: "Văn bản", boolean: "Có/Không", anh: "Hình ảnh" };

export default function CbCmIndicators() {
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const router         = useRouter();

  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(null); // chi_so_id đang submit

  const indicators = manifest?.my_indicators || [];

  const counts = indicators.reduce((acc, ind) => {
    acc[ind.status] = (acc[ind.status] || 0) + 1;
    return acc;
  }, {});

  // Pull-to-refresh thủ công: gửi current_version bình thường
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await pullManifest({
        token, user_id: user.user_id, xa_code, year,
        current_version: manifest?.manifest_version,
      });
      if (!data.up_to_date && data.manifest) await updateManifest(data.manifest);
    } catch (e) { console.warn(e.message); }
    setRefreshing(false);
  }, [token, user, xa_code, year, manifest]);

  async function handleSubmitForReview(ind) {
    Alert.alert(
      "Gửi duyệt",
      `Gửi "${ind.ten_chi_so}" lên lãnh đạo xét duyệt?`,
      [
        { text: "Hủy", style: "cancel" },
        { text: "Gửi", onPress: async () => {
          setSubmitting(ind.chi_so_id);
          try {
            await submitIndicator({
              token, user_id: user.user_id, xa_code, year,
              chi_so_id: ind.chi_so_id,
            });

            // ── Optimistic local update ─────────────────────────────
            // Cập nhật status DRAFT/REJECTED → PENDING ngay trong local manifest.
            // Dùng getState() tránh stale closure trong async callback.
            // Kết quả:
            //   • Nút "Gửi duyệt"/"Chỉnh sửa" biến mất khỏi card
            //   • Hint "Đang chờ lãnh đạo xét duyệt" hiện ra
            //   • Số đếm "Chờ duyệt" tăng ngay trên header
            //   • 0 Firestore reads tiêu thêm
            const currentManifest = useAuthStore.getState().manifest;
            await updateManifest({
              ...currentManifest,
              my_indicators: (currentManifest?.my_indicators || []).map(i =>
                i.chi_so_id === ind.chi_so_id
                  ? { ...i, status: "PENDING" }
                  : i
              ),
            });
            // ────────────────────────────────────────────────────────

            Alert.alert("Đã gửi ✓", "Chờ lãnh đạo xét duyệt.");
          } catch (err) {
            Alert.alert("Lỗi", err.message);
            // Không optimistic update khi lỗi → UI giữ nguyên status cũ
          } finally {
            setSubmitting(null);
          }
        }},
      ]
    );
  }

  function renderItem({ item: ind }) {
    const cfg          = STATUS_CFG[ind.status] || STATUS_CFG.DRAFT;
    const isDraft      = ind.status === "DRAFT";
    const isRejected   = ind.status === "REJECTED";
    const isActive     = ind.status === "ACTIVE";
    const isSubmitting = submitting === ind.chi_so_id;

    return (
      <View style={[styles.card, isRejected && styles.cardRejected]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.indName}>{ind.ten_chi_so}</Text>
            <Text style={styles.indMeta}>
              {LINH_VUC_LABEL[ind.linh_vuc] || ind.linh_vuc}
              {" · "}{KIEU_LABEL[ind.kieu_du_lieu] || ind.kieu_du_lieu}
              {ind.don_vi_do ? ` · ${ind.don_vi_do}` : ""}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={12} color={cfg.color} />
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        {isRejected && ind.rejection_reason && (
          <View style={styles.rejectionBox}>
            <Ionicons name="chatbubble-outline" size={13} color={COLORS.danger} />
            <Text style={styles.rejectionText} numberOfLines={2}>{ind.rejection_reason}</Text>
          </View>
        )}

        {/* Actions: chỉ hiện khi DRAFT hoặc REJECTED */}
        {(isDraft || isRejected) && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={() => router.push({
                pathname: "/(cb-cm)/indicator-create",
                params: { edit_id: ind.chi_so_id },
              })}
              disabled={isSubmitting}
            >
              <Ionicons name="create-outline" size={16} color={COLORS.primary} />
              <Text style={[styles.actionBtnText, { color: COLORS.primary }]}>Chỉnh sửa</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary, isSubmitting && styles.actionBtnDisabled]}
              onPress={() => handleSubmitForReview(ind)}
              disabled={isSubmitting}
            >
              <Ionicons name="send-outline" size={16} color={COLORS.white} />
              <Text style={[styles.actionBtnText, { color: COLORS.white }]}>
                {isSubmitting ? "Đang gửi..." : isRejected ? "Gửi lại" : "Gửi duyệt"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PENDING: chỉ thông báo, không có action */}
        {ind.status === "PENDING" && (
          <View style={styles.pendingHint}>
            <Ionicons name="time-outline" size={13} color="#F59E0B" />
            <Text style={styles.pendingHintText}>Đang chờ lãnh đạo xét duyệt</Text>
          </View>
        )}

        {isActive && (
          <View style={styles.activeHint}>
            <Ionicons name="checkmark-circle-outline" size={13} color={COLORS.primary} />
            <Text style={styles.activeHintText}>Đang được sử dụng trong thu thập số liệu</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quản lý chỉ số</Text>
        <Text style={styles.headerSub}>CB Chuyên môn · {user?.ho_ten}</Text>
        <View style={styles.summaryRow}>
          {[
            { label: "Nháp",      num: counts.DRAFT    || 0, color: "#9E9E9E" },
            { label: "Chờ duyệt", num: counts.PENDING  || 0, color: "#F59E0B" },
            { label: "Đang dùng", num: counts.ACTIVE   || 0, color: "#A5D6A7" },
            { label: "Từ chối",   num: counts.REJECTED || 0, color: "#EF9A9A" },
          ].map(s => (
            <View key={s.label} style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: s.color }]}>{s.num}</Text>
              <Text style={styles.summaryLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <FlatList
        data={indicators}
        keyExtractor={item => item.chi_so_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="list-outline" size={56} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>Chưa có chỉ số nào</Text>
            <Text style={styles.emptySub}>Bấm + để tạo chỉ số mới</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/(cb-cm)/indicator-create")}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2, marginBottom: SPACING.md },
  summaryRow:  { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, padding: SPACING.sm },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryNum:  { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  summaryLabel:{ ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.8)" },
  list:        { padding: SPACING.md, paddingBottom: 80 },
  card:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  cardRejected:{ borderWidth: 1.5, borderColor: COLORS.danger },
  cardTop:     { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm },
  indName:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indMeta:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  statusText:  { ...TYPOGRAPHY.caption, fontWeight: "600" },
  rejectionBox:{ flexDirection: "row", gap: SPACING.xs, backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  rejectionText:{ ...TYPOGRAPHY.caption, color: COLORS.danger, flex: 1 },
  actions:     { flexDirection: "row", gap: SPACING.sm },
  actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs, borderRadius: RADIUS.md, paddingVertical: SPACING.sm + 2 },
  actionBtnPrimary:   { backgroundColor: COLORS.primary },
  actionBtnSecondary: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.primary },
  actionBtnDisabled:  { opacity: 0.5 },
  actionBtnText:      { ...TYPOGRAPHY.labelMedium },
  pendingHint: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  pendingHintText: { ...TYPOGRAPHY.caption, color: "#F59E0B" },
  activeHint:  { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  activeHintText: { ...TYPOGRAPHY.caption, color: COLORS.primary },
  empty:       { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  emptySub:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
  fab:         { position: "absolute", bottom: SPACING.xl, right: SPACING.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center", elevation: 6 },
});