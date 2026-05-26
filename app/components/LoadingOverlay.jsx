// components/LoadingOverlay.jsx
import React from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { COLORS, TYPOGRAPHY, SPACING } from "../constants/theme";

export default function LoadingOverlay({ message = "Đang tải..." }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.box}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent:  "center",
    alignItems:      "center",
    zIndex:          999,
  },
  box: {
    backgroundColor: COLORS.white,
    borderRadius:    16,
    padding:         SPACING.xl,
    alignItems:      "center",
    gap:             SPACING.md,
    minWidth:        160,
  },
  text: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.textPrimary,
    textAlign: "center",
  },
});
