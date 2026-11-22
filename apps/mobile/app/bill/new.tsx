import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PosCatalogItem } from '@kite/shared';
import { Button, Chip, money, Muted, NetworkBanner, QtyStepper, tap } from '@/components/ui';
import { useCart, cartLogic } from '@/lib/cart';
import { useCatalog, useFreshness } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

const FAV = '__fav__';
const ALL = '__all__';

export default function NewBill() {
  const catalog = useCatalog({ live: true });
  const fresh = useFreshness(catalog.data?.generatedAt);
  const cart = useCart();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>(FAV);
  const [expanded, setExpanded] = useState(true);

  // Every time the screen gains focus: refresh catalog, reconcile prices/stock in the cart.
  useFocusEffect(
    useCallback(() => {
      catalog.refetch().then((r) => {
        if (!r.data) return;
        const changed = useCart.getState().applyCatalog(new Map(r.data.products.map((p) => [p.id, p])));
        if (changed.length) Alert.alert('Prices updated', `New prices applied for: ${changed.join(', ')}`);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const products = useMemo(() => {
    const all = catalog.data?.products ?? [];
    const term = q.trim().toLowerCase();
    if (term) return all.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode === q.trim());
    if (cat === FAV) {
      const favs = all.filter((p) => p.isFavorite).sort((a, b) => a.favoriteOrder - b.favoriteOrder);
      return favs.length ? favs : all;
    }
    if (cat === ALL) return all;
    return all.filter((p) => p.categoryId === cat);
  }, [catalog.data, q, cat]);

  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
    return m;
  }, [cart.lines]);

  const add = (p: PosCatalogItem, qty = 1) => {
    tap();
    cart.add({ productId: p.id, name: p.name, sku: p.sku, unitPricePaise: p.sellingPricePaise, availableQuantity: p.availableQuantity }, qty);
  };

  const askQty = (p: PosCatalogItem) =>
    Alert.prompt(`Quantity · ${p.name}`, `${p.availableQuantity} in stock`, (v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) add(p, n);
    }, 'plain-text', '', 'number-pad');

  const pv = cartLogic.preview(cart);
  const count = cartLogic.itemCount(cart);
  const warnings = cartLogic.stockWarnings(cart);

  const clear = () =>
    Alert.alert('Clear this bill?', 'All items will be removed.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => cart.reset() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () =>
            cart.lines.length ? (
              <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Clear bill">
                <Text style={{ color: colors.red, fontWeight: '600', fontSize: 16 }}>Clear</Text>
              </Pressable>
            ) : null,
        }}
      />
      <NetworkBanner />
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={20} color={colors.ink400} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search name or SKU" placeholderTextColor={colors.ink400} style={s.searchInput} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel="Search products" />
        </View>
        <Pressable style={s.scanBtn} onPress={() => router.push('/scan')} accessibilityLabel="Scan barcode">
          <Ionicons name="barcode-outline" size={26} color={colors.white} />
        </Pressable>
      </View>
      {!q && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={{ flexGrow: 0 }}>
          <Chip label="★ Quick sell" active={cat === FAV} onPress={() => setCat(FAV)} />
          <Chip label="All" active={cat === ALL} onPress={() => setCat(ALL)} />
          {catalog.data?.categories.map((c) => (
            <Chip key={c.id} label={c.name} active={cat === c.id} onPress={() => setCat(c.id)} />
          ))}
        </ScrollView>
      )}
      <Muted style={{ paddingHorizontal: space.lg, paddingBottom: 4 }}>Stock as of {fresh} · checked again at checkout</Muted>

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={3}
        contentContainerStyle={{ padding: space.md, paddingBottom: 12 }}
        columnWrapperStyle={{ gap: space.sm }}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Muted style={{ textAlign: 'center', padding: space.xl }}>{catalog.isLoading ? 'Loading products…' : 'No products found'}</Muted>}
        renderItem={({ item: p }) => {
          const n = inCart.get(p.id) ?? 0;
          const out = p.availableQuantity <= 0;
          return (
            <Pressable
              onPress={() => add(p)}
              onLongPress={() => askQty(p)}
              delayLongPress={350}
              accessibilityLabel={`${p.name}, ${money(p.sellingPricePaise, true)}, ${p.availableQuantity} in stock${n ? `, ${n} in bill` : ''}`}
              accessibilityHint="Tap to add one. Long press to enter a quantity."
              style={({ pressed }) => [s.tile, n > 0 && s.tileActive, out && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.97 }] }]}
            >
              {n > 0 && (
                <View style={s.count}>
                  <Text style={s.countText}>{n}</Text>
                </View>
              )}
              <Text style={s.tileName} numberOfLines={2}>
                {p.name}
              </Text>
              <Text style={s.tilePrice}>{money(p.sellingPricePaise, true)}</Text>
              <Text style={[s.tileStock, out ? { color: colors.red } : p.availableQuantity < 10 ? { color: colors.amber } : null]}>{out ? 'Out of stock' : `${p.availableQuantity} left`}</Text>
            </Pressable>
          );
        }}
      />

      <SafeAreaView edges={['bottom']} style={s.sheet}>
        {cart.lines.length > 0 && (
          <Pressable onPress={() => setExpanded((e) => !e)} style={s.sheetHandle} accessibilityLabel={expanded ? 'Collapse bill' : 'Expand bill'}>
            <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>
              Bill · {count} item{count === 1 ? '' : 's'}
            </Text>
            <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={20} color={colors.ink500} />
          </Pressable>
        )}
        {expanded && cart.lines.length > 0 && (
          <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
            {cart.lines.map((l, i) => (
              <View key={`${l.productId}-${i}`} style={s.line}>
                <View style={{ flex: 1 }}>
                  <Text style={s.lineName} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Muted>
                    {money(l.unitPricePaise, true)} × {l.quantity} = {money((pv?.lines[i]?.netPaise ?? l.unitPricePaise * l.quantity), true)}
                    {l.discount ? ` (disc ${l.discount.type === 'PERCENT' ? `${l.discount.value / 100}%` : money(l.discount.value, true)})` : ''}
                  </Muted>
                  {l.quantity > l.availableQuantity && <Text style={{ color: colors.red, fontSize: 12 }}>Only {l.availableQuantity} in stock</Text>}
                </View>
                <Pressable onPress={() => router.push({ pathname: '/bill/discount', params: { line: String(i) } })} hitSlop={8} accessibilityLabel={`Discount on ${l.name}`} style={{ padding: 6 }}>
                  <Ionicons name="pricetag-outline" size={20} color={l.discount ? colors.brand : colors.ink400} />
                </Pressable>
                <QtyStepper value={l.quantity} onChange={(v) => cart.setQty(i, v)} max={l.availableQuantity} />
              </View>
            ))}
          </ScrollView>
        )}
        <View style={s.footer}>
          <Pressable onPress={() => router.push('/bill/discount')} disabled={!cart.lines.length} style={s.discBtn} accessibilityLabel="Bill discount">
            <Ionicons name="pricetag" size={18} color={cart.billDiscount ? colors.brand : colors.ink500} />
            <Text style={{ color: cart.billDiscount ? colors.brand : colors.ink700, fontWeight: '600' }}>{pv?.discountTotalPaise ? `−${money(pv.discountTotalPaise, true)}` : 'Discount'}</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: space.md }}>
            <Muted>Total</Muted>
            <Text style={s.total}>{money(pv?.totalPaise ?? 0, true)}</Text>
          </View>
          <Button
            title="Checkout"
            icon="arrow-forward"
            size="lg"
            style={{ minWidth: 150 }}
            disabled={!cart.lines.length || !pv}
            onPress={() => {
              if (warnings.length) {
                Alert.alert('Stock may be short', `${warnings.map((w) => w.name).join(', ')} — the server will check live stock.`, [
                  { text: 'Edit', style: 'cancel' },
                  { text: 'Continue', onPress: () => router.push('/bill/checkout') },
                ]);
              } else router.push('/bill/checkout');
            }}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: space.md, height: 50 },
  searchInput: { flex: 1, fontSize: 17, color: colors.ink },
  scanBtn: { width: 50, height: 50, borderRadius: radius.md, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  tile: { flex: 1 / 3, minHeight: 104, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.ink200, padding: 10, justifyContent: 'space-between' },
  tileActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  tileName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  tilePrice: { fontSize: 20, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  tileStock: { fontSize: 12, color: colors.ink500 },
  count: { position: 'absolute', top: -6, right: -6, minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, zIndex: 2 },
  countText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  sheet: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.ink200, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  sheetHandle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.ink100 },
  lineName: { fontSize: 16, fontWeight: '600', color: colors.ink },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.ink100 },
  discBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingRight: 8 },
  total: { fontSize: 26, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
});
