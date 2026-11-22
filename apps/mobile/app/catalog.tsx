import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UNIT_LABELS } from '@kite/shared';
import { Badge, money, Muted } from '@/components/ui';
import { useCatalog, useFreshness } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

/** Product catalog & search: prices and last-synced stock. */
export default function Catalog() {
  const catalog = useCatalog();
  const fresh = useFreshness(catalog.data?.generatedAt);
  const [q, setQ] = useState('');
  const cats = useMemo(() => new Map((catalog.data?.categories ?? []).map((c) => [c.id, c.name])), [catalog.data]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = catalog.data?.products ?? [];
    return t ? all.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)) : all;
  }, [catalog.data, q]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: space.md, height: 50 }}>
          <Ionicons name="search" size={20} color={colors.ink400} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search name or SKU" style={{ flex: 1, fontSize: 17 }} autoFocus autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel="Search products" />
        </View>
        <Muted>Stock as of {fresh} · pull down to refresh</Muted>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={catalog.isRefetching} onRefresh={catalog.refetch} />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.ink100 }} />}
        renderItem={({ item: p }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{p.name}</Text>
              <Muted>
                {p.sku} · {cats.get(p.categoryId)} · per {UNIT_LABELS[p.unitType]}
              </Muted>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{money(p.sellingPricePaise, true)}</Text>
              <Badge label={p.availableQuantity <= 0 ? 'Out' : `${p.availableQuantity} left`} tone={p.availableQuantity <= 0 ? 'red' : p.availableQuantity < 10 ? 'amber' : 'green'} />
            </View>
          </View>
        )}
      />
    </View>
  );
}
