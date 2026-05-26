// app/(lanh-dao)/index.jsx
import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useAuthStore } from "../../store/authStore";
import { getDashboard } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import LoadingOverlay from "../../components/LoadingOverlay";
import OfflineBanner from "../../components/OfflineBanner";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

export default function LanhDaoDashboard() {
  const { user, xa_code, year, token } = useAuthStore();
  const clearAuth = useAuthStore(s => s.clearAuth);

  const [dashboard,  setDashboard]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);
  const [error,      setError]      = useState(null);

  async function fetchDashboard() {
    try {
      const data = await getDashboard({ token, user_id: user.user_id, xa_code, year });
      setDashboard(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    fetchDashboard().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const netState = await NetInfo.fetch();
    setIsOffline(!netState.isConnected);
    if (netState.isConnected) await fetchDashboard();
    setRefreshing(false);
  }, []);

  function renderRequest({ item }) {
    const pct      = item.completion_pct || 0;
    const barColor = pct === 100 ? COLORS.verified : pct > 50 ? COLORS.accentLight : COLORS.accent;

    return (
      <View style={[styles.reqCard, item.overdue && styles.reqCardOverdue]}>
        <View style={styles.reqTop}>
          <Text style={styles.reqTitle} numberOfLines={2}>{item.tieu_de}</Text>
          <StatusBadge status={item.req_status} size="small" />
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.progressText}>{pct}%</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{item.total_thon}</Text>
            <Text style={styles.statLabel}>Tổng thôn</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: COLORS.accent }]}>{item.submitted_thon}</Text>
            <Text style={styles.statLabel}>Đã nộp</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: COLORS.primary }]}>{item.verified_thon}</Text>
            <Text style={styles.statLabel}>Đã duyệt</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: item.needs_attention > 0 ? COLORS.danger : COLORS.textHint }]}>
              {item.needs_attention}
            </Text>
            <Text style={styles.statLabel}>Cần chú ý</Text>
          </View>
        </View>

        {item.missing_thons?.length > 0 && (
          <View style={styles.missingWrap}>
            <Ionicons name="time-outline" size={14} color={COLORS.accent} />
            <Text style={styles.missingText}>Chưa nộp: {item.missing_thons.join(", ")}</Text>
          </View>
        )}

        {item.overdue && (
          <View style={styles.overdueBadge}>
            <Ionicons name="alert" size={14} color={COLORS.danger} />
            <Text style={styles.overdueText}>Quá hạn · {item.deadline}</Text>
          </View>
        )}
      </View>
    );
  }

  const summary = dashboard?.summary;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {loading && <LoadingOverlay message="Đang tải dashboard..." />}

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Xin chào,</Text>
            {/* ✅ Fix: dùng ho_ten */}
            <Text style={styles.userName}>{user?.ho_ten || user?.user_id}</Text>
            <Text style={styles.userRole}>Lãnh đạo xã · {xa_code} · {year}</Text>
          </View>
          <TouchableOpacity
            onPress={() => Alert.alert("Đăng xuất", "Bạn có chắc muốn đăng xuất?", [
              { text: "Hủy", style: "cancel" },
              { text: "Đăng xuất", style: "destructive", onPress: clearAuth },
            ])}
            style={styles.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={22} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {summary && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{summary.total_requests}</Text>
              <Text style={styles.summaryLabel}>Yêu cầu</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: "#A5D6A7" }]}>{summary.verified}</Text>
              <Text style={styles.summaryLabel}>Đã duyệt</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: "#FFE082" }]}>{summary.pending_verify}</Text>
              <Text style={styles.summaryLabel}>Chờ duyệt</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: summary.needs_attention > 0 ? "#EF9A9A" : COLORS.white }]}>
                {summary.needs_attention}
              </Text>
              <Text style={styles.summaryLabel}>Cần chú ý</Text>
            </View>
          </View>
        )}
      </View>

      {isOffline && <OfflineBanner />}

      {error && !dashboard && (
        <View style={styles.errorWrap}>
          <Ionicons name="cloud-offline-outline" size={40} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={dashboard?.requests || []}
        keyExtractor={item => item.req_id}
        renderItem={renderRequest}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />
        }
        ListHeaderComponent={
          dashboard ? (
            <Text style={styles.sectionTitle}>
              Tiến độ · {dashboard.requests?.length || 0} yêu cầu
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.empty}>
              <Ionicons name="document-outline" size={56} color={COLORS.textHint} />
              <Text style={styles.emptyTitle}>Chưa có yêu cầu nào</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.background },
  header:        { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)" },
  userName:      { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  userRole:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  logoutBtn:     { padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.full },
  summaryCard:   { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, marginTop: SPACING.md, padding: SPACING.md },
  summaryItem:   { flex: 1, alignItems: "center" },
  summaryNum:    { ...TYPOGRAPHY.displayMedium, color: COLORS.white },
  summaryLabel:  { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.75)" },
  summaryDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  list:          { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, marginBottom: SPACING.md },
  reqCard:       { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.md },
  reqCardOverdue: { borderWidth: 1.5, borderColor: COLORS.danger },
  reqTop:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.sm },
  reqTitle:      { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary, flex: 1 },
  progressWrap:  { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  progressBg:    { flex: 1, height: 10, backgroundColor: COLORS.divider, borderRadius: RADIUS.full, overflow: "hidden" },
  progressFill:  { height: "100%", borderRadius: RADIUS.full },
  progressText:  { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary, width: 40, textAlign: "right" },
  statsRow:      { flexDirection: "row" },
  statItem:      { flex: 1, alignItems: "center", gap: 2 },
  statNum:       { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  statLabel:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  missingWrap:   { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.pendingBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  missingText:   { ...TYPOGRAPHY.caption, color: COLORS.accent, flex: 1 },
  overdueBadge:  { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  overdueText:   { ...TYPOGRAPHY.caption, color: COLORS.danger },
  errorWrap:     { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md, padding: SPACING.xl },
  errorText:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.danger, textAlign: "center" },
  retryBtn:      { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.md },
  retryText:     { ...TYPOGRAPHY.labelLarge, color: COLORS.white },
  empty:         { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:    { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
});
