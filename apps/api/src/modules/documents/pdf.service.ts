import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import {
  formatINR,
  formatIstDate,
  formatIstDateTime,
  Invoice,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  ShopSettings,
  UNIT_LABELS,
} from '@kite/shared';
import { uploadDir } from '../../common/utils/uploads';

const FONT_DIR = path.resolve(__dirname, '../../../assets/fonts');
const REGULAR = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');
const hasFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);

/** ₹ needs a Unicode font; fall back to "Rs." if the bundled font is missing. */
const money = (p: number) => (hasFonts ? formatINR(p) : formatINR(p).replace('₹', 'Rs. '));

export interface StatementData {
  customer: { name: string; phone: string | null; address: string | null };
  from: string;
  to: string;
  openingBalancePaise: number;
  entries: { date: string; description: string; debitPaise: number; creditPaise: number }[];
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function logoPath(settings: ShopSettings): string | null {
  if (!settings.logoUrl) return null;
  const file = settings.logoUrl.split('/uploads/')[1];
  if (!file || file.includes('..') || file.endsWith('.webp')) return null; // pdfkit supports JPEG/PNG only
  const full = path.join(uploadDir(), file);
  return fs.existsSync(full) ? full : null;
}

/**
 * Invoice title: "Tax Invoice" ONLY when tax is enabled AND a GSTIN is configured (spec §17);
 * otherwise the configured title (default "Invoice"), never a tax invoice by accident.
 */
export function invoiceTitle(settings: ShopSettings): string {
  if (settings.taxEnabled && settings.gstin) return 'Tax Invoice';
  return /tax\s*invoice/i.test(settings.invoiceTitle) ? 'Invoice' : settings.invoiceTitle;
}

@Injectable()
export class PdfService {
  private newDoc(opts: PDFKit.PDFDocumentOptions): PDFKit.PDFDocument {
    const doc = new PDFDocument({ ...opts, info: { Title: opts.info?.Title ?? 'Document', Producer: 'Kite Shop Platform' } });
    if (hasFonts) {
      doc.registerFont('regular', REGULAR);
      doc.registerFont('bold', BOLD);
    } else {
      doc.registerFont('regular', 'Helvetica');
      doc.registerFont('bold', 'Helvetica-Bold');
    }
    doc.font('regular');
    return doc;
  }

  async invoice(inv: Invoice, settings: ShopSettings, format: 'a4' | 'thermal'): Promise<Buffer> {
    return format === 'thermal' ? this.thermal(inv, settings) : this.a4(inv, settings);
  }

