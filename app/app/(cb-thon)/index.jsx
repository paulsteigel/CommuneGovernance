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
import StatusBadge from "../../components/StatusBadge";
import OfflineBanner from "../../components/OfflineBanner";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

export default function CbThonHome() {
  const { user, manifest, xa_code, year, token, offlineQueue } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);

  const thonCode = user?.don_vi;

  // ✅ Fix: bỏ filter status (không có trong manifest), lọc theo danh_sach_thon
  const requests = (manifest?.requests || []).filter(r =>
    Array.isArray(r.danh_sach_thon) &&
    r.danh_sach_thon.includes(thonCode)
  );

  // ✅ Fix: dùng has_submitted trực tiếp từ request thay vì my_submissions
  const submittedReqIds = new Set(
    requests.filter(r => r.has_submitted).map(r => r.req_id)
  );

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
    const submitted = submittedReqIds.has(item.req_id);
    const today     = new Date().toISOString().split("T")[0];
    const isOverdue = item.deadline < today;

    return (
      <TouchableOpacity
        style={[styles.card, submitted && styles.cardDone]}
        onPress={() => router.push({
          pathname: "/(cb-thon)/submit/[reqId]",
          params:   { reqId: item.req_id },
        })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <Text style={styles.reqTitle} numberOfLines={2}>{item.tieu_de}</Text>
          <StatusBadge status={submitted ? "VERIFIED" : "PENDING_VERIFY"} size="small" />
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={isOverdue ? COLORS.danger : COLORS.textSecondary} />
            <Text style={[styles.metaText, isOverdue && styles.overdue]}>
              Hạn: {item.deadline}{isOverdue ? "  ⚠ Quá hạn" : ""}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="bar-chart-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.chi_so_ids?.length || 0} chỉ tiêu</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.reqId}>{item.req_id}</Text>
          <Ionicons
            name={submitted ? "checkmark-circle" : "arrow-forward-circle-outline"}
            size={24}
            color={submitted ? COLORS.primary : COLORS.accent}
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
            {/* ✅ Fix: dùng ho_ten thay vì ten */}
            <Text style={styles.userName}>{user?.ho_ten || user?.user_id}</Text>
            <Text style={styles.userRole}>Cán bộ thôn · {thonCode}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {offlineQueue.length > 0 && (
          <View style={styles.queueBadge}>
            <Ionicons name="time-outline" size={16} color={COLORS.accent} />
            <Text style={styles.queueText}>{offlineQueue.length} bản ghi chờ gửi</Text>
          </View>
        )}
      </View>

      {isOffline && <OfflineBanner />}

      <FlatList
        data={requests}
        keyExtractor={item => item.req_id}
        renderItem={renderRequest}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />
        }
        ListHeaderComponent={
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Yêu cầu cần nộp số liệu</Text>
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
  queueBadge:  { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.white, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, alignSelf: "flex-start", marginTop: SPACING.md, gap: SPACING.xs },
  queueText:   { ...TYPOGRAPHY.labelMedium, color: COLORS.accent },
  list:        { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.md, paddingHorizontal: SPACING.xs },
  sectionTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  sectionCount:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  card:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, borderLeftWidth: 4, borderLeftColor: COLORS.accent },
  cardDone:    { borderLeftColor: COLORS.primary, opacity: 0.85 },
  cardTop:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.sm, marginBottom: SPACING.sm },
  reqTitle:    { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, flex: 1 },
  cardMeta:    { gap: SPACING.xs, marginBottom: SPACING.sm },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  overdue:     { color: COLORS.danger },
  cardFooter:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: SPACING.xs },
  reqId:       { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  empty:       { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  emptySubtitle: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
});
