// app/(cb-thon)/_layout.jsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/theme";

export default function CbThonLayout() {
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
          title: "Yêu cầu",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color} />
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
        Hidden screen — "submit/[reqId]" targets app/(cb-thon)/submit/[reqId].jsx
        tabBarButton: () => null removes the button completely from the tab bar.
      */}
      <Tabs.Screen
        name="submit/[reqId]"
        options={{
          href: null,
          tabBarButton: () => null,
        }}
      />
    </Tabs>
  );
}