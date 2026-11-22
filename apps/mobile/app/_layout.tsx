import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ApiError } from '@kite/api-client';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      staleTime: 15_000,
    },
    mutations: { retry: false },
  },
});

/** Only the catalog and home summary are cached on disk (no customer data is persisted). */
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'kite.query-cache.v1', throttleTime: 2000 });

function RootNavigator() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);
  if (status === 'loading') return null;
  return (
    <Stack screenOptions={{ headerTintColor: colors.night, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: colors.bg }, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Protected guard={status === 'signed-in'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bill/new" options={{ title: 'New bill' }} />
        <Stack.Screen name="bill/discount" options={{ title: 'Discount', presentation: 'modal' }} />
        <Stack.Screen name="bill/checkout" options={{ title: 'Payment' }} />
        <Stack.Screen name="bill/success" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="bill/[id]" options={{ title: 'Bill' }} />
        <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice', presentation: 'modal' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan barcode', presentation: 'fullScreenModal', headerShown: false }} />
        <Stack.Screen name="catalog" options={{ title: 'Products & stock' }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'must-change-password'}>
        <Stack.Screen name="change-password" options={{ title: 'Set your password', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signed-out'}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 7 * 24 * 3600_000,
          dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && ['pos-catalog', 'me-summary', 'settings'].includes(String(q.queryKey[0])) },
        }}
      >
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
