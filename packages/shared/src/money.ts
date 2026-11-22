/**
 * Money helpers. All amounts are integer paise. Percentages are integer basis points (bps).
 * Never use floating point for stored or summed money.
 */

export const PAISE_PER_RUPEE = 100;
export const BPS_100_PERCENT = 10_000;

export function assertPaise(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of paise`);
  }
}

/** Round half up (away from zero for positives) of numerator/denominator, integers only. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  if (numerator < 0) return -divRoundHalfUp(-numerator, denominator);
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/** round_half_up(base × bps / 10000) in integer arithmetic. */
export function percentOf(basePaise: number, bps: number): number {
  assertPaise(basePaise, 'base');
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError('bps must be a non-negative integer');
  return divRoundHalfUp(basePaise * bps, BPS_100_PERCENT);
}

/**
 * Parse a rupee amount (number or string like "12.5", "1,250.75", "₹ 99") into integer paise.
 * Rejects more than 2 decimal places and negative values.
 */
export function rupeesToPaise(input: string | number): number {
  const raw = typeof input === 'number' ? input.toString() : input;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new RangeError(`Invalid rupee amount: "${raw}"`);
  }
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * PAISE_PER_RUPEE + Number(frac.padEnd(2, '0'));
  assertPaise(paise);
  return paise;
}

/** Safe variant returning null on invalid input. */
export function tryRupeesToPaise(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  try {
    return rupeesToPaise(input);
  } catch {
    return null;
  }
}

/** Convert a percent value (e.g. 12.5) into bps (1250). Max 2 decimals. */
export function percentToBps(percent: string | number): number {
  const raw = typeof percent === 'number' ? percent.toString() : percent.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new RangeError(`Invalid percent: "${raw}"`);
  const [whole, frac = ''] = raw.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/** Fixed two-decimal string without grouping, e.g. 123450 → "1234.50" (for CSV/inputs). */
export function paiseToDecimalString(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Indian grouping: 12345678 → "1,23,456.78" style for the whole-rupee part. */
function groupIndian(whole: number): string {
  const s = String(whole);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/**
 * Format paise as INR: 123450 → "₹1,234.50". With `compact` hides ".00" (₹20 instead of ₹20.00).
 * Implemented without Intl so it is identical on Hermes, Node and browsers.
 */
export function formatINR(paise: number, opts: { compact?: boolean; symbol?: boolean } = {}): string {
  const { compact = false, symbol = true } = opts;
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracStr = compact && frac === 0 ? '' : `.${String(frac).padStart(2, '0')}`;
  return `${negative ? '−' : ''}${symbol ? '₹' : ''}${groupIndian(whole)}${fracStr}`;
}

/**
 * Split `total` across `weights` proportionally using the largest-remainder method so that
 * the parts are non-negative integers summing exactly to `total`. Ties go to the earliest index.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  assertPaise(total, 'total');
  if (total < 0) throw new RangeError('total must be non-negative');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError('cannot allocate to zero parts');
    return [];
  }
  if (sum <= 0) {
    if (total !== 0) throw new RangeError('cannot allocate a positive total to zero weights');
    return weights.map(() => 0);
  }
  // BigInt: total × weight can exceed Number.MAX_SAFE_INTEGER on large bills.
  const T = BigInt(total);
  const S = BigInt(sum);
  const base = weights.map((w) => (T * BigInt(w)) / S);
  const remainders = weights.map((w, i) => ({ i, r: T * BigInt(w) - base[i] * S }));
  let left = Number(T - base.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map((b) => Number(b));
  for (let k = 0; left > 0; k++, left--) out[remainders[k % remainders.length].i] += 1;
  return out;
}
