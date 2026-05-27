// app/(lanh-dao)/index.jsx
// LANH_DAO dashboard — 2 sections:
//   1. "Cần xử lý"  — pending_verifications từ manifest (offline-capable)
//   2. "Tiến độ"    — request progress từ /dashboard API

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

// Statuses cần LANH_DAO xử lý (không tính VERIFIED)
const ACTIONABLE = new Set(["PENDING_VERIFY", "IN_REVIEW", "NEEDS_REVISION"]);

export default function LanhDaoDashboard() {
  const { user, xa_code, year, token, manifest } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [dashboard,  setDashboard]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);
  const [error,      setError]      = useState(null);

  // ── Pending verifications từ manifest (offline) ──────────
  const pendingVerifs = (manifest?.pending_verifications || [])
    .filter(s => ACTIONABLE.has(s.status));

  // ── Dashboard fetch (requires network) ──────────────────
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

  // ── SectionList data ─────────────────────────────────────
  const sections = [
    {
      key:   "action",
      title: `Cần xử lý (${pendingVerifs.length})`,
      data:  pendingVerifs,
      empty: "Không có bản ghi cần xử lý",
    },
    {
      key:   "progress",
      title: `Tiến độ · ${dashboard?.requests?.length || 0} yêu cầu`,
      data:  dashboard?.requests || [],
      empty: "Chưa có yêu cầu nào",
    },
  ];

  // ── Render: pending verification card ───────────────────
  function renderPending({ item }) {
    const date = item.submitted_at?.slice(0, 10) || "—";
    const isRevision = item.status === "NEEDS_REVISION";
    return (
      <TouchableOpacity
        style={[styles.card, isRevision && styles.cardRevision]}
        onPress={() => router.push({
          pathname: "/(lanh-dao)/verify/[subId]",
          params:   { subId: item.submission_id },
        })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <Text style={styles.thonLabel}>Thôn {item.thon_code}</Text>
          <StatusBadge status={item.status} size="small" />
        </View>
        <Text style={styles.reqTitle} numberOfLines={1}>{item.tieu_de || item.req_id}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.submitted_by}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{date}</Text>
          </View>
          <Ionicons name="arrow-forward-circle-outline" size={20} color={COLORS.accent} />
        </View>
      </TouchableOpacity>
    );
  }

  // ── Render: request progress card ───────────────────────
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
          {[
            { num: item.total_thon,     label: "Tổng thôn",  color: COLORS.textPrimary },
            { num: item.submitted_thon, label: "Đã nộp",     color: COLORS.accent },
            { num: item.verified_thon,  label: "Đã duyệt",   color: COLORS.primary },
            { num: item.needs_attention,label: "Cần chú ý",  color: item.needs_attention > 0 ? COLORS.danger : COLORS.textHint },
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

  function renderItem({ item, section }) {
    if (section.key === "action")   return renderPending({ item });
    if (section.key === "progress") return renderRequest({ item });
    return null;
  }

  function renderSectionHeader({ section }) {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
      </View>
    );
  }

  function renderSectionEmpty(section) {
    if (section.data.length > 0) return null;
    return (
      <View style={styles.emptySection}>
        <Text style={styles.emptySectionText}>{section.empty}</Text>
      </View>
    );
  }

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

        {/* Summary bar — từ manifest (offline) + dashboard */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{pendingVerifs.length}</Text>
            <Text style={styles.summaryLabel}>Cần duyệt</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNum, { color: "#A5D6A7" }]}>
              {summary?.verified || 0}
            </Text>
            <Text style={styles.summaryLabel}>Đã duyệt</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNum, { color: "#FFE082" }]}>
              {summary?.pending_verify || 0}
            </Text>
            <Text style={styles.summaryLabel}>Chờ duyệt</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNum,
              { color: (summary?.needs_attention || 0) > 0 ? "#EF9A9A" : COLORS.white }]}>
              {summary?.needs_attention || 0}
            </Text>
            <Text style={styles.summaryLabel}>Cần chú ý</Text>
          </View>
        </View>
      </View>

      {isOffline && <OfflineBanner />}

      <SectionList
        sections={sections}
        keyExtractor={(item, idx) => item.submission_id || item.req_id || String(idx)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={({ section }) => renderSectionEmpty(section)}
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

  list: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  sectionHeader: { paddingBottom: SPACING.sm, paddingTop: SPACING.md },
  sectionTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },

  emptySection:     { alignItems: "center", paddingVertical: SPACING.lg },
  emptySectionText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },

  // Pending verification cards
  card:         { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOW.card, gap: SPACING.xs },
  cardRevision: { borderWidth: 1.5, borderColor: COLORS.danger },
  cardTop:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  thonLabel:    { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  cardMeta:     { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },

  // Request progress cards
  reqCard:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.md },
  reqCardOverdue: { borderWidth: 1.5, borderColor: COLORS.danger },
  reqTop:         { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.sm },
  reqTitle:       { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600", flex: 1 },
  progressWrap:   { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  progressBg:     { flex: 1, height: 10, backgroundColor: COLORS.divider, borderRadius: RADIUS.full, overflow: "hidden" },
  progressFill:   { height: "100%", borderRadius: RADIUS.full },
  progressText:   { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary, width: 40, textAlign: "right" },
  statsRow:       { flexDirection: "row" },
  statItem:       { flex: 1, alignItems: "center", gap: 2 },
  statNum:        { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  statLabel:      { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  missingWrap:    { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.pendingBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  missingText:    { ...TYPOGRAPHY.caption, color: COLORS.accent, flex: 1 },
  overdueBadge:   { flexDirection: "row", alignItems: "center", gap: SPACING.xs, backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.sm, padding: SPACING.sm },
  overdueText:    { ...TYPOGRAPHY.caption, color: COLORS.danger },
});
