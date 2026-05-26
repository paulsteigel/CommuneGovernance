// store/authStore.js
// Global auth state — token, user info, manifest.
// Token lưu trong SecureStore (encrypted on device).
// User info + manifest lưu trong AsyncStorage (JSON, không sensitive).

import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS, CURRENT_YEAR } from "../constants/config";

// ─── Persistence helpers ───────────────────────────────────────

async function saveAuth({ token, user, xa_code, year, manifest }) {
  await SecureStore.setItemAsync(STORAGE_KEYS.TOKEN, token);
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.USER,     JSON.stringify(user)],
    [STORAGE_KEYS.XA_CODE,  xa_code],
    [STORAGE_KEYS.YEAR,     String(year)],
    [STORAGE_KEYS.MANIFEST, JSON.stringify(manifest)],
  ]);
}

async function clearAuth() {
  await SecureStore.deleteItemAsync(STORAGE_KEYS.TOKEN);
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.USER,
    STORAGE_KEYS.XA_CODE,
    STORAGE_KEYS.YEAR,
    STORAGE_KEYS.MANIFEST,
  ]);
}

async function loadAuth() {
  try {
    const token = await SecureStore.getItemAsync(STORAGE_KEYS.TOKEN);
    if (!token) return null;

    const [[, userStr], [, xa_code], [, yearStr], [, manifestStr]] =
      await AsyncStorage.multiGet([
        STORAGE_KEYS.USER,
        STORAGE_KEYS.XA_CODE,
        STORAGE_KEYS.YEAR,
        STORAGE_KEYS.MANIFEST,
      ]);

    if (!userStr || !xa_code) return null;

    return {
      token,
      user:     JSON.parse(userStr),
      xa_code,
      year:     Number(yearStr) || CURRENT_YEAR,
      manifest: manifestStr ? JSON.parse(manifestStr) : null,
    };
  } catch {
    return null;
  }
}

// ─── Offline queue helpers ─────────────────────────────────────

async function getOfflineQueue() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveOfflineQueue(queue) {
  await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
}

// ─── Store ─────────────────────────────────────────────────────

export const useAuthStore = create((set, get) => ({
  // State
  token:       null,
  user:        null,
  xa_code:     null,
  year:        CURRENT_YEAR,
  manifest:    null,
  isLoading:   true,   // true khi đang check stored auth
  isLoggedIn:  false,
  offlineQueue: [],

  // ── Hydrate từ storage khi app khởi động ──────────────────
  hydrate: async () => {
    set({ isLoading: true });
    try {
      const saved = await loadAuth();
      const queue = await getOfflineQueue();
      if (saved) {
        set({
          ...saved,
          isLoggedIn:   true,
          offlineQueue: queue,
        });
      }
    } catch (e) {
      console.warn("Auth hydration error:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  // ── Sau khi login thành công ──────────────────────────────
  setAuth: async ({ token, user, xa_code, year, manifest }) => {
    await saveAuth({ token, user, xa_code, year, manifest });
    set({ token, user, xa_code, year, manifest, isLoggedIn: true });
  },

  // ── Cập nhật manifest (sau pull_manifest) ────────────────
  updateManifest: async (manifest) => {
    await AsyncStorage.setItem(STORAGE_KEYS.MANIFEST, JSON.stringify(manifest));
    set({ manifest });
  },

  // ── Logout ────────────────────────────────────────────────
  clearAuth: async () => {
    await clearAuth();
    set({
      token: null, user: null, xa_code: null,
      manifest: null, isLoggedIn: false,
    });
  },

  // ── Offline queue ─────────────────────────────────────────
  addToOfflineQueue: async (submission) => {
    const queue = [...get().offlineQueue, { ...submission, queued_at: new Date().toISOString() }];
    await saveOfflineQueue(queue);
    set({ offlineQueue: queue });
  },

  removeFromOfflineQueue: async (index) => {
    const queue = get().offlineQueue.filter((_, i) => i !== index);
    await saveOfflineQueue(queue);
    set({ offlineQueue: queue });
  },

  clearOfflineQueue: async () => {
    await saveOfflineQueue([]);
    set({ offlineQueue: [] });
  },

  // ── Getters ───────────────────────────────────────────────
  get authParams() {
    const s = get();
    return { token: s.token, user_id: s.user?.user_id, xa_code: s.xa_code, year: s.year };
  },
}));
