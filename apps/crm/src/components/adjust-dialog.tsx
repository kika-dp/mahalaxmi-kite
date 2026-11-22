'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { adjustmentFormSchema, Permission, type AdjustmentForm } from '@kite/shared';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ProductPicker } from './product-picker';

const TYPES = [
  { value: 'ADJUSTMENT_IN', label: 'Add (found / correction up)' },
  { value: 'ADJUSTMENT_OUT', label: 'Remove (correction down)' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'LOST', label: 'Lost / missing' },
];

type Picked = { id: string; name: string; sku: string; availableQuantity: number };

export function AdjustDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Picked }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [product, setProduct] = useState<Picked | null>(null);
  const form = useForm<AdjustmentForm>({ resolver: zodResolver(adjustmentFormSchema), defaultValues: { productId: '', type: 'DAMAGED', quantity: 1, reason: '' } });
  useEffect(() => {
    if (open) {
      setProduct(initial ?? null);
      form.reset({ productId: initial?.id ?? '', type: 'DAMAGED', quantity: 1, reason: '' });
    }
  }, [open, initial, form]);

  const type = form.watch('type');
  const needsApproval = type !== 'ADJUSTMENT_IN' && !can(Permission.INVENTORY_APPROVE);
  const save = useMutation({
    mutationFn: (v: AdjustmentForm) => api.inventory.adjust({ productId: v.productId, type: v.type, quantity: Number(v.quantity), reason: v.reason }),
    onSuccess: (a) => {
      toast.success(a.status === 'PENDING' ? 'Sent for admin approval' : 'Stock adjusted');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['adjustments'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onOpenChange(false);
    },
  });
  const err = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust stock"
      description="Every adjustment is recorded with your name, the reason and the time."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
            {needsApproval ? 'Request approval' : 'Apply adjustment'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Product" error={err.productId?.message}>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{product.name}</span> <span className="text-ink-500">· {product.availableQuantity} in stock</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => (setProduct(null), form.setValue('productId', ''))}>
                Change
              </Button>
            </div>
          ) : (
            <ProductPicker onPick={(p) => (setProduct(p), form.setValue('productId', p.id, { shouldValidate: true }))} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select {...form.register('type')}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity" error={err.quantity?.message}>
            <Input type="number" min={1} {...form.register('quantity')} />
          </Field>
        </div>
        <Field label="Reason" error={err.reason?.message}>
          <Textarea {...form.register('reason')} placeholder="e.g. 6 kites torn in the rain" />
        </Field>
        {needsApproval && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Stock reductions by inventory managers apply after an admin approves them.</p>}
      </div>
    </Dialog>
  );
}
