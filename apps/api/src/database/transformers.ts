import { ValueTransformer } from 'typeorm';

/** bigint (paise) ↔ JS number. Safe up to Number.MAX_SAFE_INTEGER paise. */
export const bigintNumber: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? v : Number(v)),
};
