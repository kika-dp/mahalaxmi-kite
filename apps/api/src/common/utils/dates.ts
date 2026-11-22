import { addDays, isValidYmd, istDateString } from '@kite/shared';
import { Errors } from '../errors';

/** Business timezone expression used in SQL. */
export const IST = `'Asia/Kolkata'`;

/** SQL expression: IST business date of a timestamptz column. */
export const istDate = (col: string) => `((${col}) AT TIME ZONE ${IST})::date`;

export interface ResolvedRange {
  from: string;
  to: string;
  /** inclusive start instant (UTC) */
  start: Date;
  /** exclusive end instant (UTC) */
  end: Date;
}

/** Convert IST YYYY-MM-DD bounds into a [start, end) UTC instant range. Defaults to today. */
export function resolveRange(from?: string, to?: string, maxDays = 1100): ResolvedRange {
  const today = istDateString();
  const f = from ?? to ?? today;
  const t = to ?? from ?? today;
  if (!isValidYmd(f) || !isValidYmd(t)) throw Errors.validation('Invalid date');
  if (f > t) throw Errors.validation('"from" must be on or before "to"');
  const days = (Date.parse(t) - Date.parse(f)) / 86_400_000;
  if (days > maxDays) throw Errors.validation(`Date range too large (max ${maxDays} days)`);
  return {
    from: f,
    to: t,
    start: new Date(`${f}T00:00:00+05:30`),
    end: new Date(`${addDays(t, 1)}T00:00:00+05:30`),
  };
}
