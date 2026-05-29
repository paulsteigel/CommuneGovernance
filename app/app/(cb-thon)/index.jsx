// app/(cb-thon)/index.jsx
import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useAuthStore } from "../../store/authStore";
import { pullManifest } from "../../services/api";
import OfflineBanner from "../../components/OfflineBanner";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

// ── Submission status config ──────────────────────────────────
// submission_status: null | PENDING_VERIFY | IN_REVIEW | NEEDS_REVISION | VERIFIED
const STATUS_CONFIG = {
  null: {
    label:   "Chưa nộp",
    color:   COLORS.accent,
    bg:      "#FFF3E0",
    icon:    "arrow-forward-circle-outline",
    canTap:  true,
  },
  PENDING_VERIFY: {
    label:   "Đang chờ duyệt",
    color:   "#F59E0B",
    bg:      "#FEF3C7",
    icon:    "time-outline",
    canTap:  true,
  },
  IN_REVIEW: {
    label:   "Đang xem xét",
    color:   "#3B82F6",
    bg:      "#EFF6FF",
    icon:    "eye-outline",
    canTap:  true,
  },
  NEEDS_REVISION: {
    label:   "⚠ Cần sửa lại",
    color:   COLORS.danger,
    bg:      COLORS.dangerBg,
    icon:    "alert-circle-outline",
    canTap:  true,
  },
  VERIFIED: {
    label:   "Đã xác nhận ✓",
    color:   COLORS.primary,
    bg:      COLORS.primaryPale,
    icon:    "checkmark-circle",
    canTap:  false,
  },
};

function getStatusCfg(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG[null];
}

export default function CbThonHome() {
  const { user, manifest, xa_code, year, token, offlineQueue } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);

  const thonCode = user?.don_vi;

  // Lọc requests thuộc thôn này
  const requests = (manifest?.requests || []).filter(r =>
    Array.isArray(r.danh_sach_thon) &&
    r.danh_sach_thon.includes(thonCode)
  );

  // Count badge
  const needsAction = requests.filter(r =>
    !r.submission_status || r.submission_status === "NEEDS_REVISION"
  ).length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const netState = await NetInfo.fetch();
    setIsOffline(!netState.isConnected);
    if (netState.isConnected) {
      try {
        const data = await pullManifest({
          token, user_id: user.user_id, xa_code, year,
          current_version: manifest?.manifest_version,
        });
        if (!data.up_to_date) await updateManifest(data.manifest);
      } catch (e) {
        console.warn("Pull manifest error:", e.message);
      }
    }
    setRefreshing(false);
  }, [token, user, xa_code, year, manifest]);

  function handleLogout() {
    Alert.alert("Đăng xuất", "Bạn có chắc muốn đăng xuất?", [
      { text: "Hủy", style: "cancel" },
      { text: "Đăng xuất", style: "destructive", onPress: () => clearAuth() },
    ]);
  }

  function renderRequest({ item }) {
    const cfg      = getStatusCfg(item.submission_status);
    const today    = new Date().toISOString().split("T")[0];
    const isOverdue = item.deadline < today;
    const isRevision = item.submission_status === "NEEDS_REVISION";

    return (
      <TouchableOpacity
        style={[
          styles.card,
          { borderLeftColor: cfg.color },
          isRevision && styles.cardRevision,
        ]}
        onPress={() => {
          if (!cfg.canTap) return;
          router.push({
            pathname: "/(cb-thon)/submit/[reqId]",
            params:   { reqId: item.req_id },
          });
        }}
        activeOpacity={cfg.canTap ? 0.8 : 1}
      >
        {/* Title row */}
        <View style={styles.cardTop}>
          <Text style={styles.reqTitle} numberOfLines={2}>{item.tieu_de}</Text>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        {/* Rejection reason — hiển thị nổi bật khi NEEDS_REVISION */}
        {isRevision && item.verify_comment && (
          <View style={styles.rejectionBox}>
            <Ionicons name="chatbubble-outline" size={13} color={COLORS.danger} />
            <Text style={styles.rejectionText} numberOfLines={2}>
              {item.verify_comment}
            </Text>
          </View>
        )}

        {/* Meta */}
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={15}
              color={isOverdue ? COLORS.danger : COLORS.textSecondary}
            />
            <Text style={[styles.metaText, isOverdue && styles.overdue]}>
              Hạn: {item.deadline}{isOverdue ? "  ⚠ Quá hạn" : ""}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="bar-chart-outline" size={15} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.chi_so_ids?.length || 0} chỉ tiêu</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.cardFooter}>
          <Text style={styles.reqId}>{item.req_id}</Text>
          <Ionicons
            name={cfg.icon}
            size={22}
            color={cfg.color}
          />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Xin chào,</Text>
            <Text style={styles.userName}>{user?.ho_ten || user?.user_id}</Text>
            <Text style={styles.userRole}>Cán bộ thôn · {thonCode}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {/* Badges */}
        <View style={styles.badgeRow}>
          {offlineQueue.length > 0 && (
            <View style={styles.badge}>
              <Ionicons name="cloud-upload-outline" size={14} color={COLORS.accent} />
              <Text style={styles.badgeText}>{offlineQueue.length} chờ gửi</Text>
            </View>
          )}
          {needsAction > 0 && (
            <View style={[styles.badge, { backgroundColor: COLORS.dangerBg }]}>
              <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
              <Text style={[styles.badgeText, { color: COLORS.danger }]}>
                {needsAction} cần xử lý
              </Text>
            </View>
          )}
        </View>
      </View>

      {isOffline && <OfflineBanner />}

      <FlatList
        data={requests}
        keyExtractor={item => item.req_id}
        renderItem={renderRequest}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Yêu cầu thu thập</Text>
            <Text style={styles.sectionCount}>{requests.length} yêu cầu</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={64} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>Không có yêu cầu nào</Text>
            <Text style={styles.emptySubtitle}>Kéo xuống để làm mới</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.background },
  header:      { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting:    { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)" },
  userName:    { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  userRole:    { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  logoutBtn:   { padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.full },
  badgeRow:    { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md, flexWrap: "wrap" },
  badge:       { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.white, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, gap: SPACING.xs },
  badgeText:   { ...TYPOGRAPHY.labelMedium, color: COLORS.accent },
  list:        { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md, paddingHorizontal: SPACING.xs },
  sectionTitle:   { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  sectionCount:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  card:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, borderLeftWidth: 4, borderLeftColor: COLORS.accent, gap: SPACING.sm },
  cardRevision:   { borderWidth: 1.5, borderColor: COLORS.danger, borderLeftWidth: 4, borderLeftColor: COLORS.danger },
  cardTop:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.sm },
  reqTitle:    { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, flex: 1 },
  statusBadge: { borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  statusText:  { ...TYPOGRAPHY.caption, fontWeight: "600" },
  rejectionBox:   { flexDirection: "row", alignItems: "flex-start", gap: SPACING.xs, backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  rejectionText:  { ...TYPOGRAPHY.caption, color: COLORS.danger, flex: 1 },
  cardMeta:    { gap: SPACING.xs },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  overdue:     { color: COLORS.danger },
  cardFooter:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reqId:       { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  empty:       { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  emptySubtitle:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
});
