import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatIstTime } from '@kite/shared';
import { Button, Card, Money, Muted, NetworkBanner, PressableRow, StatusBadge, money } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { useCatalog, useFreshness, useOnline } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

export default function Home() {
  const { user } = useAuth();
  const online = useOnline();
  const lines = useCart((c) => c.lines);
  const catalog = useCatalog();
  const fresh = useFreshness(catalog.data?.generatedAt);
  const summary = useQuery({ queryKey: ['me-summary'], queryFn: () => api.me.summary(), refetchInterval: 60_000 });
  const recent = useQuery({ queryKey: ['my-bills', 'recent'], queryFn: () => api.invoices.list({ mine: true, pageSize: 5 }) });
  const s = summary.data;
  const items = lines.reduce((n, l) => n + l.quantity, 0);
  const hour = new Date().getHours();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.night }}>
        <View style={st.header}>
          <View>
            <Text style={st.greet}>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'},</Text>
            <Text style={st.name}>{user?.fullName}</Text>
          </View>
          <View style={[st.pill, { backgroundColor: online ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.25)' }]}>
            <View style={[st.dot, { backgroundColor: online ? '#4ADE80' : '#F87171' }]} />
            <Text style={st.pillText}>{online ? `Online · catalog ${fresh}` : 'Offline'}</Text>
          </View>
        </View>
      </SafeAreaView>
      <NetworkBanner />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={() => (summary.refetch(), recent.refetch(), catalog.refetch())} />}
      >
        <View style={st.grid}>
          <Stat label="Bills today" value={s ? String(s.billsCount) : '—'} icon="receipt-outline" />
          <Stat label="My sales today" value={money(s?.salesPaise, true)} icon="trending-up-outline" />
          <Stat label="Collected today" value={money(s?.collectedPaise, true)} icon="cash-outline" tone={colors.green} />
          <Stat label="My dues" value={money(s?.outstandingPaise, true)} icon="time-outline" tone={s?.outstandingPaise ? colors.red : undefined} sub={s?.outstandingCount ? `${s.outstandingCount} bills` : undefined} onPress={() => router.push('/outstanding')} />
        </View>

        {items > 0 ? (
          <Card style={{ gap: space.md, borderColor: colors.brand, backgroundColor: colors.brandSoft }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
              Unfinished bill · {items} item{items === 1 ? '' : 's'}
            </Text>
            <Button title="Resume bill" icon="arrow-forward" size="xl" onPress={() => router.push('/bill/new')} />
          </Card>
        ) : (
          <Button title="New Bill" icon="add-circle" size="xl" onPress={() => router.push('/bill/new')} />
        )}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button title="Scan" icon="barcode-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/scan')} />
          <Button title="Products" icon="search" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/catalog')} />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>Recent bills</Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {recent.data?.data.length ? (
              recent.data.data.map((b, i) => (
                <PressableRow key={b.id} onPress={() => router.push(`/bill/${b.id}`)} style={[st.billRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.ink100 }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: '600', color: colors.ink, fontSize: 15 }}>{b.invoiceNumber}</Text>
                    <Muted>
                      {formatIstTime(b.createdAt)} · {b.customerName ?? 'Walk-in'}
                    </Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Money paise={b.totalPaise} style={{ fontWeight: '700', fontSize: 16 }} />
                    <StatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
                  </View>
                </PressableRow>
              ))
            ) : (
              <Muted style={{ padding: space.lg }}>No bills yet today.</Muted>
            )}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, icon, tone, sub, onPress }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; tone?: string; sub?: string; onPress?: () => void }) {
  return (
    <PressableRow onPress={onPress} disabled={!onPress} style={st.stat}>
      <Ionicons name={icon} size={20} color={tone ?? colors.brand} />
      <Text style={[st.statValue, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Muted>
        {label}
        {sub ? ` · ${sub}` : ''}
      </Muted>
    </PressableRow>
  );
}

const st = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md },
  greet: { color: 'rgba(255,255,255,0.65)', fontSize: 15 },
  name: { color: colors.white, fontSize: 26, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.ink200, padding: space.lg, gap: 4 },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  billRow: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md },
});
