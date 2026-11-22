/** IST (Asia/Kolkata, UTC+05:30, no DST) date helpers that do not depend on device timezone. */
export const IST_OFFSET_MINUTES = 330;
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/** YYYY-MM-DD of the given instant in IST. */
export function istDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(ymd: string): boolean {
  if (!DATE_PATTERN.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

export type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30';

export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  const today = istDateString(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jan 2027, 10:32 AM" in IST. */
export function formatIstDateTime(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MINUTES * 60_000);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "14 Jan 2027" from YYYY-MM-DD or an instant (IST). */
export function formatIstDate(value: string | Date): string {
  const ymd = typeof value === 'string' && DATE_PATTERN.test(value) ? value : istDateString(new Date(value));
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "10:32 AM" IST. */
export function formatIstTime(iso: string | Date): string {
  return formatIstDateTime(iso).split(', ')[1];
}
