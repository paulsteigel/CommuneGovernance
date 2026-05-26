// components/OfflineBanner.jsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, TYPOGRAPHY, SPACING } from "../constants/theme";

export default function OfflineBanner() {
  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={18} color={COLORS.white} />
      <Text style={styles.text}>Không có mạng — Dữ liệu sẽ gửi khi có kết nối</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.accent,
    flexDirection:   "row",
    alignItems:      "center",
    paddingHorizontal: SPACING.md,
    paddingVertical:   SPACING.sm,
    gap:             SPACING.sm,
  },
  text: {
    ...TYPOGRAPHY.labelMedium,
    color:      COLORS.white,
    flex:       1,
  },
});
