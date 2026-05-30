// app/_layout.jsx
// Root layout — kiểm tra auth, redirect sang đúng role.

import React, { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { PaperProvider, MD3LightTheme } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuthStore } from "../store/authStore";
import { COLORS } from "../constants/theme";
import { ROLES } from "../constants/config";

// Paper theme override
const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary:   COLORS.primary,
    secondary: COLORS.accent,
  },
};

// ─── Auth guard + role redirect ────────────────────────────────

function AuthGuard({ children }) {
  const { isLoggedIn, isLoading, user } = useAuthStore();
  const segments = useSegments();
  const router   = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === "(auth)";

    if (!isLoggedIn) {
      if (!inAuth) router.replace("/(auth)/login");
      return;
    }

    // Redirect to correct role area
    if (inAuth) {
      const role = user?.vai_tro;
      if (role === ROLES.CB_THON) {
        router.replace("/(cb-thon)/");
      } else if (role === ROLES.CB_CHUYEN_MON) {
        router.replace("/(cb-cm)/");
      } else if (role === ROLES.LANH_DAO) {
        router.replace("/(lanh-dao)/");
      } else if (role === ROLES.ADMIN) {
        router.replace("/(admin)/");
      } else {
        router.replace("/(auth)/login");
      }
    }
  }, [isLoggedIn, isLoading, segments, user]);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return children;
}

// ─── Root Layout ───────────────────────────────────────────────

export default function RootLayout() {
  const hydrate = useAuthStore(s => s.hydrate);

  useEffect(() => {
    hydrate();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar style="light" backgroundColor={COLORS.primary} />
        <AuthGuard>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)"      options={{ headerShown: false }} />
            <Stack.Screen name="(cb-thon)"   options={{ headerShown: false }} />
            <Stack.Screen name="(cb-cm)"     options={{ headerShown: false }} />
            <Stack.Screen name="(lanh-dao)"  options={{ headerShown: false }} />
            <Stack.Screen name="(admin)"     options={{ headerShown: false }} />
          </Stack>
        </AuthGuard>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex:            1,
    justifyContent:  "center",
    alignItems:      "center",
    backgroundColor: COLORS.primaryPale,
  },
});
