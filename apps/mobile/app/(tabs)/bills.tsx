import { useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { addDays, formatIstDateTime, istDateString } from '@kite/shared';
import { Chip, Empty, Money, Muted, PressableRow, Row, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

type Range = 'today' | 'yesterday' | 'week' | 'all';

export default function MyBills() {
  const [range, setRange] = useState<Range>('today');
  const [q, setQ] = useState('');
  const today = istDateString();
  const dates =
    range === 'today' ? { from: today, to: today } : range === 'yesterday' ? { from: addDays(today, -1), to: addDays(today, -1) } : range === 'week' ? { from: addDays(today, -6), to: today } : {};
  const list = useInfiniteQuery({
    queryKey: ['my-bills', range, q],
    queryFn: ({ pageParam }) => api.invoices.list({ mine: true, ...dates, q: q || undefined, page: pageParam, pageSize: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.pageSize < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const totals = list.data?.pages[0]?.meta.totals as { totalPaise: number } | undefined;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, gap: space.md, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.ink200 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: space.md, height: 46 }}>
          <Ionicons name="search" size={18} color={colors.ink400} />
          <TextInput value={q} onChangeText={setQ} placeholder="Bill no., name or mobile" style={{ flex: 1, fontSize: 16 }} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search bills" />
        </View>
        <Row>
          {(['today', 'yesterday', 'week', 'all'] as Range[]).map((r) => (
            <Chip key={r} label={{ today: 'Today', yesterday: 'Yesterday', week: '7 days', all: 'All' }[r]} active={range === r} tone="dark" onPress={() => setRange(r)} />
          ))}
        </Row>
        {totals && (
          <Muted>
            {list.data?.pages[0].meta.total} bills · <Text style={{ fontWeight: '700', color: colors.ink }}>{(totals.totalPaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</Text>
          </Muted>
        )}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        onEndReached={() => list.hasNextPage && list.fetchNextPage()}
        ListEmptyComponent={list.isLoading ? undefined : <Empty icon="receipt-outline" title="No bills" subtitle="Bills you create appear here." />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.ink100 }} />}
        renderItem={({ item: b }) => (
          <PressableRow onPress={() => router.push(`/bill/${b.id}`)} style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md, backgroundColor: colors.white }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{b.invoiceNumber}</Text>
              <Muted>
                {formatIstDateTime(b.createdAt)} · {b.customerName ?? 'Walk-in'} · {b.itemCount} items
              </Muted>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Money paise={b.totalPaise} style={{ fontSize: 17, fontWeight: '800' }} />
              <StatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
            </View>
          </PressableRow>
        )}
      />
    </View>
  );
}
