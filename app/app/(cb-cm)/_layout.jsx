// app/(cb-cm)/_layout.jsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/theme";

export default function CbCmLayout() {
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
            <Ionicons name="clipboard-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="indicators"
        options={{
          title: "Chỉ số",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
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
        Hidden screens — must use the EXACT route segment name.
        "verify/[subId]" targets app/(cb-cm)/verify/[subId].jsx
        "indicator-create" targets app/(cb-cm)/indicator-create.jsx
        tabBarButton: () => null removes the button completely from the tab bar.
        href: null prevents it from being a tappable tab link.
      */}
      <Tabs.Screen
        name="verify/[subId]"
        options={{
          href: null,
          tabBarButton: () => null,
        }}
      />
      <Tabs.Screen
        name="indicator-create"
        options={{
          href: null,
          tabBarButton: () => null,
        }}
      />
    </Tabs>
  );
}