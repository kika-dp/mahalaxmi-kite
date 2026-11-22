import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Button, money, Muted, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { printInvoice, shareInvoice } from '@/lib/pdf';
import { colors, radius, space } from '@/lib/theme';

export default function Success() {
  const { id, change } = useLocalSearchParams<{ id: string; change?: string }>();
  const inv = useQuery({ queryKey: ['bill', id], queryFn: () => api.invoices.get(id) });
  const [busy, setBusy] = useState<'share' | 'print' | null>(null);
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);
  const b = inv.data;
  const changePaise = Number(change ?? 0);

  const run = async (kind: 'share' | 'print') => {
    if (!b) return;
    setBusy(kind);
    try {
      if (kind === 'share') await shareInvoice(b.id, b.invoiceNumber);
      else await printInvoice(b.id, b.invoiceNumber);
    } catch (e) {
      Alert.alert('Could not open the bill', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.wrap}>
        <View style={st.check}>
          <Ionicons name="checkmark" size={56} color={colors.white} />
        </View>
        <Text style={st.title}>Bill saved</Text>
        <Text style={st.number}>{b?.invoiceNumber ?? '…'}</Text>
        {b && (
          <View style={st.card}>
            <Row label="Total" value={money(b.totalPaise)} big />
            <Row label="Received" value={money(b.amountPaidPaise)} />
            {b.outstandingPaise > 0 && <Row label="Balance due" value={money(b.outstandingPaise)} tone={colors.red} />}
            {changePaise > 0 && <Row label="Change to give" value={money(changePaise)} tone={colors.green} />}
            <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
              <StatusBadge status={b.paymentStatus} />
            </View>
            {b.customerName && <Muted>Customer: {b.customerName}</Muted>}
          </View>
        )}
      </View>
      <View style={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button title="Share" icon="share-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'share'} disabled={!b} onPress={() => run('share')} />
          <Button title="Print" icon="print-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'print'} disabled={!b} onPress={() => run('print')} />
          <Button title="View" icon="document-text-outline" variant="secondary" style={{ flex: 1 }} disabled={!b} onPress={() => router.push(`/bill/${id}`)} />
        </View>
        <Button title="New Bill" icon="add-circle" size="xl" onPress={() => router.replace('/bill/new')} />
        <Button title="Home" variant="ghost" onPress={() => router.replace('/')} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: big ? 18 : 16, color: colors.ink700, fontWeight: big ? '700' : '400' }}>{label}</Text>
      <Text style={{ fontSize: big ? 26 : 18, fontWeight: '800', color: tone ?? colors.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  check: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  number: { fontSize: 18, fontWeight: '600', color: colors.ink500, fontVariant: ['tabular-nums'] },
  card: { alignSelf: 'stretch', backgroundColor: colors.white, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.ink200, padding: space.xl, gap: space.md, marginTop: space.lg },
});
