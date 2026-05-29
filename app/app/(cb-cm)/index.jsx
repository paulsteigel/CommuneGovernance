// app/(cb-cm)/index.jsx
import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, SectionList, TouchableOpacity,
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

export default function CbCmHome() {
  const { user, manifest, xa_code, year, token } = useAuthStore();
  const updateManifest = useAuthStore(s => s.updateManifest);
  const clearAuth      = useAuthStore(s => s.clearAuth);
  const router         = useRouter();

  const [refreshing, setRefreshing] = useState(false);
  const [isOffline,  setIsOffline]  = useState(false);

  // pending_verifications = PENDING_VERIFY + IN_REVIEW (actionable)
  const actionable = manifest?.pending_verifications || [];
  // waiting_revision = NEEDS_REVISION (informational — chờ CB_THON sửa)
  const waitingRevision = manifest?.waiting_revision || [];

  const totalCount  = actionable.length + waitingRevision.length;

  const counts = {
    PENDING_VERIFY: actionable.filter(s => s.status === "PENDING_VERIFY").length,
    IN_REVIEW:      actionable.filter(s => s.status === "IN_REVIEW").length,
    NEEDS_REVISION: waitingRevision.length,
    VERIFIED:       0, // not shown in manifest
  };

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

  // ── Render: actionable submission card (can be verified) ──
  function renderActionable({ item }) {
    const date       = item.submitted_at?.slice(0, 10) || "—";
    const isInReview = item.status === "IN_REVIEW";
    return (
      <TouchableOpacity
        style={[styles.card, isInReview && styles.cardInReview]}
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

  // ── Render: waiting revision card (read-only, CB_THON phải sửa) ──
  function renderWaiting({ item }) {
    const date = item.submitted_at?.slice(0, 10) || "—";
    return (
      <View style={styles.waitingCard}>
        <View style={styles.cardTop}>
          <Text style={styles.thonCode}>Thôn {item.thon_code}</Text>
          <View style={styles.waitingBadge}>
            <Text style={styles.waitingBadgeText}>Chờ thôn sửa</Text>
          </View>
        </View>
        <Text style={styles.reqTitle} numberOfLines={1}>{item.tieu_de || item.req_id}</Text>
        {item.verify_comment && (
          <View style={styles.commentRow}>
            <Ionicons name="chatbubble-outline" size={13} color={COLORS.textHint} />
            <Text style={styles.commentText} numberOfLines={1}>{item.verify_comment}</Text>
          </View>
        )}
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.submitted_by}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{date}</Text>
          </View>
        </View>
      </View>
    );
  }

  const sections = [
    {
      key:   "actionable",
      title: `Cần xét duyệt (${actionable.length})`,
      data:  actionable,
      renderItem: renderActionable,
      empty: "Không có bản ghi nào cần xét duyệt",
    },
    {
      key:   "waiting",
      title: `Chờ thôn sửa lại (${waitingRevision.length})`,
      data:  waitingRevision,
      renderItem: renderWaiting,
      empty: "Không có bản ghi nào đang chờ thôn sửa",
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Xin chào,</Text>
            <Text style={styles.userName}>{user?.ho_ten || user?.user_id}</Text>
            <Text style={styles.userRole}>CB Chuyên môn</Text>
          </View>
          <TouchableOpacity onPress={() => clearAuth()} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          {[
            { num: counts.PENDING_VERIFY, label: "Chờ duyệt",  color: COLORS.white },
            { num: counts.IN_REVIEW,      label: "Đang xem",   color: "#FEF3C7" },
            { num: counts.NEEDS_REVISION, label: "Chờ sửa",    color: "#FCA5A5" },
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
        keyExtractor={(item, idx) => item.submission_id || String(idx)}
        renderItem={({ item, section }) => section.renderItem({ item })}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
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
  safe:          { flex: 1, backgroundColor: COLORS.background },
  header:        { backgroundColor: COLORS.primaryLight || COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)" },
  userName:      { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  userRole:      { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  logoutBtn:     { padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.full },
  summaryRow:    { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, marginTop: SPACING.md, padding: SPACING.md },
  summaryItem:   { flex: 1, alignItems: "center" },
  summaryNum:    { ...TYPOGRAPHY.displayMedium, color: COLORS.white },
  summaryLabel:  { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.8)" },
  summaryDivider:{ width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  list:          { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionHeader: { paddingBottom: SPACING.sm, paddingTop: SPACING.md },
  sectionTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textPrimary },
  emptySection:  { alignItems: "center", paddingVertical: SPACING.lg },
  emptySectionText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },

  // Actionable card (tappable)
  card:          { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  cardInReview:  { borderLeftWidth: 3, borderLeftColor: "#3B82F6" },
  cardTop:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  thonCode:      { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  reqTitle:      { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  cardMeta:      { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  metaRow:       { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  metaText:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },

  // Waiting revision card (read-only, muted)
  waitingCard:   { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm, opacity: 0.75, borderLeftWidth: 3, borderLeftColor: COLORS.danger },
  waitingBadge:  { backgroundColor: COLORS.dangerBg, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  waitingBadgeText: { ...TYPOGRAPHY.caption, color: COLORS.danger, fontWeight: "600" },
  commentRow:    { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  commentText:   { ...TYPOGRAPHY.caption, color: COLORS.textHint, flex: 1, fontStyle: "italic" },
});