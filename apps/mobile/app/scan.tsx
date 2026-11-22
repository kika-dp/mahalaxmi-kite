import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Button, money } from '@/components/ui';
import { api } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useCatalog } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

/** Continuous scanning: each recognised code adds one unit to the bill. */
export default function Scan() {
  const [perm, request] = useCameraPermissions();
  const catalog = useCatalog();
  const add = useCart((c) => c.add);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const cooldown = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const onScan = async ({ data }: BarcodeScanningResult) => {
    const code = data.trim();
    const now = Date.now();
    if (code === cooldown.current.code && now - cooldown.current.at < 1500) return; // same code still in view
    cooldown.current = { code, at: now };
    const products = catalog.data?.products ?? [];
    let p = products.find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!p) {
      try {
        const found = await api.catalog.lookup(code);
        p = products.find((x) => x.id === found.id) ?? {
          id: found.id,
          sku: found.sku,
          barcode: found.barcode,
          name: found.name,
          categoryId: found.categoryId,
          kind: found.kind,
          unitType: found.unitType,
          sellingPricePaise: found.sellingPricePaise,
          availableQuantity: found.availableQuantity,
          imageUrl: found.imageUrl,
          isFavorite: found.isFavorite,
          favoriteOrder: found.favoriteOrder,
        };
      } catch {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        return setLast({ text: `No product for code ${code}`, ok: false });
      }
    }
    add({ productId: p.id, name: p.name, sku: p.sku, unitPricePaise: p.sellingPricePaise, availableQuantity: p.availableQuantity });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setLast({ text: `Added ${p.name} · ${money(p.sellingPricePaise, true)}`, ok: true });
  };

  if (!perm) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!perm.granted) {
    return (
      <View style={st.center}>
        <Ionicons name="camera-outline" size={48} color={colors.ink400} />
        <Text style={{ fontSize: 17, textAlign: 'center', color: colors.ink700 }}>Allow camera access to scan product barcodes. You can always search by name instead.</Text>
        <Button title="Allow camera" onPress={request} />
        <Button title="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
        onBarcodeScanned={onScan}
      />
      <View style={st.frame} pointerEvents="none" />
      <View style={st.top}>
        <Pressable onPress={() => router.back()} style={st.close} accessibilityLabel="Close scanner">
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>
      </View>
      <View style={st.bottom}>
        {last && (
          <View style={[st.toast, { backgroundColor: last.ok ? colors.green : colors.red }]} accessibilityLiveRegion="polite">
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>{last.text}</Text>
          </View>
        )}
        <Button title="Done — back to bill" size="lg" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: colors.bg },
  frame: { position: 'absolute', top: '30%', left: '12%', right: '12%', height: 200, borderWidth: 3, borderColor: colors.brand, borderRadius: radius.lg },
  top: { position: 'absolute', top: 56, left: 16 },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 40, padding: space.lg, gap: space.md },
  toast: { padding: space.md, borderRadius: radius.md },
});
