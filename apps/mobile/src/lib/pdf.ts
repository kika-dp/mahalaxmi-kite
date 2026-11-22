import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { refreshTokens } from './api';
import { session } from './session';

/**
 * Download the invoice PDF (authenticated) into the cache directory.
 * The PDF is rendered by the server so every channel (CRM, share, print) shows the same document.
 */
export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string, format: 'a4' | 'thermal' = 'a4'): Promise<string> {
  const target = `${FileSystem.cacheDirectory}${invoiceNumber}${format === 'thermal' ? '-80mm' : ''}.pdf`;
  const url = `${session.server()}/invoices/${invoiceId}/pdf?format=${format}`;
  const attempt = () => FileSystem.downloadAsync(url, target, { headers: { Authorization: `Bearer ${session.access() ?? ''}` } });
  let res = await attempt();
  if (res.status === 401 && (await refreshTokens())) res = await attempt();
  if (res.status !== 200) throw new Error(res.status === 404 ? 'Bill not found' : `Could not download the bill (${res.status})`);
  return res.uri;
}

/** iOS share sheet: WhatsApp, Messages, Mail, AirDrop, Files… (no WhatsApp API involved). */
export async function shareInvoice(invoiceId: string, invoiceNumber: string): Promise<void> {
  const uri = await downloadInvoicePdf(invoiceId, invoiceNumber);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Bill ${invoiceNumber}` });
}

/** AirPrint (or any iOS-supported printer). Thermal layout prints well on 80 mm printers. */
export async function printInvoice(invoiceId: string, invoiceNumber: string, format: 'a4' | 'thermal' = 'a4'): Promise<void> {
  const uri = await downloadInvoicePdf(invoiceId, invoiceNumber, format);
  await Print.printAsync({ uri });
}
