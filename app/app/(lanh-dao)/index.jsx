// app/(lanh-dao)/index.jsx
// LANH_DAO dashboard — 3 sections:
//   1. "Cần bypass"    — pending_verifications (PENDING_VERIFY) → tappable, LANH_DAO verify
//   2. "Đang xử lý"   — waiting_revision (IN_REVIEW + NEEDS_REVISION) → informational only
//   3. "Tiến độ"      — request progress từ /dashboard API

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useAuthStore } from "../../store/authStore";
import { getDashboard, pullManifest } from "../../services/api";
import StatusBadge from "../../components/StatusBadge";
import LoadingOverlay from "../../components/LoadingOverlay";
import OfflineBanner from "../../components/OfflineBanner";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

export default function LanhDaoDashboard() {
  const { user, xa_code, year, token, manifest } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [dashboard,  setDashboard]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);

  // PENDING_VERIFY only → LANH_DAO có thể bypass verify
  const bypassItems   = manifest?.pending_verifications || [];
  // IN_REVIEW + NEEDS_REVISION → informational only
  const waitingItems  = manifest?.waiting_revision || [];

  async function fetchDashboard() {
    try {
      const data = await getDashboard({ token, user_id: user.user_id, xa_code, year });
      setDashboard(data);
    } catch (e) {
      console.warn("Dashboard error:", e.message);
    }
  }

  useEffect(() => {
    fetchDashboard().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const netState = await NetInfo.fetch();
    setIsOffline(!netState.isConnected);
    if (netState.isConnected) {
      await Promise.allSettled([
        fetchDashboard(),
        pullManifest({ token, user_id: user.user_id, xa_code, year,
                       current_version: manifest?.manifest_version })
          .then(data => { if (!data.up_to_date) updateManifest(data.manifest); })
          .catch(e => console.warn("Pull manifest:", e.message)),
      ]);
    }
    setRefreshing(false);
  }, [token, user, xa_code, year, manifest]);

  // ── Render: bypass card (tappable) ───────────────────────
  function renderBypass({ item }) {
    const date = item.submitted_at?.slice(0, 10) || "—";
    return (
      <TouchableOpacity
        style={styles.bypassCard}
        onPress={() => router.push({
          pathname: "/(lanh-dao)/verify/[subId]",
          params:   { subId: item.submission_id },
        })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <Text style={styles.thonLabel}>Thôn {item.thon_code}</Text>
          <View style={styles.bypassBadge}>
            <Text style={styles.bypassBadgeText}>Chưa được duyệt</Text>
          </View>
        </View>
        <Text style={styles.reqTitle} numberOfLines={1}>{item.tieu_de || item.req_id}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.submitted_by}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{date}</Text>
          </View>
          <Ionicons name="arrow-forward-circle-outline" size={20} color={COLORS.accent} />
        </View>
      </TouchableOpacity>
    );
  }

  // ── Render: waiting card (read-only) ─────────────────────
  function renderWaiting({ item }) {
    const date      = item.submitted_at?.slice(0, 10) || "—";
    const isRevision = item.status === "NEEDS_REVISION";
    return (
      <View style={[styles.waitingCard, isRevision && styles.waitingCardRevision]}>
        <View style={styles.cardTop}>
          <Text style={styles.thonLabel}>Thôn {item.thon_code}</Text>
          <StatusBadge status={item.status} size="small" />
        </View>
        <Text style={styles.reqTitle} numberOfLines={1}>{item.tieu_de || item.req_id}</Text>
        <Text style={styles.waitingHint}>
          {isRevision
            ? "CB_THON cần gửi lại sau khi sửa"
            : "Cán bộ chuyên môn đang xem xét"}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
          <Text style={styles.metaText}>{date}</Text>
        </View>
      </View>
    );
  }

  // ── Render: request progress card ────────────────────────
  function renderProgress({ item }) {
    const pct      = item.completion_pct || 0;
    const barColor = pct === 100 ? COLORS.primary : pct > 50 ? "#F59E0B" : COLORS.accent;
    return (
      <View style={[styles.progressCard, item.overdue && styles.progressCardOverdue]}>
        <View style={styles.progressTop}>
          <Text style={styles.reqTitle} numberOfLines={2}>{item.tieu_de}</Text>
          <StatusBadge status={item.req_status} size="small" />
        </View>
        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
        <View style={styles.statsRow}>
          {[
            { num: item.total_thon,      label: "Tổng thôn", color: COLORS.textPrimary },
            { num: item.submitted_thon,  label: "Đã nộp",    color: COLORS.accent },
            { num: item.verified_thon,   label: "Đã duyệt",  color: COLORS.primary },
            { num: item.needs_attention, label: "Cần chú ý", color: item.needs_attention > 0 ? COLORS.danger : COLORS.textHint },
          ].map(s => (
            <View key={s.label} style={styles.statItem}>
              <Text style={[styles.statNum, { color: s.color }]}>{s.num ?? 0}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        {item.missing_thons?.length > 0 && (
          <View style={styles.missingWrap}>
            <Ionicons name="time-outline" size={13} color={COLORS.accent} />
            <Text style={styles.missingText}>Chưa nộp: {item.missing_thons.join(", ")}</Text>
          </View>
        )}
        {item.overdue && (
          <View style={styles.overdueBadge}>
            <Ionicons name="alert" size={13} color={COLORS.danger} />
            <Text style={styles.overdueText}>Quá hạn · {item.deadline}</Text>
          </View>
        )}
      </View>
    );
  }

  const sections = [
    {
      key:        "bypass",
      title:      `Cần xác nhận bypass (${bypassItems.length})`,
      data:       bypassItems,
      renderItem: renderBypass,
      empty:      "Không có bản ghi nào cần bypass",
    },
    ...(waitingItems.length > 0 ? [{
      key:        "waiting",
      title:      `Đang xử lý (${waitingItems.length})`,
      data:       waitingItems,
      renderItem: renderWaiting,
      empty:      "",
    }] : []),
    {
      key:        "progress",
      title:      `Tiến độ · ${dashboard?.requests?.length || 0} yêu cầu`,
      data:       dashboard?.requests || [],
      renderItem: renderProgress,
      empty:      "Chưa có yêu cầu nào",
    },
  ];

  const summary = dashboard?.summary;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {loading && <LoadingOverlay message="Đang tải dashboard..." />}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Xin chào,</Text>
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

        <View style={styles.summaryCard}>
          {[
            { num: bypassItems.length,         label: "Cần bypass",  color: "#FEF3C7" },
            { num: summary?.verified || 0,     label: "Đã duyệt",   color: "#A5D6A7" },
            { num: summary?.pending_verify || 0, label: "Chờ duyệt", color: COLORS.white },
            { num: summary?.needs_attention || 0, label: "Cần chú ý",
              color: (summary?.needs_attention || 0) > 0 ? "#EF9A9A" : COLORS.white },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={styles.summaryDivider} />}
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: s.color }]}>{s.num}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {isOffline && <OfflineBanner />}

      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => item.submission_id || item.req_id || String(idx)}
        renderItem={({ item, section }) => section.renderItem({ item })}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 && section.empty ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>{section.empty}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.background },
  header:       { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting:     { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)" },
  userName:     { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  userRole:     { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  logoutBtn:    { padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.full },
  summaryCard:  { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, marginTop: SPACING.md, padding: SPACING.md },
  summaryItem:  { flex: 1, alignItems: "center" },
  summaryNum:   { ...TYPOGRAPHY.displayMedium, color: COLORS.white },
  summaryLabel: { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.75)" },
  summaryDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  list:         { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionHeader:{ paddingBottom: SPACING.sm, paddingTop: SPACING.md },
  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  emptySection: { alignItems: "center", paddingVertical: SPACING.lg },
  emptySectionText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },

  // Bypass card (tappable, actionable)
  bypassCard:   { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOW.card, gap: SPACING.xs, borderLeftWidth: 3, borderLeftColor: "#F59E0B" },
  bypassBadge:  { backgroundColor: "#FEF3C7", borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  bypassBadgeText: { ...TYPOGRAPHY.caption, color: "#92400E", fontWeight: "600" },

  // Waiting card (read-only, muted)
  waitingCard:         { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOW.card, gap: SPACING.xs, opacity: 0.8 },
  waitingCardRevision: { borderLeftWidth: 3, borderLeftColor: COLORS.danger },
  waitingHint:         { ...TYPOGRAPHY.caption, color: COLORS.textHint, fontStyle: "italic" },

  cardTop:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  thonLabel:    { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  reqTitle:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  cardMeta:     { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },

  // Progress card
  progressCard:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.md },
  progressCardOverdue: { borderWidth: 1.5, borderColor: COLORS.danger },
  progressTop:         { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.sm },
  progressWrap:        { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  progressBg:          { flex: 1, height: 10, backgroundColor: COLORS.divider, borderRadius: RADIUS.full, overflow: "hidden" },
  progressFill:        { height: "100%", borderRadius: RADIUS.full },
  progressPct:         { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary, width: 40, textAlign: "right" },
  statsRow:            { flexDirection: "row" },
  statItem:            { flex: 1, alignItems: "center", gap: 2 },
  statNum:             { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  statLabel:           { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  missingWrap:         { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.pendingBg || "#FFF3E0", borderRadius: RADIUS.sm, padding: SPACING.sm },
  missingText:         { ...TYPOGRAPHY.caption, color: COLORS.accent, flex: 1 },
  overdueBadge:        { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  overdueText:         { ...TYPOGRAPHY.caption, color: COLORS.danger },
});
