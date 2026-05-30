// app/(admin)/_layout.jsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/theme";

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   COLORS.primary,
        tabBarInactiveTintColor: "#9E9E9E",
        tabBarHideOnKeyboard:    true,
        tabBarStyle: {
          borderTopWidth:  0.5,
          borderTopColor:  "#E0E0E0",
          elevation:       0,
          shadowOpacity:   0,
          backgroundColor: "#FFFFFF",
        },
        tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Người dùng",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="invite"
        options={{
          title: "Mời cán bộ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="link-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
