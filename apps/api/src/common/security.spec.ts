import { LoginRateLimiter } from '../modules/auth/login-rate-limiter';
import { sanitize } from '../modules/audit/audit.service';
import { invoiceTitle } from '../modules/documents/pdf.service';
import { requestHash } from '../modules/invoices/invoices.service';
import { detectImageType } from './utils/uploads';
import type { ShopSettings } from '@kite/shared';

describe('LoginRateLimiter', () => {
  it('allows 5 attempts per identifier per window, then blocks; resets after the window', () => {
    let now = 0;
    const l = new LoginRateLimiter(5, 30, 60_000, () => now);
    for (let i = 0; i < 5; i++) expect(l.attempt('1.1.1.1', 'seller01')).toBe(true);
    expect(l.attempt('1.1.1.1', 'seller01')).toBe(false);
    expect(l.attempt('1.1.1.1', 'seller02')).toBe(true); // different identifier
    now = 60_001;
    expect(l.attempt('1.1.1.1', 'seller01')).toBe(true);
  });
  it('caps attempts per IP across identifiers', () => {
    const l = new LoginRateLimiter(100, 3, 60_000, () => 0);
    expect([1, 2, 3, 4].map((i) => l.attempt('2.2.2.2', `u${i}`))).toEqual([true, true, true, false]);
  });
});

describe('audit sanitize', () => {
  it('redacts secrets at any depth', () => {
    expect(sanitize({ a: 1, password: 'x', nested: { refreshToken: 'y', ok: 'z' }, list: [{ passwordHash: 'h' }] })).toEqual({
      a: 1,
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', ok: 'z' },
      list: [{ passwordHash: '[REDACTED]' }],
    });
  });
});

describe('detectImageType', () => {
  it('trusts magic bytes only', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(detectImageType(Buffer.from('89504E470D0A1A0A', 'hex'))).toBe('png');
    expect(detectImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('webp');
    expect(detectImageType(Buffer.from('<svg></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('invoiceTitle', () => {
  const base = { taxEnabled: false, gstin: null, invoiceTitle: 'Invoice' } as unknown as ShopSettings;
  it('never says "Tax Invoice" unless tax is enabled AND a GSTIN is set', () => {
    expect(invoiceTitle(base)).toBe('Invoice');
    expect(invoiceTitle({ ...base, invoiceTitle: 'Tax Invoice' })).toBe('Invoice');
    expect(invoiceTitle({ ...base, taxEnabled: true })).toBe('Invoice');
    expect(invoiceTitle({ ...base, taxEnabled: true, gstin: '24ABCDE1234F1Z5' })).toBe('Tax Invoice');
    expect(invoiceTitle({ ...base, invoiceTitle: 'Bill of Supply' })).toBe('Bill of Supply');
  });
});

describe('requestHash', () => {
  it('is stable regardless of key order and ignores manager credentials', () => {
    const a = requestHash({ idempotencyKey: 'k', items: [{ productId: 'p', quantity: 1 }], payments: [{ method: 'CASH', amountPaise: 5 }] } as never);
    const b = requestHash({ payments: [{ amountPaise: 5, method: 'CASH' }], items: [{ quantity: 1, productId: 'p' }], idempotencyKey: 'other', discountApproval: { username: 'a', password: 'b' } } as never);
    expect(a).toBe(b);
    const c = requestHash({ idempotencyKey: 'k', items: [{ productId: 'p', quantity: 2 }] } as never);
    expect(c).not.toBe(a);
  });
});
