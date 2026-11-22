import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { percentToBps, rupeesToPaise } from '@kite/shared';
import { Button, Card, Chip, Input, money, Muted, Row } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cartLogic, useCart } from '@/lib/cart';
import { colors, space } from '@/lib/theme';

/** Bill-level discount, or a single line's discount when opened with ?line=N. */
export default function DiscountScreen() {
  const { line } = useLocalSearchParams<{ line?: string }>();
  const lineIndex = line !== undefined ? Number(line) : null;
  const cart = useCart();
  const { maxDiscountBps } = useAuth();
  const current = lineIndex !== null ? cart.lines[lineIndex]?.discount ?? null : cart.billDiscount;
  const [type, setType] = useState<'FIXED' | 'PERCENT'>(current?.type ?? 'FIXED');
  const [value, setValue] = useState(current ? (current.type === 'PERCENT' ? String(current.value / 100) : String(current.value / 100)) : '');
  const [reason, setReason] = useState(cart.discountReason);
  const [mgr, setMgr] = useState({ username: '', password: '' });

  const parsed = useMemo(() => {
    if (!value.trim()) return null;
    try {
      return type === 'PERCENT' ? percentToBps(value.trim()) : rupeesToPaise(value.trim());
    } catch {
      return undefined;
    }
  }, [type, value]);

  const draft = useMemo(() => {
    const d = parsed ? { type, value: parsed } : null;
    if (lineIndex !== null) return { ...cart, lines: cart.lines.map((l, i) => (i === lineIndex ? { ...l, discount: d } : l)) };
    return { ...cart, billDiscount: d };
  }, [cart, parsed, type, lineIndex]);
  const pv = cartLogic.preview(draft);
  const invalid = parsed === undefined || (parsed !== null && !pv);
  const overCap = maxDiscountBps !== null && pv !== null && pv.discountTotalPaise > 0 && pv.discountBpsOfGross > maxDiscountBps;

  const save = () => {
    const d = parsed ? { type, value: parsed } : null;
    if (lineIndex !== null) cart.setLineDiscount(lineIndex, d);
    else cart.setBillDiscount(d, null);
    // Approval covers the bill's TOTAL discount (item + bill), so it is stored once on the cart.
    useCart.getState().setBillDiscount(useCart.getState().billDiscount, overCap ? mgr : null);
    cart.setDiscountReason(reason.trim());
    router.back();
  };

  const quick = type === 'FIXED' ? ['10', '20', '50', '100'] : ['5', '10', '15'];
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 16, color: colors.ink700 }}>{lineIndex !== null ? `Discount on ${cart.lines[lineIndex]?.name}` : 'Discount on the whole bill (after item discounts)'}</Text>
        <Row>
          <Chip label="₹ Amount" active={type === 'FIXED'} tone="dark" onPress={() => (setType('FIXED'), setValue(''))} />
          <Chip label="% Percent" active={type === 'PERCENT'} tone="dark" onPress={() => (setType('PERCENT'), setValue(''))} />
        </Row>
        <Input
          label={type === 'FIXED' ? 'Discount amount (₹)' : 'Discount percent (%)'}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          autoFocus
          placeholder="0"
          style={{ fontSize: 26, fontWeight: '700' }}
          error={invalid ? 'Discount is more than the amount' : undefined}
        />
        <Row style={{ flexWrap: 'wrap' }}>
          {quick.map((qv) => (
            <Chip key={qv} label={type === 'FIXED' ? `₹${qv}` : `${qv}%`} onPress={() => setValue(qv)} active={value === qv} />
          ))}
          <Chip label="No discount" onPress={() => setValue('')} active={!value} />
        </Row>
        {pv && (
          <Card style={{ gap: 6, backgroundColor: colors.brandSoft, borderColor: colors.brand }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>Subtotal</Muted>
              <Text style={{ fontVariant: ['tabular-nums'] }}>{money(pv.grossSubtotalPaise)}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>Customer saves</Muted>
              <Text style={{ color: colors.green, fontWeight: '700', fontVariant: ['tabular-nums'] }}>−{money(pv.discountTotalPaise)}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', fontSize: 18 }}>New total</Text>
              <Text style={{ fontWeight: '800', fontSize: 22, fontVariant: ['tabular-nums'] }}>{money(pv.totalPaise)}</Text>
            </Row>
          </Card>
        )}
        {<Input label={overCap ? 'Reason (required)' : 'Reason (optional)'} value={reason} onChangeText={setReason} placeholder="e.g. Regular customer, bulk order" />}
        {overCap && (
          <Card style={{ gap: space.md, borderColor: colors.amber, backgroundColor: colors.amberSoft }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Manager approval needed</Text>
            <Muted>Your limit is {(maxDiscountBps ?? 0) / 100}%. An admin can approve by entering their username and password. It is checked by the server and recorded.</Muted>
            <Input label="Admin username" value={mgr.username} onChangeText={(t) => setMgr({ ...mgr, username: t })} autoCapitalize="none" autoCorrect={false} />
            <Input label="Admin password" value={mgr.password} onChangeText={(t) => setMgr({ ...mgr, password: t })} secureTextEntry />
          </Card>
        )}
        <View style={{ gap: space.sm }}>
          <Button
            title="Apply"
            size="lg"
            onPress={save}
            disabled={invalid || (overCap && (!mgr.username || !mgr.password || !reason.trim()))}
          />
          <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
