import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeIndianPhone, PAYMENT_METHOD_LABELS, tryRupeesToPaise, type InvoicePreview, type PaymentInput, type PaymentMethod } from '@kite/shared';
import { Button, Card, Chip, Input, money, Muted, NetworkBanner, Row } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cartLogic, useCart } from '@/lib/cart';
import { useOnline } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

type Mode = 'PAID' | 'PARTIAL' | 'UNPAID';
const METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'OTHER'];

export default function Checkout() {
  const qc = useQueryClient();
  const online = useOnline();
  const cart = useCart();
  const local = cartLogic.preview(cart);
  const [server, setServer] = useState<InvoicePreview | null>(null);
  const [mode, setMode] = useState<Mode>('PAID');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [split, setSplit] = useState(false);
  const [splitCash, setSplitCash] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const submitting = useRef(false);

  // Authoritative totals + live stock check from the server (falls back to local preview offline).
  useEffect(() => {
    if (!online || !cart.lines.length) return;
    const req = cartLogic.toRequest(cart, []);
    api.invoices
      .preview({ items: req.items, billDiscount: req.billDiscount })
      .then(setServer)
      .catch(() => setServer(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, cart.updatedAt]);

  const total = server?.totalPaise ?? local?.totalPaise ?? 0;
  const tenderedPaise = tryRupeesToPaise(tendered);

  const payments: PaymentInput[] = useMemo(() => {
    if (mode === 'UNPAID') return [];
    if (mode === 'PARTIAL') {
      const amt = tryRupeesToPaise(partial) ?? 0;
      return amt > 0 ? [{ method, amountPaise: Math.min(amt, total) }] : [];
    }
    if (split) {
      const cash = Math.min(tryRupeesToPaise(splitCash) ?? 0, total);
      return [
        { method: 'CASH', amountPaise: cash },
        { method: 'UPI', amountPaise: total - cash },
      ];
    }
    return [{ method, amountPaise: total }];
  }, [mode, partial, method, split, splitCash, total]);
  const paid = payments.reduce((s, p) => s + p.amountPaise, 0);
  const due = total - paid;
  const needsCustomer = due > 0;
  const phoneOk = !cart.customer.phone.trim() || normalizeIndianPhone(cart.customer.phone) !== null;
  const change = mode === 'PAID' && !split && method === 'CASH' && tenderedPaise !== null ? cartLogic.cashChange(total, tenderedPaise) : null;

  const problems: string[] = [];
  if (!online) problems.push('Offline — cannot verify stock or save the bill');
  if (server?.stockIssues.length) problems.push(`Not enough stock: ${server.stockIssues.map((i) => `${i.name} (${i.available} left)`).join(', ')}`);
  if (needsCustomer && !cart.customer.name.trim()) problems.push('Enter the customer name for a pending payment');
  if (!phoneOk) problems.push('Mobile number looks wrong');
  if (mode === 'PARTIAL' && (paid <= 0 || paid >= total)) problems.push('Enter an amount less than the total');
  if (change && tenderedPaise! < total) problems.push('Cash tendered is less than the total');

  const fixStock = () => {
    if (!server) return;
    for (const issue of server.stockIssues) {
      const idx = useCart.getState().lines.findIndex((l) => l.productId === issue.productId);
      if (idx >= 0) useCart.getState().setQty(idx, issue.available);
    }
  };

  const submit = async () => {
    if (submitting.current) return; // guard against double taps
    submitting.current = true;
    setBusy(true);
    try {
      const res = await api.invoices.create(cartLogic.toRequest(useCart.getState(), payments));
      useCart.getState().reset(); // new idempotency key only AFTER the server confirmed
      qc.invalidateQueries({ queryKey: ['pos-catalog'] });
      qc.invalidateQueries({ queryKey: ['me-summary'] });
      qc.invalidateQueries({ queryKey: ['my-bills'] });
      router.dismissAll();
      router.replace({ pathname: '/bill/success', params: { id: res.data.id, change: String(change?.changePaise ?? 0) } });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'INSUFFICIENT_STOCK') {
          const d = (e.details as { name: string; available: number }[]) ?? [];
          Alert.alert('Not enough stock', d.map((x) => `${x.name}: only ${x.available} left`).join('\n'), [{ text: 'Edit bill', onPress: () => router.back() }]);
        } else if (e.code === 'DISCOUNT_APPROVAL_REQUIRED' || e.code === 'DISCOUNT_APPROVAL_INVALID') {
          Alert.alert('Manager approval needed', e.message, [{ text: 'Open discount', onPress: () => router.push('/bill/discount') }]);
        } else if (e.code === 'IDEMPOTENCY_KEY_CONFLICT') {
          Alert.alert('Bill already saved', 'This cart was already billed with different items. Start a new bill.', [{ text: 'New bill', onPress: () => useCart.getState().reset() }]);
        } else if (e.isNetwork) {
          Alert.alert('Connection problem', "We couldn't confirm the bill was saved. Tap Confirm again — it will NOT create a duplicate.");
        } else {
          Alert.alert('Could not save the bill', e.message);
        }
      } else Alert.alert('Error', errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (!cart.lines.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Muted>The bill is empty.</Muted>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <NetworkBanner />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <View style={s.totalBox}>
          <Muted style={{ color: 'rgba(255,255,255,0.7)' }}>{cartLogic.itemCount(cart)} items{(server ?? local)?.discountTotalPaise ? ` · saved ${money((server ?? local)!.discountTotalPaise, true)}` : ''}</Muted>
          <Text style={s.total}>{money(total)}</Text>
          {server && local && server.totalPaise !== local.totalPaise && <Text style={{ color: '#FDBA74' }}>Prices were updated by the shop</Text>}
        </View>

        <Row>
          {(['PAID', 'PARTIAL', 'UNPAID'] as Mode[]).map((m) => (
            <Chip key={m} label={m === 'PAID' ? 'Paid in full' : m === 'PARTIAL' ? 'Part paid' : 'Unpaid'} active={mode === m} tone="dark" onPress={() => setMode(m)} />
          ))}
        </Row>

        {mode !== 'UNPAID' && !split && (
          <View style={{ gap: space.sm }}>
            <Text style={s.label}>Payment method</Text>
            <View style={s.methods}>
              {METHODS.map((m) => (
                <Chip key={m} label={PAYMENT_METHOD_LABELS[m]} active={method === m} onPress={() => setMethod(m)} />
              ))}
            </View>
          </View>
        )}

        {mode === 'PAID' && (
          <Card style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={s.label}>Split cash + UPI</Text>
              <Chip label={split ? 'On' : 'Off'} active={split} onPress={() => setSplit((x) => !x)} />
            </Row>
            {split ? (
              <>
                <Input label="Cash amount (₹)" value={splitCash} onChangeText={setSplitCash} keyboardType="decimal-pad" placeholder="0" />
                <Muted>UPI: {money(Math.max(0, total - Math.min(tryRupeesToPaise(splitCash) ?? 0, total)))}</Muted>
              </>
            ) : method === 'CASH' ? (
              <>
                <Text style={s.label}>Cash tendered (optional)</Text>
                <View style={s.methods}>
                  {[50, 100, 200, 500, 2000].filter((r) => r * 100 >= total || r === 2000).slice(0, 4).map((r) => (
                    <Chip key={r} label={`₹${r}`} active={tendered === String(r)} onPress={() => setTendered(String(r))} />
                  ))}
                  <Chip label="Exact" active={tendered === ''} onPress={() => setTendered('')} />
                </View>
                <Input value={tendered} onChangeText={setTendered} keyboardType="decimal-pad" placeholder="Amount given by customer" />
                {change && change.changePaise > 0 && (
                  <View style={s.change}>
                    <Text style={{ fontSize: 16, color: colors.ink700 }}>Give back</Text>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: colors.green, fontVariant: ['tabular-nums'] }}>{money(change.changePaise)}</Text>
                  </View>
                )}
              </>
            ) : (
              <Muted>Confirm the {PAYMENT_METHOD_LABELS[method]} payment of {money(total)} was received.</Muted>
            )}
          </Card>
        )}

        {mode === 'PARTIAL' && (
          <Input label="Amount received now (₹)" value={partial} onChangeText={setPartial} keyboardType="decimal-pad" placeholder="0" style={{ fontSize: 22, fontWeight: '700' }} />
        )}

        {(needsCustomer || showCustomer || cart.customer.name || cart.customer.phone) && (
          <Card style={{ gap: space.md }}>
            <Text style={s.label}>{needsCustomer ? `Customer (pending ${money(due)})` : 'Customer (optional)'}</Text>
            <Input placeholder="Customer name" value={cart.customer.name} onChangeText={(t) => cart.setCustomer({ name: t })} autoCapitalize="words" />
            <Input placeholder="Mobile number" value={cart.customer.phone} onChangeText={(t) => cart.setCustomer({ phone: t })} keyboardType="phone-pad" error={!phoneOk ? 'Enter a valid 10-digit mobile' : undefined} />
          </Card>
        )}
        {!needsCustomer && !showCustomer && !cart.customer.name && !cart.customer.phone && (
          <Button title="Add customer details" variant="ghost" icon="person-add-outline" onPress={() => setShowCustomer(true)} />
        )}

        {problems.length > 0 && (
          <Card style={{ borderColor: colors.red, backgroundColor: colors.redSoft, gap: 6 }}>
            {problems.map((p) => (
              <Text key={p} style={{ color: colors.red, fontWeight: '500' }}>
                • {p}
              </Text>
            ))}
            {!!server?.stockIssues.length && <Button title="Reduce to available stock" variant="secondary" onPress={fixStock} />}
          </Card>
        )}
      </ScrollView>
      <View style={s.bar}>
        <Button
          title={busy ? 'Saving…' : mode === 'UNPAID' ? `Confirm bill · ${money(total, true)} due` : `Confirm · ${money(paid, true)} received`}
          size="xl"
          loading={busy}
          disabled={problems.length > 0}
          onPress={submit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  totalBox: { backgroundColor: colors.night, borderRadius: radius.xl, padding: space.xl, gap: 4 },
  total: { fontSize: 44, fontWeight: '800', color: colors.white, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  label: { fontSize: 15, fontWeight: '700', color: colors.ink },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  change: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.greenSoft, padding: space.md, borderRadius: radius.md },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: 34, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.ink200 },
});
