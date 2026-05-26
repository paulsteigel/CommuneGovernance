// app/(cb-cm)/_layout.jsx
import { Stack } from "expo-router";
import { COLORS } from "../../constants/theme";

export default function CbCmLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: COLORS.primaryLight },
        headerTintColor:  COLORS.white,
        headerTitleStyle: { fontSize: 18, fontWeight: "700" },
      }}
    />
  );
}
