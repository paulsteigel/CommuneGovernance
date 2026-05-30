// app/(lanh-dao)/_layout.jsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/theme";

export default function LanhDaoLayout() {
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
          title: "Nghiệp vụ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="indicators"
        options={{
          title: "Chỉ số",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "Số liệu",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />
      {/*
        Hidden screen — href: null ẩn khỏi tab bar.
        KHÔNG dùng tabBarButton: () => null — react-navigation 7 crash khi nhận null.
      */}
      <Tabs.Screen
        name="verify/[subId]"
        options={{ href: null }}
      />
    </Tabs>
  );
}