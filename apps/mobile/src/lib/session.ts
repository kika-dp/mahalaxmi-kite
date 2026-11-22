import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tokens live in the iOS Keychain (expo-secure-store). The access token is also cached in memory.
 * The API base URL can be overridden in development builds (Profile → Server).
 */
const REFRESH_KEY = 'kite.refreshToken';
const SERVER_KEY = 'kite.serverUrl';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let persisted = false;
let serverUrl: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const session = {
  async load(): Promise<void> {
    refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    persisted = !!refreshToken;
    if (__DEV__) {
      const s = await AsyncStorage.getItem(SERVER_KEY).catch(() => null);
      if (s) serverUrl = s;
    }
  },
  access: () => accessToken,
  refresh: () => refreshToken,
  server: () => serverUrl,
  async setServer(url: string | null): Promise<void> {
    serverUrl = url || (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1');
    if (url) await AsyncStorage.setItem(SERVER_KEY, url);
    else await AsyncStorage.removeItem(SERVER_KEY);
  },
  /**
   * Store a token pair. `persist` ("keep me signed in") writes the refresh token to the Keychain;
   * otherwise it stays in memory only and the user signs in again after the app is closed.
   * When omitted, the current persistence choice is kept (used by token rotation).
   */
  async setTokens(access: string | null, refresh: string | null, persist: boolean = persisted): Promise<void> {
    accessToken = access;
    refreshToken = refresh;
    persisted = persist && !!refresh;
    if (persisted) await SecureStore.setItemAsync(REFRESH_KEY, refresh!, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
  async clear(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    persisted = false;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
