// app/(cb-cm)/index.jsx
import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl,
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

const FILTER_OPTIONS = [
  { key: "all",            label: "Tất cả" },
  { key: "PENDING_VERIFY", label: "Chờ duyệt" },
  { key: "IN_REVIEW",      label: "Đang xem" },
  { key: "NEEDS_REVISION", label: "Cần sửa" },
  { key: "VERIFIED",       label: "Đã duyệt" },
];

export default function CbCmHome() {
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [filter,     setFilter]     = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);

  // ✅ Fix: dùng pending_verifications nếu có, không thì fallback về []
  const allSubs  = manifest?.pending_verifications || [];
  const filtered = filter === "all" ? allSubs : allSubs.filter(s => s.status === filter);

  const counts = allSubs.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

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

  function renderSub({ item }) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push({
          pathname: "/(cb-cm)/verify/[subId]",
          params:   { subId: item.submission_id },
        })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <Text style={styles.thonCode}>Thôn {item.thon_code}</Text>
          <StatusBadge status={item.status} size="small" />
        </View>
        <Text style={styles.reqTitle} numberOfLines={1}>{item.tieu_de || item.req_id}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={15} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.submitted_by}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={15} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.submitted_at?.slice(0, 10) || "—"}</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.subId}>{item.submission_id?.slice(0, 12)}…</Text>
          <Ionicons name="arrow-forward-circle-outline" size={22} color={COLORS.accent} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Xin chào,</Text>
            {/* ✅ Fix: dùng ho_ten */}
            <Text style={styles.userName}>{user?.ho_ten || user?.user_id}</Text>
            <Text style={styles.userRole}>CB Chuyên môn</Text>
          </View>
          <TouchableOpacity onPress={() => clearAuth()} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{counts["PENDING_VERIFY"] || 0}</Text>
            <Text style={styles.summaryLabel}>Chờ duyệt</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{counts["NEEDS_REVISION"] || 0}</Text>
            <Text style={styles.summaryLabel}>Cần sửa</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{counts["VERIFIED"] || 0}</Text>
            <Text style={styles.summaryLabel}>Đã duyệt</Text>
          </View>
        </View>
      </View>

      {isOffline && <OfflineBanner />}

      <View style={styles.filterRow}>
        {FILTER_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.filterTab, filter === opt.key && styles.filterTabActive]}
            onPress={() => setFilter(opt.key)}
          >
            <Text style={[styles.filterText, filter === opt.key && styles.filterTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.submission_id}
        renderItem={renderSub}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={56} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>Không có dữ liệu cần xét duyệt</Text>
            <Text style={styles.emptySubtitle}>Kéo xuống để làm mới</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.background },
  header:        { backgroundColor: COLORS.primaryLight, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)" },
  userName:      { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  userRole:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  logoutBtn:     { padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.full },
  summaryRow:    { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, marginTop: SPACING.md, padding: SPACING.md },
  summaryItem:   { flex: 1, alignItems: "center" },
  summaryNum:    { ...TYPOGRAPHY.displayMedium, color: COLORS.white },
  summaryLabel:  { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.8)" },
  summaryDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  filterRow:     { flexDirection: "row", backgroundColor: COLORS.white, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm, ...SHADOW.card },
  filterTab:     { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2, borderRadius: RADIUS.full, backgroundColor: COLORS.background },
  filterTabActive: { backgroundColor: COLORS.primary },
  filterText:    { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  filterTextActive: { color: COLORS.white },
  list:          { padding: SPACING.md, paddingBottom: SPACING.xxl },
  card:          { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  cardTop:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  thonCode:      { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  reqTitle:      { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  cardMeta:      { flexDirection: "row", gap: SPACING.lg },
  metaRow:       { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  cardFooter:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subId:         { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  empty:         { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:    { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  emptySubtitle: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
});
