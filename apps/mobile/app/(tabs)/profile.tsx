import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS } from '@kite/shared';
import { Button, Card, Input, Muted } from '@/components/ui';
import { errorMessage, rebuildClient } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { useCatalog, useFreshness } from '@/lib/data';
import { session } from '@/lib/session';
import { colors, space } from '@/lib/theme';

export default function Profile() {
  const { user, signOut, changePassword, maxDiscountBps } = useAuth();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const fresh = useFreshness(catalog.data?.generatedAt);
  const cartItems = useCart((c) => c.lines.length);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [server, setServer] = useState(session.server());
  const [busy, setBusy] = useState(false);

  const confirmSignOut = () =>
    Alert.alert('Sign out?', cartItems ? 'Your unfinished bill stays on this phone and will be there when you sign in again.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{user?.fullName}</Text>
        <Muted>
          @{user?.username} · {user ? ROLE_LABELS[user.role] : ''}
        </Muted>
        {maxDiscountBps !== null && <Muted>Your discount limit: {maxDiscountBps / 100}% (more needs manager approval)</Muted>}
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>Catalog</Text>
        <Muted>Last synced {fresh}. Prices and stock refresh automatically when online.</Muted>
        <Button title="Refresh now" variant="secondary" icon="refresh" onPress={() => catalog.refetch()} loading={catalog.isFetching} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>Change password</Text>
        <Input placeholder="Current password" secureTextEntry value={pw.current} onChangeText={(t) => setPw({ ...pw, current: t })} />
        <Input placeholder="New password (10+ characters, letters & digits)" secureTextEntry value={pw.next} onChangeText={(t) => setPw({ ...pw, next: t })} />
        <Button
          title="Update password"
          variant="secondary"
          loading={busy}
          disabled={!pw.current || pw.next.length < 10}
          onPress={async () => {
            setBusy(true);
            try {
              await changePassword(pw.current, pw.next);
              setPw({ current: '', next: '' });
              Alert.alert('Password changed', 'Other devices have been signed out.');
            } catch (e) {
              Alert.alert('Could not change password', errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>

      {__DEV__ && (
        <Card style={{ gap: space.md }}>
          <Text style={{ fontWeight: '700', fontSize: 16 }}>Server (development builds only)</Text>
          <Input value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.20:4000/api/v1" />
          <Button
            title="Save server"
            variant="secondary"
            onPress={async () => {
              await session.setServer(server.trim() || null);
              rebuildClient();
              qc.clear();
              Alert.alert('Server updated', session.server());
            }}
          />
        </Card>
      )}

      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={confirmSignOut} />
      <View style={{ alignItems: 'center' }}>
        <Muted>Kite POS v{Constants.expoConfig?.version ?? '1.0.0'}</Muted>
      </View>
    </ScrollView>
  );
}
