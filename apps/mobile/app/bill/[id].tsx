import { useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { formatIstDateTime, PAYMENT_METHOD_LABELS, paiseToDecimalString, Permission, tryRupeesToPaise, type PaymentMethod } from '@kite/shared';
import { Button, Card, Chip, Input, money, Muted, Row, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { printInvoice, shareInvoice } from '@/lib/pdf';
import { colors, radius, space } from '@/lib/theme';

export default function BillDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bill', id], queryFn: () => api.invoices.get(id) });
  const [collect, setCollect] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const b = q.data;

  const act = async (kind: 'share' | 'print' | 'thermal') => {
    if (!b) return;
    setBusy(kind);
    try {
      if (kind === 'share') await shareInvoice(b.id, b.invoiceNumber);
      else await printInvoice(b.id, b.invoiceNumber, kind === 'thermal' ? 'thermal' : 'a4');
    } catch (e) {
      Alert.alert('Could not open the bill', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const repeat = async () => {
    if (!b) return;
    const doIt = async () => {
      try {
        const lines = await api.invoices.repeat(b.id);
        const usable = lines.filter((l) => l.isActive);
        useCart.getState().loadLines(usable.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, unitPricePaise: l.sellingPricePaise, quantity: l.quantity, availableQuantity: l.availableQuantity })));
        const skipped = lines.length - usable.length;
        router.push('/bill/new');
        if (skipped) Alert.alert('Some items skipped', `${skipped} item(s) are no longer sold.`);
      } catch (e) {
        Alert.alert('Could not repeat', errorMessage(e));
      }
    };
    if (useCart.getState().lines.length) {
      Alert.alert('Replace current bill?', 'Your unfinished bill will be replaced with these items at today’s prices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: doIt },
      ]);
    } else void doIt();
  };

  if (!b) return <View style={{ flex: 1 }}>{q.isError && <Muted style={{ padding: space.lg }}>{errorMessage(q.error)}</Muted>}</View>;
  return (
    <>
      <Stack.Screen options={{ title: b.invoiceNumber }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />}>
        <Card style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>{formatIstDateTime(b.createdAt)}</Muted>
            <StatusBadge status={b.paymentStatus} invoiceStatus={b.status} />
          </Row>
          <Text style={{ fontSize: 34, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] }}>{money(b.totalPaise)}</Text>
          {b.customerName && (
            <Muted>
              {b.customerName}
              {b.customerPhone ? ` · ${b.customerPhone}` : ''}
            </Muted>
          )}
          {b.outstandingPaise > 0 && <Text style={{ color: colors.red, fontWeight: '700', fontSize: 17 }}>Balance due {money(b.outstandingPaise)}</Text>}
          {b.status === 'VOID' && <Text style={{ color: colors.red }}>Void: {b.voidReason}</Text>}
        </Card>

        <Card style={{ padding: 0 }}>
          {b.items.map((it, i) => (
            <View key={it.id} style={[st.item, i > 0 && { borderTopWidth: 1, borderTopColor: colors.ink100 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{it.productName}</Text>
                <Muted>
                  {it.quantity} × {money(it.unitPricePaise, true)}
                  {it.lineDiscountPaise ? ` − ${money(it.lineDiscountPaise, true)}` : ''}
                  {it.returnedQuantity ? ` · ${it.returnedQuantity} returned` : ''}
                </Muted>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money(it.grossPaise - it.lineDiscountPaise, true)}</Text>
            </View>
          ))}
          <View style={st.totals}>
            <Line label="Subtotal" value={money(b.grossSubtotalPaise)} />
            {b.discountTotalPaise > 0 && <Line label="Discount" value={`−${money(b.discountTotalPaise)}`} />}
            {b.taxPaise > 0 && <Line label={`Tax ${b.taxRateBps / 100}%`} value={money(b.taxPaise)} />}
            <Line label="Total" value={money(b.totalPaise)} bold />
            <Line label="Received" value={money(b.amountPaidPaise - b.amountRefundedPaise)} />
          </View>
        </Card>

        {b.payments.length > 0 && (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', fontSize: 16 }}>Payments</Text>
            {b.payments.map((p) => (
              <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                <Muted>
                  {formatIstDateTime(p.createdAt)} · {PAYMENT_METHOD_LABELS[p.method]} · {p.receivedBy.fullName}
                </Muted>
                <Text style={{ fontWeight: '600', fontVariant: ['tabular-nums'], color: p.direction === 'OUT' ? colors.red : colors.ink }}>
                  {p.direction === 'OUT' ? '−' : ''}
                  {money(p.amountPaise, true)}
                </Text>
              </Row>
            ))}
          </Card>
        )}

        {b.status === 'FINALIZED' && b.outstandingPaise > 0 && can(Permission.PAYMENTS_RECORD) && <Button title={`Collect ${money(b.outstandingPaise, true)}`} icon="cash-outline" size="lg" onPress={() => setCollect(true)} />}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button title="Share" icon="share-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'share'} onPress={() => act('share')} />
          <Button title="Print" icon="print-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'print'} onPress={() => act('print')} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button title="80mm print" icon="receipt-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'thermal'} onPress={() => act('thermal')} />
          <Button title="Preview" icon="eye-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: b.id, number: b.invoiceNumber } })} />
        </View>
        <Button title="Repeat this bill" icon="repeat" variant="ghost" onPress={repeat} />
      </ScrollView>
      <CollectSheet
        visible={collect}
        due={b.outstandingPaise}
        onClose={() => setCollect(false)}
        onPay={async (method, amountPaise, key) => {
          const res = await api.invoices.pay(b.id, { idempotencyKey: key, payments: [{ method, amountPaise }] });
          qc.setQueryData(['bill', id], res.data);
          qc.invalidateQueries({ queryKey: ['me-summary'] });
          qc.invalidateQueries({ queryKey: ['my-bills'] });
          setCollect(false);
        }}
      />
    </>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ fontSize: bold ? 17 : 15, fontWeight: bold ? '700' : '400', color: colors.ink700 }}>{label}</Text>
      <Text style={{ fontSize: bold ? 18 : 15, fontWeight: bold ? '800' : '500', fontVariant: ['tabular-nums'], color: colors.ink }}>{value}</Text>
    </Row>
  );
}

