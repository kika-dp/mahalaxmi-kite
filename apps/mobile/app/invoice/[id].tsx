import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Button, Muted } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { downloadInvoicePdf, shareInvoice } from '@/lib/pdf';
import { colors, space } from '@/lib/theme';

/** In-app PDF preview (iOS WKWebView renders PDFs natively). */
export default function InvoicePreview() {
  const { id, number } = useLocalSearchParams<{ id: string; number: string }>();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    downloadInvoicePdf(id, number).then(setUri).catch((e) => setError(errorMessage(e)));
  }, [id, number]);
  if (error) return <Muted style={{ padding: space.xl }}>{error}</Muted>;
  if (!uri) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  return (
    <View style={{ flex: 1 }}>
      <WebView source={{ uri }} originWhitelist={['file://*']} allowFileAccess style={{ flex: 1 }} />
      <View style={{ padding: space.lg, paddingBottom: 34, backgroundColor: colors.white }}>
        <Button title="Share bill" icon="share-outline" size="lg" onPress={() => shareInvoice(id, number).catch(() => undefined)} />
      </View>
    </View>
  );
}
