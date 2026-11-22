'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { paiseToDecimalString, tryRupeesToPaise, type Product } from '@kite/shared';
import { Button, Field, Input } from '@/components/ui/core';
import { MoneyInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { ProductPicker } from './product-picker';

interface Line {
  product: { id: string; name: string; sku: string; availableQuantity: number };
  quantity: string;
  cost: string;
}

/** Stock receipt without a supplier purchase (e.g. stock brought from home store). */
export function ReceiveDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Line['product'] & { purchasePricePaise?: number } }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setLines(initial ? [{ product: initial, quantity: '', cost: initial.purchasePricePaise ? paiseToDecimalString(initial.purchasePricePaise) : '' }] : []);
      setReason('');
    }
  }, [open, initial]);

  const add = (p: Product) =>
    setLines((l) => (l.some((x) => x.product.id === p.id) ? l : [...l, { product: p, quantity: '', cost: p.purchasePricePaise !== undefined ? paiseToDecimalString(p.purchasePricePaise) : '' }]));
  const valid = lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.receive(
        lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity), unitCostPaise: tryRupeesToPaise(l.cost) ?? undefined })),
        reason || undefined,
      ),
    onSuccess: (r) => {
      toast.success(`Stock received (${r.referenceNumber})`);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Receive stock"
      description="Adds stock and records a receipt in the stock ledger. Use Purchases to record supplier bills."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!valid} loading={save.isPending}>
            Receive {lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) || ''} units
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ProductPicker onPick={add} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="grid grid-cols-[1fr_6rem_8rem_auto] items-end gap-2">
            <div className="pb-2 text-sm">
              <div className="font-medium">{l.product.name}</div>
              <div className="text-xs text-ink-500">
                {l.product.sku} · now {l.product.availableQuantity}
              </div>
            </div>
            <Field label="Qty">
              <Input type="number" min={1} value={l.quantity} autoFocus={i === lines.length - 1} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            </Field>
            <Field label="Unit cost">
              <MoneyInput value={l.cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} />
            </Field>
            <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 />
            </Button>
          </div>
        ))}
        <Field label="Note (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Transferred from godown" />
        </Field>
      </div>
    </Dialog>
  );
}
