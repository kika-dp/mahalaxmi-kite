import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatIstDate } from '@kite/shared';
import { Empty, money, Muted, PressableRow, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, space } from '@/lib/theme';

/** Bills I created that still have money to collect (oldest first). */
export default function Outstanding() {
  const q = useQuery({ queryKey: ['my-bills', 'outstanding'], queryFn: () => api.me.outstanding({ pageSize: 200 }) });
  const total = (q.data?.data ?? []).reduce((s, b) => s + b.outstandingPaise, 0);
  return (
    <FlatList
      data={q.data?.data ?? []}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      ListHeaderComponent={
        <View style={{ padding: space.lg, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.ink200 }}>
          <Muted>Total to collect</Muted>
          <Text style={{ fontSize: 30, fontWeight: '800', color: total ? colors.red : colors.green, fontVariant: ['tabular-nums'] }}>{money(total)}</Text>
        </View>
      }
      ListEmptyComponent={q.isLoading ? undefined : <Empty icon="checkmark-done-circle-outline" title="Nothing to collect" subtitle="All your bills are fully paid." />}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.ink100 }} />}
      renderItem={({ item: b }) => {
        const days = Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86_400_000);
        return (
          <PressableRow onPress={() => router.push(`/bill/${b.id}`)} style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md, backgroundColor: colors.white }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{b.customerName}</Text>
              <Muted>
                {b.customerPhone ?? 'no mobile'} · {b.invoiceNumber} · {formatIstDate(b.createdAt)}
                {days > 0 ? ` (${days}d)` : ''}
              </Muted>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.red, fontVariant: ['tabular-nums'] }}>{money(b.outstandingPaise, true)}</Text>
              <StatusBadge status={b.paymentStatus} />
            </View>
          </PressableRow>
        );
      }}
    />
  );
}
