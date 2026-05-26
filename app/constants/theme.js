// constants/theme.js
// Thiết kế cho cán bộ vùng dân tộc thiểu số:
// - Màu sắc tương phản cao, dễ nhìn ngoài trời
// - Font lớn, rõ ràng
// - Touch target tối thiểu 56px

export const COLORS = {
  // Primary — xanh lá đậm (màu thiên nhiên, gần gũi vùng nông thôn)
  primary:        "#1B5E20",
  primaryLight:   "#2E7D32",
  primaryPale:    "#E8F5E9",

  // Accent — vàng đất (nhấn mạnh action quan trọng)
  accent:         "#E65100",
  accentLight:    "#FF8F00",

  // Status colors
  verified:       "#1B5E20",
  verifiedBg:     "#E8F5E9",
  pending:        "#E65100",
  pendingBg:      "#FFF3E0",
  needsReview:    "#B71C1C",
  needsReviewBg:  "#FFEBEE",
  inReview:       "#1565C0",
  inReviewBg:     "#E3F2FD",

  // Neutrals
  white:          "#FFFFFF",
  background:     "#F5F5F5",
  card:           "#FFFFFF",
  border:         "#E0E0E0",
  divider:        "#EEEEEE",

  // Text
  textPrimary:    "#212121",
  textSecondary:  "#616161",
  textHint:       "#9E9E9E",
  textOnPrimary:  "#FFFFFF",

  // Danger
  danger:         "#C62828",
  dangerBg:       "#FFEBEE",
};

export const TYPOGRAPHY = {
  // Tối thiểu 16px cho vùng DTTS — mắt thường, ánh sáng yếu
  displayLarge:  { fontSize: 28, fontWeight: "700", lineHeight: 36 },
  displayMedium: { fontSize: 24, fontWeight: "700", lineHeight: 32 },
  titleLarge:    { fontSize: 20, fontWeight: "700", lineHeight: 28 },
  titleMedium:   { fontSize: 18, fontWeight: "600", lineHeight: 26 },
  bodyLarge:     { fontSize: 17, fontWeight: "400", lineHeight: 26 },
  bodyMedium:    { fontSize: 16, fontWeight: "400", lineHeight: 24 },
  labelLarge:    { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  labelMedium:   { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  caption:       { fontSize: 13, fontWeight: "400", lineHeight: 18 },
};

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

export const RADIUS = {
  sm:  6,
  md:  12,
  lg:  16,
  xl:  24,
  full: 999,
};

// Touch target tối thiểu 56px (WCAG AA cho mobile)
export const TOUCH_TARGET = 56;

export const SHADOW = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  elevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
};
