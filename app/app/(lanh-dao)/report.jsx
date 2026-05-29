// app/(lanh-dao)/report.jsx
// Tab "Số liệu" — LANH_DAO: toàn xã, tất cả lĩnh vực

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { getReportData } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW } from "../../constants/theme";

const LINH_VUC_LABEL = {
  NONG_NGHIEP: "Nông nghiệp", XA_HOI: "Xã hội",
  CO_SO_HA_TANG: "Hạ tầng", AN_NINH: "An ninh", KINH_TE: "Kinh tế",
};

export default function LanhDaoReport() {
  const { user, manifest, xa_code, year, token } = useAuthStore();

  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [reportData,   setReportData]   = useState(null);
  const [compareYear,  setCompareYear]  = useState(null);
  const [showYearPick, setShowYearPick] = useState(false);
  const [error,        setError]        = useState(null);

  const currentYear = Number(year);
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear].filter(y => y > 2020);

  // LANH_DAO: thấy tất cả indicators, không lọc lĩnh vực
  const indicators = manifest?.indicators || [];

  async function fetchReport(compare = compareYear) {
    try {
      const data = await getReportData({
        token, user_id: user.user_id, xa_code, year,
        compare_year: compare || undefined,
      });
      setReportData(data);
      setError(null);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    fetchReport().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReport();
    setRefreshing(false);
  }, [compareYear]);

  async function handleCompareYear(y) {
    setShowYearPick(false);
    const newCompare = y === currentYear ? null : y;
    setCompareYear(newCompare);
    setLoading(true);
    await fetchReport(newCompare);
    setLoading(false);
  }

  function getChange(current, compare) {
    if (current == null || compare == null || compare === 0) return null;
    return ((current - compare) / Math.abs(compare) * 100).toFixed(1);
  }

  function renderIndicatorCard(ind) {
    const d       = reportData?.data?.[ind.chi_so_id];
    const c       = reportData?.compare?.[ind.chi_so_id];
    const isBool  = ind.kieu_du_lieu === "boolean";
    const hasData = !!d;

    const currentVal = isBool ? d?.count_true : d?.total;
    const compareVal = isBool ? c?.count_true : c?.total;
    const pctChange  = !isBool ? getChange(currentVal, compareVal) : null;

    return (
      <View key={ind.chi_so_id} style={styles.indCard}>
        <View style={styles.indTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.indName}>{ind.ten_chi_so}</Text>
            <Text style={styles.indMeta}>
              {LINH_VUC_LABEL[ind.linh_vuc] || ind.linh_vuc}
              {ind.don_vi_do ? ` · ${ind.don_vi_do}` : ""}
            </Text>
          </View>
          {pctChange !== null && (
            <View style={[
              styles.changeBadge,
              { backgroundColor: pctChange >= 0 ? "#EAF3DE" : "#FCEBEB" }
            ]}>
              <Ionicons
                name={pctChange >= 0 ? "arrow-up" : "arrow-down"}
                size={11}
                color={pctChange >= 0 ? "#3B6D11" : COLORS.danger}
              />
              <Text style={[styles.changePct, { color: pctChange >= 0 ? "#3B6D11" : COLORS.danger }]}>
                {Math.abs(pctChange)}%
              </Text>
            </View>
          )}
        </View>

        {hasData ? (
          <>
            <View style={styles.valRow}>
              <View style={styles.valBox}>
                <Text style={styles.valNumCurrent}>
                  {isBool
                    ? `${currentVal || 0}/${d?.thon_count || 0} thôn`
                    : currentVal != null ? `${currentVal} ${ind.don_vi_do || ""}`.trim() : "—"
                  }
                </Text>
                <Text style={styles.valLabel}>Năm {currentYear}</Text>
              </View>
              {compareYear && (
                <View style={styles.valBox}>
                  <Text style={styles.valNumCompare}>
                    {isBool
                      ? (c ? `${compareVal || 0}/${c?.thon_count || 0} thôn` : "—")
                      : compareVal != null ? `${compareVal} ${ind.don_vi_do || ""}`.trim() : "—"
                    }
                  </Text>
                  <Text style={styles.valLabel}>Năm {compareYear}</Text>
                </View>
              )}
            </View>

            {/* By-thôn breakdown */}
            {d.by_thon && Object.keys(d.by_thon).length > 0 && (
              <View style={styles.thonBreakdown}>
                {Object.entries(d.by_thon).map(([thon, val]) => (
                  <View key={thon} style={styles.thonRow}>
                    <Text style={styles.thonName}>{thon}</Text>
                    <Text style={styles.thonVal}>
                      {typeof val === "boolean"
                        ? (val ? "Có" : "Không")
                        : `${val} ${ind.don_vi_do || ""}`.trim()}
                    </Text>
                    {c?.by_thon?.[thon] !== undefined && (
                      <Text style={styles.thonCompare}>
                        → {typeof c.by_thon[thon] === "boolean"
                          ? (c.by_thon[thon] ? "Có" : "Không")
                          : `${c.by_thon[thon]} ${ind.don_vi_do || ""}`.trim()}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={styles.noDataRow}>
            <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textHint} />
            <Text style={styles.noDataText}>Chưa có dữ liệu đã xác nhận</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Số liệu {currentYear}</Text>
            <Text style={styles.headerSub}>Lãnh đạo xã · {user?.ho_ten}</Text>
          </View>
          <TouchableOpacity
            style={styles.yearPickBtn}
            onPress={() => setShowYearPick(!showYearPick)}
          >
            <Text style={styles.yearPickText}>
              {compareYear ? `So với ${compareYear}` : "So sánh"}
            </Text>
            <Ionicons name="chevron-down" size={14} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {showYearPick && (
          <View style={styles.yearDropdown}>
            <TouchableOpacity style={styles.yearOption} onPress={() => handleCompareYear(currentYear)}>
              <Text style={styles.yearOptionText}>Không so sánh</Text>
            </TouchableOpacity>
            {yearOptions.filter(y => y !== currentYear).map(y => (
              <TouchableOpacity key={y} style={styles.yearOption} onPress={() => handleCompareYear(y)}>
                <Text style={styles.yearOptionText}>So với năm {y}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.summaryRow}>
          <View style={styles.sumItem}>
            <Text style={styles.sumNum}>{indicators.length}</Text>
            <Text style={styles.sumLabel}>Chỉ số</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumItem}>
            <Text style={styles.sumNum}>
              {reportData ? Object.keys(reportData.data || {}).length : "—"}
            </Text>
            <Text style={styles.sumLabel}>Có dữ liệu</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumItem}>
            <Text style={styles.sumNum}>{compareYear || "—"}</Text>
            <Text style={styles.sumLabel}>Kỳ so sánh</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Đang tải số liệu...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchReport().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        >
          {indicators.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={56} color={COLORS.primary} />
              <Text style={styles.emptyTitle}>Chưa có chỉ số nào được kích hoạt</Text>
            </View>
          ) : (
            indicators.map(ind => renderIndicatorCard(ind))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: SPACING.md },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  yearPickBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2 },
  yearPickText:{ ...TYPOGRAPHY.labelMedium, color: COLORS.white },
  yearDropdown:{ backgroundColor: COLORS.white, borderRadius: RADIUS.md, marginBottom: SPACING.sm, overflow: "hidden" },
  yearOption:  { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderBottomWidth: 0.5, borderBottomColor: "#EEE" },
  yearOptionText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary },
  summaryRow:  { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: RADIUS.md, padding: SPACING.sm },
  sumItem:     { flex: 1, alignItems: "center" },
  sumNum:      { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  sumLabel:    { ...TYPOGRAPHY.caption, color: "rgba(255,255,255,0.8)" },
  sumDivider:  { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  list:        { padding: SPACING.md, paddingBottom: SPACING.xxl },
  indCard:     { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  indTop:      { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm },
  indName:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indMeta:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  changeBadge: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  changePct:   { ...TYPOGRAPHY.caption, fontWeight: "600" },
  valRow:      { flexDirection: "row", gap: SPACING.md },
  valBox:      { flex: 1, backgroundColor: COLORS.background, borderRadius: RADIUS.md, padding: SPACING.md },
  valNumCurrent: { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  valNumCompare: { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  valLabel:    { ...TYPOGRAPHY.caption, color: COLORS.textHint, marginTop: 2 },
  thonBreakdown: { borderTopWidth: 0.5, borderTopColor: COLORS.divider, paddingTop: SPACING.sm, gap: 4 },
  thonRow:     { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  thonName:    { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, width: 70 },
  thonVal:     { ...TYPOGRAPHY.caption, color: COLORS.textPrimary, fontWeight: "500", flex: 1 },
  thonCompare: { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  noDataRow:   { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  noDataText:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  loadingText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  errorWrap:   { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md, padding: SPACING.xl },
  errorText:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger, textAlign: "center" },
  retryBtn:    { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  retryText:   { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  empty:       { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
});
