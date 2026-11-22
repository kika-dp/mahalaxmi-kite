'use client';
import * as React from 'react';
import { Search } from 'lucide-react';
import { addDays, istDateString, presetRange, type DatePreset } from '@kite/shared';
import { cn } from '@/lib/utils';
import { Input, Select } from './core';

export interface DateRange {
  from: string;
  to: string;
}

const PRESETS: { key: DatePreset | 'season' | 'custom'; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
];

/** Date range with presets (IST dates). */
export function DateRangePicker({ value, onChange, season }: { value: DateRange; onChange: (r: DateRange) => void; season?: { from: string; to: string } | null }) {
  const presets = season ? [...PRESETS.slice(0, 4), { key: 'season' as const, label: 'This season' }, PRESETS[4]] : PRESETS;
  const active =
    presets.find((p) => {
      if (p.key === 'custom') return false;
      const r = p.key === 'season' ? season! : presetRange(p.key as DatePreset);
      return r.from === value.from && r.to === value.to;
    })?.key ?? 'custom';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-ink-200">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              if (p.key === 'custom') return onChange({ from: addDays(istDateString(), -13), to: istDateString() });
              onChange(p.key === 'season' ? season! : presetRange(p.key as DatePreset));
            }}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              active === p.key ? 'bg-night-900 text-white' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {active === 'custom' && (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From" className="h-9 w-36" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="text-ink-400">→</span>
          <Input type="date" aria-label="To" className="h-9 w-36" value={value.to} min={value.from} max={istDateString()} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  React.useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

/** Rupee input that keeps a string value ("12.50"). */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
    <Input ref={ref} inputMode="decimal" className={cn('pl-7 tnum', className)} {...props} />
  </div>
));
MoneyInput.displayName = 'MoneyInput';

export function FilterSelect({ value, onChange, options, placeholder, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string; className?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn('h-10 w-auto min-w-36', className)} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
