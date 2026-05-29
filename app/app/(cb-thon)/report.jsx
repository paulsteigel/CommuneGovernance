// app/(cb-thon)/report.jsx
// Tab "Số liệu" — CB_THON: chỉ thấy số liệu thôn mình

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

export default function CbThonReport() {
  const { user, manifest, xa_code, year, token } = useAuthStore();

  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [reportData,  setReportData]  = useState(null);
  const [compareYear, setCompareYear] = useState(null);
  const [showPicker,  setShowPicker]  = useState(false);
  const [error,       setError]       = useState(null);

  const currentYear = Number(year);
  const thonCode    = user?.don_vi;
  const yearOptions = [currentYear - 2, currentYear - 1].filter(y => y > 2020);
  const indicators  = manifest?.indicators || [];

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

  async function handleCompare(y) {
    setShowPicker(false);
    const newCompare = y === 0 ? null : y;
    setCompareYear(newCompare);
    setLoading(true);
    await fetchReport(newCompare);
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Số liệu {currentYear}</Text>
            <Text style={styles.headerSub}>Thôn {thonCode}</Text>
          </View>
          <TouchableOpacity
            style={styles.yearBtn}
            onPress={() => setShowPicker(!showPicker)}
          >
            <Text style={styles.yearBtnText}>
              {compareYear ? `So với ${compareYear}` : "So sánh"}
            </Text>
            <Ionicons name="chevron-down" size={13} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {showPicker && (
          <View style={styles.picker}>
            <TouchableOpacity style={styles.pickerOption} onPress={() => handleCompare(0)}>
              <Text style={styles.pickerText}>Không so sánh</Text>
            </TouchableOpacity>
            {yearOptions.map(y => (
              <TouchableOpacity key={y} style={styles.pickerOption} onPress={() => handleCompare(y)}>
                <Text style={styles.pickerText}>So với năm {y}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => { setLoading(true); fetchReport().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        >
          <Text style={styles.sectionLabel}>Số liệu đã xác nhận của {thonCode}</Text>

          {indicators.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={56} color={COLORS.primary} />
              <Text style={styles.emptyTitle}>Chưa có chỉ số nào</Text>
            </View>
          ) : indicators.map(ind => {
            const d      = reportData?.data?.[ind.chi_so_id];
            const c      = reportData?.compare?.[ind.chi_so_id];
            const isBool = ind.kieu_du_lieu === "boolean";

            // CB_THON only sees own thôn — backend already filtered
            const currVal = isBool ? (d?.by_thon?.[thonCode] ?? null) : d?.by_thon?.[thonCode] ?? null;
            const prevVal = isBool ? (c?.by_thon?.[thonCode] ?? null) : c?.by_thon?.[thonCode] ?? null;
            const hasData = currVal !== null && currVal !== undefined;

            let changeLabel = null;
            if (!isBool && currVal != null && prevVal != null && prevVal !== 0) {
              const pct = ((currVal - prevVal) / Math.abs(prevVal) * 100).toFixed(1);
              changeLabel = { pct, up: Number(pct) >= 0 };
            }

            return (
              <View key={ind.chi_so_id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.indName}>{ind.ten_chi_so}</Text>
                    <Text style={styles.indMeta}>
                      {LINH_VUC_LABEL[ind.linh_vuc] || ind.linh_vuc}
                      {ind.don_vi_do ? ` · ${ind.don_vi_do}` : ""}
                    </Text>
                  </View>
                  {changeLabel && (
                    <View style={[styles.changeBadge, { backgroundColor: changeLabel.up ? "#EAF3DE" : "#FCEBEB" }]}>
                      <Ionicons
                        name={changeLabel.up ? "arrow-up" : "arrow-down"}
                        size={11}
                        color={changeLabel.up ? "#3B6D11" : COLORS.danger}
                      />
                      <Text style={[styles.changePct, { color: changeLabel.up ? "#3B6D11" : COLORS.danger }]}>
                        {Math.abs(changeLabel.pct)}%
                      </Text>
                    </View>
                  )}
                </View>

                {hasData ? (
                  <View style={styles.valRow}>
                    <View style={styles.valBox}>
                      <Text style={styles.valCurr}>
                        {isBool
                          ? (currVal ? "Có" : "Không")
                          : `${currVal} ${ind.don_vi_do || ""}`.trim()}
                      </Text>
                      <Text style={styles.valLabel}>{currentYear}</Text>
                    </View>
                    {compareYear && (
                      <View style={styles.valBox}>
                        <Text style={styles.valPrev}>
                          {prevVal != null
                            ? isBool ? (prevVal ? "Có" : "Không") : `${prevVal} ${ind.don_vi_do || ""}`.trim()
                            : "—"
                          }
                        </Text>
                        <Text style={styles.valLabel}>{compareYear}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={styles.noData}>Chưa có số liệu đã xác nhận</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  headerRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.white },
  headerSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  yearBtn:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2 },
  yearBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.white },
  picker:      { backgroundColor: COLORS.white, borderRadius: RADIUS.md, marginTop: SPACING.sm },
  pickerOption:{ padding: SPACING.md, borderBottomWidth: 0.5, borderBottomColor: "#EEE" },
  pickerText:  { ...TYPOGRAPHY.bodyMedium, color: COLORS.textPrimary },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  errorText:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger, textAlign: "center" },
  retryText:   { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  list:        { padding: SPACING.md, paddingBottom: SPACING.xxl },
  sectionLabel:{ ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary, marginBottom: SPACING.md, textTransform: "uppercase", letterSpacing: 0.5 },
  card:        { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, ...SHADOW.card, gap: SPACING.sm },
  cardTop:     { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm },
  indName:     { ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary, fontWeight: "600" },
  indMeta:     { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  changeBadge: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  changePct:   { ...TYPOGRAPHY.caption, fontWeight: "600" },
  valRow:      { flexDirection: "row", gap: SPACING.md },
  valBox:      { flex: 1, backgroundColor: COLORS.background, borderRadius: RADIUS.md, padding: SPACING.md },
  valCurr:     { ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  valPrev:     { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
  valLabel:    { ...TYPOGRAPHY.caption, color: COLORS.textHint, marginTop: 2 },
  noData:      { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint, fontStyle: "italic" },
  empty:       { alignItems: "center", paddingTop: SPACING.xxl * 2, gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleMedium, color: COLORS.textSecondary },
});
