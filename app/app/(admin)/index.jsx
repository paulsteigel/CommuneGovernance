// app/(admin)/index.jsx  — Quản lý người dùng chờ duyệt
import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Modal, TextInput, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";
import { listPendingUsers, approveUser, getCommuneConfig } from "../../services/api";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOW, TOUCH_TARGET } from "../../constants/theme";
import { ROLES } from "../../constants/config";

// ── Linh vực theo nhánh (§2.2) ───────────────────────────────
const LINH_VUC_BY_NHANH = {
  UBND: [
    { code: "NONG_NGHIEP",      label: "Nông nghiệp" },
    { code: "KINH_TE",          label: "Kinh tế – Ngân sách" },
    { code: "CO_SO_HA_TANG",    label: "Cơ sở hạ tầng" },
    { code: "VAN_HOA_XA_HOI",   label: "Văn hóa – Xã hội" },
    { code: "HANH_CHINH",       label: "Hành chính công" },
    { code: "DAN_TOC_TON_GIAO", label: "Dân tộc – Tôn giáo" },
  ],
  MTTQ: [
    { code: "HOI_PHU_NU",      label: "Hội Phụ nữ" },
    { code: "DOAN_THANH_NIEN", label: "Đoàn Thanh niên" },
    { code: "HOI_NONG_DAN",    label: "Hội Nông dân" },
    { code: "HOI_CCB",         label: "Hội Cựu chiến binh" },
    { code: "CONG_TAC_MTTQ",   label: "Công tác MTTQ" },
  ],
  DANG: [
    { code: "XAY_DUNG_DANG",     label: "Xây dựng Đảng" },
    { code: "KIEM_TRA_GIAM_SAT", label: "Kiểm tra – Giám sát" },
    { code: "VAN_PHONG_DANG",    label: "Văn phòng Đảng ủy" },
  ],
  HDND: [
    { code: "KINH_TE_NGAN_SACH", label: "Kinh tế – Ngân sách" },
    { code: "VAN_HOA_XA_HOI",    label: "Văn hóa – Xã hội" },
    { code: "DAN_TOC",           label: "Ban Dân tộc" },
  ],
};

const ROLE_OPTIONS = [
  { value: ROLES.CB_THON,       label: "Cán bộ thôn",       icon: "home-outline" },
  { value: ROLES.CB_CHUYEN_MON, label: "Cán bộ chuyên môn", icon: "briefcase-outline" },
  { value: ROLES.LANH_DAO,      label: "Lãnh đạo xã",       icon: "star-outline" },
];

const NHANH_OPTIONS = ["UBND", "MTTQ", "DANG", "HDND"];