/** Collect a later payment. Never changes stock; idempotent per attempt. */
function CollectSheet({ visible, due, onClose, onPay }: { visible: boolean; due: number; onClose: () => void; onPay: (m: PaymentMethod, amount: number, key: string) => Promise<void> }) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const paise = amount ? tryRupeesToPaise(amount) : due;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onShow={() => (setKey(Crypto.randomUUID()), setAmount(''))}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontWeight: '800' }}>Collect payment</Text>
        <Muted>Due: {money(due)}</Muted>
        <Input label="Amount (₹)" value={amount} placeholder={paiseToDecimalString(due)} onChangeText={setAmount} keyboardType="decimal-pad" style={{ fontSize: 24, fontWeight: '700' }} error={paise !== null && paise > due ? 'More than the amount due' : undefined} />
        <Row style={{ flexWrap: 'wrap' }}>
          {(['CASH', 'UPI', 'CARD', 'OTHER'] as PaymentMethod[]).map((m) => (
            <Chip key={m} label={PAYMENT_METHOD_LABELS[m]} active={method === m} onPress={() => setMethod(m)} />
          ))}
        </Row>
        <Button
          title={`Record ${paise ? money(paise, true) : ''}`}
          size="xl"
          loading={busy}
          disabled={!paise || paise > due}
          onPress={async () => {
            setBusy(true);
            try {
              await onPay(method, paise!, key);
            } catch (e) {
              Alert.alert('Payment not recorded', `${errorMessage(e)}\nIf the connection dropped, tap Record again — it won't be counted twice.`);
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button title="Cancel" variant="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  totals: { borderTopWidth: 1, borderTopColor: colors.ink200, padding: space.lg, gap: 6, backgroundColor: colors.ink100, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
