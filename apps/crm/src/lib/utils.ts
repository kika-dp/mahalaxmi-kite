import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatINR, formatIstDate, formatIstDateTime } from '@kite/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const inr = (paise: number | null | undefined, compact = false) => (paise === null || paise === undefined ? '—' : formatINR(paise, { compact }));
export const dateTime = (iso: string | null | undefined) => (iso ? formatIstDateTime(iso) : '—');
export const date = (v: string | null | undefined) => (v ? formatIstDate(v) : '—');
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN'));
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
