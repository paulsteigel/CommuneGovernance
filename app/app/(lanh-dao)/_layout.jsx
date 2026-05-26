// app/(lanh-dao)/_layout.jsx
import { Stack } from "expo-router";
import { COLORS } from "../../constants/theme";

export default function LanhDaoLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: COLORS.primary },
        headerTintColor:  COLORS.white,
        headerTitleStyle: { fontSize: 18, fontWeight: "700" },
      }}
    />
  );
}