  // ------------------------------------------------------------------- A4
  private async a4(inv: Invoice, s: ShopSettings): Promise<Buffer> {
    const doc = this.newDoc({ size: 'A4', margin: 40, info: { Title: inv.invoiceNumber } });
    const W = doc.page.width - 80;
    const left = 40;
    const brand = s.brandColor || '#F97316';

    // Header
    const logo = logoPath(s);
    let y = 40;
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [60, 60] });
      } catch {
        /* ignore bad image */
      }
    }
    const hx = logo ? left + 72 : left;
    doc.font('bold').fontSize(18).fillColor('#111').text(s.shopName, hx, y, { width: W - 200 });
    doc.font('regular').fontSize(9).fillColor('#444');
    if (s.address) doc.text(s.address, hx, doc.y, { width: W - 200 });
    const contact = [s.phone && `Phone: ${s.phone}`, s.email].filter(Boolean).join('  ·  ');
    if (contact) doc.text(contact, hx, doc.y, { width: W - 200 });
    if (s.taxEnabled && s.gstin) doc.text(`GSTIN: ${s.gstin}`, hx, doc.y);

    doc.font('bold').fontSize(16).fillColor(brand).text(invoiceTitle(s).toUpperCase(), left, 40, { width: W, align: 'right' });
    doc.font('regular').fontSize(9).fillColor('#333');
    doc.text(`No: ${inv.invoiceNumber}`, left, 62, { width: W, align: 'right' });
    doc.text(`Date: ${formatIstDateTime(inv.createdAt)}`, { width: W, align: 'right' });
    doc.text(`Salesperson: ${inv.salesperson.fullName}`, { width: W, align: 'right' });
    if (inv.status === 'VOID') {
      doc.font('bold').fillColor('#DC2626').text('VOID', { width: W, align: 'right' });
    }

    y = Math.max(doc.y, 110) + 10;
    doc.moveTo(left, y).lineTo(left + W, y).strokeColor(brand).lineWidth(1.5).stroke();
    y += 10;

    // Bill to
    doc.font('bold').fontSize(9).fillColor('#666').text('BILL TO', left, y);
    doc.font('regular').fontSize(10).fillColor('#111');
    doc.text(inv.customerName ?? 'Walk-in customer', left, doc.y);
    if (inv.customerPhone) doc.text(`Mobile: ${inv.customerPhone}`);
    y = doc.y + 12;

    // Items table
    const cols = [
      { h: '#', w: 22, a: 'left' as const },
      { h: 'Item', w: W - 22 - 50 - 70 - 70 - 85, a: 'left' as const },
      { h: 'Qty', w: 50, a: 'right' as const },
      { h: 'Rate', w: 70, a: 'right' as const },
      { h: 'Discount', w: 70, a: 'right' as const },
      { h: 'Amount', w: 85, a: 'right' as const },
    ];
    const row = (vals: string[], yy: number, bold = false, color = '#111') => {
      let x = left;
      doc.font(bold ? 'bold' : 'regular').fontSize(9).fillColor(color);
      let h = 0;
      vals.forEach((v, i) => {
        doc.text(v, x + 3, yy, { width: cols[i].w - 6, align: cols[i].a });
        h = Math.max(h, doc.heightOfString(v, { width: cols[i].w - 6 }));
        x += cols[i].w;
      });
      return yy + h + 6;
    };
    doc.rect(left, y, W, 18).fill('#F3F4F6');
    y = row(cols.map((c) => c.h), y + 4, true, '#374151');
    for (const it of inv.items) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }
      const name = `${it.productName}${it.note ? `\n${it.note}` : ''}${it.returnedQuantity ? `\n(${it.returnedQuantity} returned)` : ''}`;
      y = row(
        [
          String(it.lineNo),
          name,
          `${it.quantity} ${UNIT_LABELS[it.unitType] ?? ''}`,
          money(it.unitPricePaise),
          it.lineDiscountPaise ? `−${money(it.lineDiscountPaise)}` : '—',
          money(it.grossPaise - it.lineDiscountPaise),
        ],
        y,
      );
      doc.moveTo(left, y - 3).lineTo(left + W, y - 3).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    }

    // Totals
    y += 6;
    const tx = left + W - 240;
    const line = (label: string, value: string, bold = false, color = '#111') => {
      doc.font(bold ? 'bold' : 'regular').fontSize(bold ? 11 : 9.5).fillColor(color);
      doc.text(label, tx, y, { width: 130 });
      doc.text(value, tx + 130, y, { width: 110, align: 'right' });
      y += bold ? 18 : 15;
    };
    line('Subtotal', money(inv.grossSubtotalPaise));
    if (inv.lineDiscountTotalPaise) line('Item discounts', `−${money(inv.lineDiscountTotalPaise)}`);
    if (inv.billDiscountPaise) {
      const pct = inv.billDiscountType === 'PERCENT' ? ` (${inv.billDiscountValue / 100}%)` : '';
      line(`Bill discount${pct}`, `−${money(inv.billDiscountPaise)}`);
    }
    if (inv.taxPaise) line(`${s.taxLabel} @ ${inv.taxRateBps / 100}%`, money(inv.taxPaise));
    doc.moveTo(tx, y).lineTo(left + W, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    y += 4;
    line('Total', money(inv.totalPaise), true);
    if (inv.returnedAmountPaise) line('Returned', `−${money(inv.returnedAmountPaise)}`);
    line('Paid', money(inv.amountPaidPaise));
    if (inv.amountRefundedPaise) line('Refunded', `−${money(inv.amountRefundedPaise)}`);
    line('Balance due', money(inv.outstandingPaise), true, inv.outstandingPaise > 0 ? '#DC2626' : '#15803D');
    line('Status', inv.status === 'VOID' ? 'Void' : PAYMENT_STATUS_LABELS[inv.paymentStatus]);

    // Payments
    const ins = inv.payments.filter((p) => p.direction === 'IN');
    if (ins.length) {
      y += 6;
      doc.font('bold').fontSize(9).fillColor('#666').text('PAYMENTS', left, y);
      doc.font('regular').fillColor('#333');
      for (const p of inv.payments) {
        doc.text(
          `${formatIstDateTime(p.createdAt)}  ·  ${p.direction === 'OUT' ? 'Refund' : 'Received'} ${money(p.amountPaise)} by ${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` (${p.reference})` : ''}`,
          left,
          doc.y,
          { width: W },
        );
      }
      y = doc.y;
    }
    if (inv.notes) doc.moveDown(0.5).fontSize(9).fillColor('#333').text(`Notes: ${inv.notes}`, left, doc.y, { width: W });
    if (inv.status === 'VOID' && inv.voidReason) doc.fillColor('#DC2626').text(`Voided: ${inv.voidReason}`, left, doc.y, { width: W });

    // Footer
    const fy = doc.page.height - 70;
    doc.moveTo(left, fy).lineTo(left + W, fy).strokeColor('#E5E7EB').stroke();
    doc.font('regular').fontSize(9).fillColor('#555');
    if (s.invoiceFooter) doc.text(s.invoiceFooter, left, fy + 8, { width: W, align: 'center' });
    doc.fontSize(7).fillColor('#999').text('Computer-generated bill. Prices in Indian Rupees.', left, fy + 30, { width: W, align: 'center' });

    if (inv.status === 'VOID') {
      doc.save().rotate(-30, { origin: [300, 420] }).font('bold').fontSize(110).fillColor('#DC2626').opacity(0.12).text('VOID', 100, 360).restore();
    }
    return toBuffer(doc);
  }

  // -------------------------------------------------------- 80 mm thermal
  private async thermal(inv: Invoice, s: ShopSettings): Promise<Buffer> {
    const width = 227; // 80 mm ≈ 227 pt
    const margin = 10;
    const W = width - margin * 2;
    const height = 330 + inv.items.length * 30 + inv.payments.length * 12;
    const doc = this.newDoc({ size: [width, height], margin, info: { Title: inv.invoiceNumber } });
    const center = (t: string, size = 8, bold = false) => doc.font(bold ? 'bold' : 'regular').fontSize(size).fillColor('#000').text(t, margin, doc.y, { width: W, align: 'center' });
    const lr = (l: string, r: string, bold = false, size = 8) => {
      const y = doc.y;
      doc.font(bold ? 'bold' : 'regular').fontSize(size);
      doc.text(l, margin, y, { width: W * 0.6 });
      const h = doc.y;
      doc.text(r, margin + W * 0.6, y, { width: W * 0.4, align: 'right' });
      doc.y = Math.max(h, doc.y);
    };
    const rule = () => {
      doc.moveDown(0.2);
      doc.moveTo(margin, doc.y).lineTo(width - margin, doc.y).dash(2, { space: 2 }).strokeColor('#000').stroke().undash();
      doc.moveDown(0.3);
    };
    center(s.shopName, 11, true);
    if (s.address) center(s.address, 7);
    if (s.phone) center(`Ph: ${s.phone}`, 7);
    if (s.taxEnabled && s.gstin) center(`GSTIN: ${s.gstin}`, 7);
    doc.moveDown(0.3);
    center(invoiceTitle(s).toUpperCase(), 9, true);
    if (inv.status === 'VOID') center('*** VOID ***', 10, true);
    rule();
    lr('Bill No', inv.invoiceNumber);
    lr('Date', formatIstDateTime(inv.createdAt));
    lr('By', inv.salesperson.fullName);
    if (inv.customerName) lr('Customer', inv.customerName);
    if (inv.customerPhone) lr('Mobile', inv.customerPhone);
    rule();
    for (const it of inv.items) {
      doc.font('regular').fontSize(8).text(it.productName, margin, doc.y, { width: W });
      lr(`  ${it.quantity} × ${money(it.unitPricePaise)}${it.lineDiscountPaise ? ` −${money(it.lineDiscountPaise)}` : ''}`, money(it.grossPaise - it.lineDiscountPaise));
    }
    rule();
    lr('Subtotal', money(inv.grossSubtotalPaise));
    if (inv.discountTotalPaise) lr('Discount', `−${money(inv.discountTotalPaise)}`);
    if (inv.taxPaise) lr(`${s.taxLabel} ${inv.taxRateBps / 100}%`, money(inv.taxPaise));
    lr('TOTAL', money(inv.totalPaise), true, 10);
    if (inv.returnedAmountPaise) lr('Returned', `−${money(inv.returnedAmountPaise)}`);
    lr('Paid', money(inv.amountPaidPaise - inv.amountRefundedPaise));
    lr('Balance', money(inv.outstandingPaise), true);
    lr('Status', inv.status === 'VOID' ? 'Void' : PAYMENT_STATUS_LABELS[inv.paymentStatus]);
    const methods = [...new Set(inv.payments.filter((p) => p.direction === 'IN').map((p) => PAYMENT_METHOD_LABELS[p.method]))];
    if (methods.length) lr('Paid by', methods.join(', '));
    rule();
    if (s.invoiceFooter) center(s.invoiceFooter, 8);
    center(formatIstDate(new Date()), 6);
    return toBuffer(doc);
  }

  // ------------------------------------------------------ customer statement
  async statement(data: StatementData, s: ShopSettings): Promise<Buffer> {
    const doc = this.newDoc({ size: 'A4', margin: 40, info: { Title: `Statement ${data.customer.name}` } });
    const left = 40;
    const W = doc.page.width - 80;
    doc.font('bold').fontSize(16).fillColor('#111').text(s.shopName, left, 40);
    doc.font('regular').fontSize(9).fillColor('#444').text(s.address || '', { width: W });
    doc.font('bold').fontSize(14).fillColor(s.brandColor || '#F97316').text('CUSTOMER STATEMENT', left, 40, { width: W, align: 'right' });
    doc.font('regular').fontSize(9).fillColor('#333').text(`${formatIstDate(data.from)} – ${formatIstDate(data.to)}`, { width: W, align: 'right' });
    doc.moveDown(2);
    doc.font('bold').fontSize(11).fillColor('#111').text(data.customer.name, left);
    doc.font('regular').fontSize(9);
    if (data.customer.phone) doc.text(`Mobile: ${data.customer.phone}`);
    if (data.customer.address) doc.text(data.customer.address);
    doc.moveDown();

    const cols = [80, W - 80 - 90 - 90 - 95, 90, 90, 95];
    const heads = ['Date', 'Description', 'Billed', 'Paid', 'Balance'];
    let y = doc.y;
    const drawRow = (vals: string[], bold = false) => {
      let x = left;
      doc.font(bold ? 'bold' : 'regular').fontSize(9).fillColor('#111');
      let h = 0;
      vals.forEach((v, i) => {
        doc.text(v, x + 2, y, { width: cols[i] - 4, align: i >= 2 ? 'right' : 'left' });
        h = Math.max(h, doc.heightOfString(v, { width: cols[i] - 4 }));
        x += cols[i];
      });
      y += h + 6;
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 40;
      }
    };
    doc.rect(left, y - 2, W, 16).fill('#F3F4F6');
    drawRow(heads, true);
    let balance = data.openingBalancePaise;
    drawRow([formatIstDate(data.from), 'Opening balance', '', '', money(balance)]);
    let billed = 0;
    let paid = 0;
    for (const e of data.entries) {
      balance += e.debitPaise - e.creditPaise;
      billed += e.debitPaise;
      paid += e.creditPaise;
      drawRow([e.date, e.description, e.debitPaise ? money(e.debitPaise) : '', e.creditPaise ? money(e.creditPaise) : '', money(balance)]);
    }
    doc.moveTo(left, y).lineTo(left + W, y).strokeColor('#9CA3AF').stroke();
    y += 4;
    drawRow(['', 'Closing balance', money(billed), money(paid), money(balance)], true);
    return toBuffer(doc);
  }
}
