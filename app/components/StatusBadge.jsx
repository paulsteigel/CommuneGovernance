// components/StatusBadge.jsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from "../constants/theme";
import { STATUS_LABELS, REQUEST_STATUS_LABELS } from "../constants/config";

const STATUS_STYLES = {
  VERIFIED:       { bg: COLORS.verifiedBg,    text: COLORS.verified },
  PENDING_VERIFY: { bg: COLORS.pendingBg,     text: COLORS.accent },
  NEEDS_REVISION: { bg: COLORS.needsReviewBg, text: COLORS.needsReview },
  IN_REVIEW:      { bg: COLORS.inReviewBg,    text: COLORS.inReview },
  REJECTED:       { bg: COLORS.needsReviewBg, text: COLORS.needsReview },
  // Request status
  OPEN:           { bg: COLORS.verifiedBg,    text: COLORS.primary },
  IN_PROGRESS:    { bg: COLORS.inReviewBg,    text: COLORS.inReview },
  COMPLETED:      { bg: COLORS.verifiedBg,    text: COLORS.verified },
  CANCELLED:      { bg: COLORS.divider,       text: COLORS.textSecondary },
};

export default function StatusBadge({ status, size = "medium" }) {
  const style  = STATUS_STYLES[status] || { bg: COLORS.divider, text: COLORS.textSecondary };
  const label  = STATUS_LABELS[status] || REQUEST_STATUS_LABELS[status] || status;
  const isSmall = size === "small";

  return (
    <View style={[
      styles.badge,
      { backgroundColor: style.bg },
      isSmall && styles.small,
    ]}>
      <Text style={[
        styles.label,
        { color: style.text },
        isSmall && styles.labelSmall,
      ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical:   SPACING.xs,
    borderRadius:      RADIUS.full,
    alignSelf:         "flex-start",
  },
  small: {
    paddingHorizontal: SPACING.sm,
    paddingVertical:   2,
  },
  label: {
    ...TYPOGRAPHY.labelMedium,
  },
  labelSmall: {
    fontSize:   12,
    fontWeight: "600",
  },
});
