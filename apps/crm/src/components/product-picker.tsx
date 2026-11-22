'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Product } from '@kite/shared';
import { Input } from '@/components/ui/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Typeahead for standard (stock-holding) products. */
export function ProductPicker({ onPick, kind = 'STANDARD', placeholder = 'Search product by name or SKU', className }: { onPick: (p: Product) => void; kind?: 'STANDARD' | 'BUNDLE' | ''; placeholder?: string; className?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const res = useQuery({
    queryKey: ['picker', kind, q],
    queryFn: () => api.catalog.products({ q, kind, isActive: true, pageSize: 8 }),
    enabled: q.trim().length >= 1,
  });
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <Input
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
      {open && q && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-ink-200 bg-white p-1 shadow-[var(--shadow-pop)]">
          {res.data?.data.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No matches</li>}
          {res.data?.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p);
                  setQ('');
                  setOpen(false);
                }}
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-ink-500">{p.sku}</span>
                </span>
                <span className="tnum text-xs text-ink-500">{p.availableQuantity} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