export default function AdminUsersScreen() {
  const { token, user, xa_code } = useAuthStore();

  const [pendingUsers, setPendingUsers] = useState([]);
  const [thonList,     setThonList]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadError,    setLoadError]    = useState(null);

  // Approve modal
  const [approveModal, setApproveModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selRole,      setSelRole]      = useState("");
  const [selNhanh,     setSelNhanh]     = useState("");
  const [selThon,      setSelThon]      = useState("");
  const [donVi,        setDonVi]        = useState("");
  const [selLinh,      setSelLinh]      = useState([]);
  const [submitting,   setSubmitting]   = useState(false);

  // ── Load on focus (auto-refresh when returning to tab) ────
  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [xa_code])
  );

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else           setLoading(true);
    setLoadError(null);

    try {
      // Load pending users — primary call
      const pendingData = await listPendingUsers({ token, user_id: user.user_id, xa_code });
      setPendingUsers(pendingData.users || []);
    } catch (e) {
      // Show the actual error so admin can diagnose
      setLoadError(e.message || "Không tải được danh sách. Kiểm tra kết nối.");
      setPendingUsers([]);
    }

    // Load commune thon list separately — failure here is non-critical
    try {
      const configData = await getCommuneConfig({ token, user_id: user.user_id, xa_code });
      setThonList(configData.danh_sach_thon || []);
    } catch (_) {
      // ignore — thon picker will show "chưa cấu hình"
    }

    setLoading(false);
    setRefreshing(false);
  }

  // ── Open approve modal ─────────────────────────────────────
  function openApprove(u) {
    setSelectedUser(u);
    setSelRole(""); setSelNhanh(""); setSelThon(""); setDonVi(""); setSelLinh([]);
    setApproveModal(true);
  }

  function toggleLinh(code) {
    setSelLinh(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }

  // ── Submit approval ────────────────────────────────────────
  async function doApprove() {
    if (!selRole || !selNhanh) {
      Alert.alert("Thiếu thông tin", "Vui lòng chọn vai trò và nhánh");
      return;
    }
    if (selRole === ROLES.CB_THON && !selThon) {
      Alert.alert("Thiếu thông tin", "Vui lòng chọn thôn cho cán bộ thôn");
      return;
    }
    const don_vi_final = selRole === ROLES.CB_THON ? selThon : donVi.trim() || null;

    setSubmitting(true);
    try {
      const result = await approveUser({
        token, user_id: user.user_id, xa_code,
        target_user_id: selectedUser.user_id,
        vai_tro:        selRole,
        nhanh:          selNhanh,
        don_vi:         don_vi_final,
        linh_vuc_codes: selRole === ROLES.CB_CHUYEN_MON ? selLinh : [],
      });
      setApproveModal(false);
      setPendingUsers(prev => prev.filter(u => u.user_id !== selectedUser.user_id));
      Alert.alert("✅ Đã kích hoạt", result.data?.message || "Tài khoản đã được kích hoạt.");
    } catch (e) {
      Alert.alert("Lỗi phê duyệt", e.message || "Thao tác thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render user card ───────────────────────────────────────
  function renderUser({ item }) {
    return (
      <View style={s.userCard}>
        <View style={s.userRow}>
          <View style={s.avatar}>
            <Text style={s.avatarLetter}>{(item.ho_ten || "?")[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.userName}>{item.ho_ten}</Text>
            <Text style={s.userMeta}>{item.phone}  ·  CCCD: {item.cccd}</Text>
            <Text style={s.userMeta}>{item.chuc_danh}</Text>
            {item.email ? <Text style={s.userMeta}>{item.email}</Text> : null}
            <Text style={s.userDate}>
              Đăng ký: {item.created_at ? item.created_at.slice(0, 10) : "—"}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={s.approveBtn} onPress={() => openApprove(item)}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={s.approveBtnText}>Phê duyệt & Gán vai trò</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Quản lý người dùng</Text>
          <Text style={s.headerSub}>{xa_code}</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={s.loadingText}>Đang tải danh sách…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Quản lý người dùng</Text>
        <Text style={s.headerSub}>
          {xa_code}  ·  {loadError ? "⚠️ lỗi tải" : `${pendingUsers.length} chờ duyệt`}
        </Text>
      </View>

      {/* Error banner */}
      {loadError && (
        <View style={s.errorBanner}>
          <Ionicons name="warning-outline" size={18} color={COLORS.danger} />
          <Text style={s.errorText} numberOfLines={2}>{loadError}</Text>
          <TouchableOpacity onPress={() => loadData(true)} style={s.retryBtn}>
            <Text style={s.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loadError && pendingUsers.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="checkmark-circle-outline" size={64} color={COLORS.primaryPale} />
          <Text style={s.emptyTitle}>Không có yêu cầu mới</Text>
          <Text style={s.emptyBody}>Tất cả cán bộ đã được duyệt</Text>
          <TouchableOpacity onPress={() => loadData(true)} style={s.refreshBtn}>
            <Ionicons name="refresh" size={16} color={COLORS.primary} />
            <Text style={s.refreshBtnText}>Làm mới</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pendingUsers}
          keyExtractor={item => item.user_id}
          renderItem={renderUser}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={[COLORS.primary]}
            />
          }
        />
      )}

      {/* ── Approve Modal ──────────────────────────────── */}
      <Modal visible={approveModal} transparent animationType="slide">
        <View style={s.overlay}>
          <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={s.modalCard}>
              {/* Handle bar */}
              <View style={s.handleBar} />

              <Text style={s.modalTitle}>Phê duyệt tài khoản</Text>

              {selectedUser && (
                <View style={s.infoBox}>
                  <Text style={s.infoName}>{selectedUser.ho_ten}</Text>
                  <Text style={s.infoMeta}>{selectedUser.phone}  ·  {selectedUser.chuc_danh}</Text>
                  <Text style={s.infoMeta}>CCCD: {selectedUser.cccd}</Text>
                </View>
              )}

              {/* Vai trò */}
              <Text style={s.fieldLabel}>Vai trò *</Text>
              <View style={s.chipRow}>
                {ROLE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.chip, selRole === opt.value && s.chipActive]}
                    onPress={() => { setSelRole(opt.value); setSelThon(""); setDonVi(""); setSelLinh([]); }}
                  >
                    <Ionicons name={opt.icon} size={14}
                      color={selRole === opt.value ? "#fff" : COLORS.textSecondary} />
                    <Text style={[s.chipText, selRole === opt.value && { color: "#fff" }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Nhánh */}
              <Text style={s.fieldLabel}>Nhánh *</Text>
              <View style={s.chipRow}>
                {NHANH_OPTIONS.map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[s.chip, selNhanh === n && s.chipActive]}
                    onPress={() => { setSelNhanh(n); setSelLinh([]); }}
                  >
                    <Text style={[s.chipText, selNhanh === n && { color: "#fff" }]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* CB_THON: Thôn picker */}
              {selRole === ROLES.CB_THON && (
                <>
                  <Text style={s.fieldLabel}>Thôn phụ trách *</Text>
                  {thonList.length === 0 ? (
                    <View style={s.warnBox}>
                      <Ionicons name="warning-outline" size={16} color={COLORS.accent} />
                      <Text style={s.warnText}>
                        Chưa có danh sách thôn. Vào tab Cài đặt xã để thêm thôn trước.
                      </Text>
                    </View>
                  ) : (
                    <View style={s.chipRow}>
                      {thonList.map(t => (
                        <TouchableOpacity
                          key={t.thon_code}
                          style={[s.chip, selThon === t.thon_code && s.chipActive]}
                          onPress={() => setSelThon(t.thon_code)}
                        >
                          <Text style={[s.chipText, selThon === t.thon_code && { color: "#fff" }]}>
                            {t.ten_thon}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}

              {/* CB_CM: Đơn vị + Lĩnh vực */}
              {selRole === ROLES.CB_CHUYEN_MON && (
                <>
                  <Text style={s.fieldLabel}>Đơn vị / Phòng ban</Text>
                  <TextInput
                    style={s.textInput}
                    placeholder="Ví dụ: Phòng Nông nghiệp"
                    value={donVi}
                    onChangeText={setDonVi}
                    placeholderTextColor={COLORS.textHint}
                  />
                  {selNhanh ? (
                    <>
                      <Text style={s.fieldLabel}>Lĩnh vực phụ trách</Text>
                      <View style={s.chipRow}>
                        {(LINH_VUC_BY_NHANH[selNhanh] || []).map(lv => (
                          <TouchableOpacity
                            key={lv.code}
                            style={[s.chip, selLinh.includes(lv.code) && s.chipActive]}
                            onPress={() => toggleLinh(lv.code)}
                          >
                            <Text style={[s.chipText, selLinh.includes(lv.code) && { color: "#fff" }]}>
                              {lv.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  ) : (
                    <Text style={s.hint}>← Chọn nhánh để xem lĩnh vực</Text>
                  )}
                </>
              )}

              {/* LANH_DAO: Chức vụ */}
              {selRole === ROLES.LANH_DAO && (
                <>
                  <Text style={s.fieldLabel}>Chức vụ</Text>
                  <TextInput
                    style={s.textInput}
                    placeholder="Ví dụ: Chủ tịch UBND, Bí thư Đảng ủy…"
                    value={donVi}
                    onChangeText={setDonVi}
                    placeholderTextColor={COLORS.textHint}
                  />
                </>
              )}

              {/* Actions */}
              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setApproveModal(false)}
                  disabled={submitting}
                >
                  <Text style={s.cancelText}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.confirmBtn, submitting && { opacity: 0.6 }]}
                  onPress={doApprove}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.confirmText}>✓  Kích hoạt</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.background },
  header:      { backgroundColor: COLORS.primary, padding: SPACING.lg, paddingTop: SPACING.xl },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: "#fff" },
  headerSub:   { ...TYPOGRAPHY.bodyMedium, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.sm },
  loadingText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.textHint },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    backgroundColor: COLORS.dangerBg, padding: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: "#FFCDD2",
  },
  errorText:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.danger, flex: 1 },
  retryBtn:    { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
                 borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.danger },
  retryText:   { ...TYPOGRAPHY.labelMedium, color: COLORS.danger },

  list:        { padding: SPACING.md, gap: SPACING.sm },
  userCard:    { backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
                 padding: SPACING.md, gap: SPACING.sm, ...SHADOW.card },
  userRow:     { flexDirection: "row", gap: SPACING.md },
  avatar:      { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primaryPale,
                 justifyContent: "center", alignItems: "center", flexShrink: 0 },
  avatarLetter:{ ...TYPOGRAPHY.titleMedium, color: COLORS.primary },
  userName:    { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  userMeta:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  userDate:    { ...TYPOGRAPHY.caption, color: COLORS.textHint, marginTop: 2 },
  approveBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center",
                 backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
                 height: TOUCH_TARGET - 8, gap: SPACING.xs },
  approveBtnText: { ...TYPOGRAPHY.labelLarge, color: "#fff" },

  emptyState:  { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  emptyTitle:  { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  emptyBody:   { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  refreshBtn:  { flexDirection: "row", alignItems: "center", gap: SPACING.xs,
                 paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
                 borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.primary,
                 marginTop: SPACING.sm },
  refreshBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.primary },

  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalScroll: { maxHeight: "94%" },
  modalCard:   { backgroundColor: COLORS.white, borderTopLeftRadius: RADIUS.xl,
                 borderTopRightRadius: RADIUS.xl, padding: SPACING.xl,
                 paddingBottom: 40, gap: SPACING.md },
  handleBar:   { width: 40, height: 4, backgroundColor: "#E0E0E0",
                 borderRadius: 2, alignSelf: "center", marginBottom: SPACING.xs },
  modalTitle:  { ...TYPOGRAPHY.titleLarge, color: COLORS.textPrimary },
  infoBox:     { backgroundColor: COLORS.background, borderRadius: RADIUS.md,
                 padding: SPACING.md, gap: 4 },
  infoName:    { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary },
  infoMeta:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.textSecondary },
  fieldLabel:  { ...TYPOGRAPHY.labelLarge, color: COLORS.textPrimary, marginTop: SPACING.xs },
  hint:        { ...TYPOGRAPHY.caption, color: COLORS.textHint },
  chipRow:     { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  chip:        { flexDirection: "row", alignItems: "center", gap: 4,
                 paddingHorizontal: SPACING.md, paddingVertical: 10,
                 borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
                 backgroundColor: COLORS.white },
  chipActive:  { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:    { ...TYPOGRAPHY.labelMedium, color: COLORS.textSecondary },
  textInput:   { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
                 padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.textPrimary,
                 height: TOUCH_TARGET },
  warnBox:     { flexDirection: "row", alignItems: "flex-start", gap: SPACING.xs,
                 backgroundColor: "#FFF3E0", borderRadius: RADIUS.md, padding: SPACING.md },
  warnText:    { ...TYPOGRAPHY.bodyMedium, color: COLORS.accent, flex: 1 },
  modalActions:{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.sm },
  cancelBtn:   { flex: 1, height: TOUCH_TARGET, justifyContent: "center",
                 alignItems: "center", borderRadius: RADIUS.md,
                 borderWidth: 1.5, borderColor: COLORS.border },
  cancelText:  { ...TYPOGRAPHY.labelLarge, color: COLORS.textSecondary },
  confirmBtn:  { flex: 2, height: TOUCH_TARGET, justifyContent: "center",
                 alignItems: "center", borderRadius: RADIUS.md,
                 backgroundColor: COLORS.primary },
  confirmText: { ...TYPOGRAPHY.labelLarge, color: "#fff" },
});
