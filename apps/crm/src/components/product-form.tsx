'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ImagePlus, Layers, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  paiseToDecimalString,
  productFormSchema,
  tryRupeesToPaise,
  UNIT_TYPES,
  type Product,
  type ProductForm,
} from '@kite/shared';
import { ApiError } from '@kite/api-client';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { PageHeader } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { ConfirmDialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { inr } from '@/lib/utils';

const UNIT_NAMES: Record<string, string> = { PIECE: 'Piece', PACKET: 'Packet', BUNDLE: 'Bundle / combo', BOX: 'Box', DOZEN: 'Dozen', ROLL: 'Roll' };

function toForm(p?: Product): ProductForm {
  return {
    name: p?.name ?? '',
    sku: p?.sku ?? '',
    barcode: p?.barcode ?? '',
    categoryId: p?.categoryId ?? '',
    kind: p?.kind ?? 'STANDARD',
    unitType: p?.unitType ?? 'PIECE',
    description: p?.description ?? '',
    sellingPrice: p ? paiseToDecimalString(p.sellingPricePaise) : '',
    purchasePrice: p?.purchasePricePaise !== undefined && p.kind === 'STANDARD' ? paiseToDecimalString(p.purchasePricePaise) : '',
    mrp: p?.mrpPaise ? paiseToDecimalString(p.mrpPaise) : '',
    minStockAlert: p?.minStockAlert ?? 10,
    supplierId: p?.supplierId ?? '',
    isActive: p?.isActive ?? true,
    isFavorite: p?.isFavorite ?? false,
    favoriteOrder: p?.favoriteOrder ?? 0,
    openingStock: 0,
    bundleItems: p?.bundleItems?.map((b) => ({ componentProductId: b.componentProductId, quantity: b.quantity })) ?? [],
  };
}

export function ProductFormView({ product }: { product?: Product }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!product;
  const [confirmArchive, setConfirmArchive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories() });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list({ pageSize: 200 }) });
  const components = useQuery({ queryKey: ['products', 'standard-all'], queryFn: () => api.catalog.products({ kind: 'STANDARD', isActive: true, pageSize: 200 }) });

  const form = useForm<ProductForm>({ resolver: zodResolver(productFormSchema), defaultValues: toForm(product) });
  const { register, handleSubmit, watch, setValue, formState, setError, control } = form;
  const bundle = useFieldArray({ control, name: 'bundleItems' });
  const kind = watch('kind');
  const selling = tryRupeesToPaise(watch('sellingPrice'));
  const cost = tryRupeesToPaise(watch('purchasePrice'));
  const items = watch('bundleItems');
  const compById = useMemo(() => new Map((components.data?.data ?? []).map((c) => [c.id, c])), [components.data]);
  const bundleCost = items.reduce((s, i) => s + (compById.get(i.componentProductId)?.purchasePricePaise ?? 0) * (Number(i.quantity) || 0), 0);
  const effectiveCost = kind === 'BUNDLE' ? bundleCost : cost;
  const margin = selling && effectiveCost !== null && selling > 0 ? ((selling - effectiveCost) / selling) * 100 : null;

  useEffect(() => {
    if (!editing && kind === 'BUNDLE' && watch('unitType') === 'PIECE') setValue('unitType', 'PACKET');
  }, [kind, editing, setValue, watch]);

  const save = useMutation({
    mutationFn: async (v: ProductForm) => {
      const body = {
        name: v.name,
        sku: v.sku || undefined,
        barcode: v.barcode || null,
        categoryId: v.categoryId,
        unitType: v.unitType,
        description: v.description || null,
        sellingPricePaise: tryRupeesToPaise(v.sellingPrice)!,
        ...(v.kind === 'STANDARD' ? { purchasePricePaise: tryRupeesToPaise(v.purchasePrice) ?? 0 } : {}),
        mrpPaise: tryRupeesToPaise(v.mrp),
        ...(v.kind === 'STANDARD' ? { minStockAlert: Number(v.minStockAlert) } : {}),
        supplierId: v.supplierId || null,
        isActive: v.isActive,
        isFavorite: v.isFavorite,
        favoriteOrder: Number(v.favoriteOrder),
        ...(v.kind === 'BUNDLE' ? { bundleItems: v.bundleItems.map((b) => ({ componentProductId: b.componentProductId, quantity: Number(b.quantity) })) } : {}),
      };
      return editing
        ? api.catalog.updateProduct(product!.id, body)
        : api.catalog.createProduct({ ...body, kind: v.kind, ...(v.kind === 'STANDARD' && v.openingStock ? { openingStock: Number(v.openingStock) } : {}) });
    },
    meta: { silent: true },
    onSuccess: (p) => {
      toast.success(editing ? 'Product saved' : 'Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      if (!editing) router.replace(`/products/${p.id}`);
      else qc.setQueryData(['product', p.id], p);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        for (const [k, m] of Object.entries(e.fieldErrors())) setError(k.replace('PricePaise', 'Price') as keyof ProductForm, { message: m });
      }
      toast.error(e.message);
    },
  });

  const archive = useMutation({
    mutationFn: () => api.catalog.deleteProduct(product!.id),
    onSuccess: (r) => {
      toast.success(r.deleted ? 'Product deleted' : 'Product archived (it has sales history)');
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push('/products');
    },
  });

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.catalog.uploadImage(product!.id, form);
    },
    onSuccess: (p) => {
      toast.success('Image updated');
      qc.setQueryData(['product', p.id], p);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const err = formState.errors;
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <PageHeader
        back={
          <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
            <ArrowLeft className="size-4" /> Products
          </Link>
        }
        title={editing ? product!.name : 'Add product'}
        description={editing ? `${product!.sku} · ${product!.kind === 'BUNDLE' ? 'Packet / combo' : 'Single item'}` : 'Single items hold stock. Packets and combos sell from their components.'}
        actions={
          <>
            {editing && (
              <Button type="button" variant="secondary" onClick={() => setConfirmArchive(true)}>
                <Trash2 /> Archive
              </Button>
            )}
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create product'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {!editing && (
                <Field label="Type" className="sm:col-span-2">
                  <div className="grid grid-cols-2 gap-2">
                    {(['STANDARD', 'BUNDLE'] as const).map((k) => (
                      <label key={k} className={`cursor-pointer rounded-xl border p-3 text-sm ${kind === k ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200'}`}>
                        <input type="radio" value={k} className="sr-only" {...register('kind')} />
                        <span className="font-medium">{k === 'STANDARD' ? 'Single item' : 'Packet or combo'}</span>
                        <span className="mt-0.5 block text-xs text-ink-500">{k === 'STANDARD' ? 'Has its own stock (e.g. Regular Kite)' : 'Deducts stock of other items (e.g. Packet of 10)'}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="Product name" error={err.name?.message} className="sm:col-span-2" htmlFor="name">
                <Input id="name" {...register('name')} aria-invalid={!!err.name} placeholder="e.g. Designer Kite" />
              </Field>
              <Field label="Category" error={err.categoryId?.message} htmlFor="cat">
                <Select id="cat" {...register('categoryId')} aria-invalid={!!err.categoryId}>
                  <option value="">Select…</option>
                  {cats.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit" htmlFor="unit">
                <Select id="unit" {...register('unitType')}>
                  {UNIT_TYPES.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_NAMES[u]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="SKU" error={err.sku?.message} hint={editing ? undefined : 'Leave blank to auto-generate'} htmlFor="sku">
                <Input id="sku" {...register('sku')} className="uppercase" aria-invalid={!!err.sku} />
              </Field>
              <Field label="Barcode / QR (optional)" error={err.barcode?.message} htmlFor="barcode">
                <Input id="barcode" {...register('barcode')} placeholder="Scan or type" />
              </Field>
              <Field label="Description" className="sm:col-span-2" htmlFor="desc">
                <Textarea id="desc" {...register('description')} rows={2} />
              </Field>
            </div>
          </Card>

          {kind === 'BUNDLE' && (
            <Card>
              <CardHeader
                title="Components"
                description="Selling one of these deducts the quantities below from stock."
                action={
                  <Button type="button" size="sm" variant="secondary" onClick={() => bundle.append({ componentProductId: '', quantity: 1 })}>
                    <Plus /> Add item
                  </Button>
                }
              />
              <div className="space-y-3 p-5">
                {bundle.fields.length === 0 && <p className="text-sm text-ink-500">Add the single items included, e.g. “Regular Kite × 10”.</p>}
                {bundle.fields.map((f, i) => (
                  <div key={f.id} className="flex items-end gap-3">
                    <Field label={i === 0 ? 'Item' : ''} className="flex-1">
                      <Select {...register(`bundleItems.${i}.componentProductId`)}>
                        <option value="">Select item…</option>
                        {components.data?.data.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.sku}) — {c.availableQuantity} in stock
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={i === 0 ? 'Qty' : ''} className="w-24">
                      <Input type="number" min={1} {...register(`bundleItems.${i}.quantity`)} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" onClick={() => bundle.remove(i)} aria-label="Remove component">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {err.bundleItems && <p className="text-xs text-red-600">{err.bundleItems.message ?? err.bundleItems.root?.message}</p>}
                {items.length > 0 && (
                  <p className="flex items-center gap-2 text-sm text-ink-500">
                    <Layers className="size-4" /> Cost of components: <span className="tnum font-medium text-ink-900">{inr(bundleCost)}</span>
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Pricing" />
            <div className="space-y-4 p-5">
              <Field label="Selling price" error={err.sellingPrice?.message} htmlFor="price">
                <MoneyInput id="price" {...register('sellingPrice')} aria-invalid={!!err.sellingPrice} />
              </Field>
              {kind === 'STANDARD' && (
                <Field label="Purchase price (cost)" error={err.purchasePrice?.message} hint="Used for profit and inventory value" htmlFor="cost">
                  <MoneyInput id="cost" {...register('purchasePrice')} />
                </Field>
              )}
              <Field label="MRP (optional)" error={err.mrp?.message} htmlFor="mrp">
                <MoneyInput id="mrp" {...register('mrp')} />
              </Field>
              {margin !== null && (
                <div className="rounded-xl bg-ink-50 px-3 py-2 text-sm">
                  Margin <span className={`tnum font-semibold ${margin < 0 ? 'text-red-600' : 'text-green-700'}`}>{margin.toFixed(1)}%</span>
                  <span className="text-ink-500"> · profit {inr((selling ?? 0) - (effectiveCost ?? 0))} per {kind === 'BUNDLE' ? 'combo' : 'unit'}</span>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={kind === 'BUNDLE' ? 'Availability' : 'Stock'} />
            <div className="space-y-4 p-5">
              {editing && (
                <p className="text-sm">
                  {kind === 'BUNDLE' ? 'Can sell now: ' : 'In stock: '}
                  <Badge tone={product!.availableQuantity === 0 ? 'red' : product!.isLowStock ? 'amber' : 'green'}>{product!.availableQuantity}</Badge>
                  {kind === 'STANDARD' && (
                    <Link href={`/inventory/movements?productId=${product!.id}`} className="ml-2 text-xs text-brand-600 hover:underline">
                      History →
                    </Link>
                  )}
                </p>
              )}
              {kind === 'STANDARD' && (
                <>
                  <Field label="Low-stock alert at" error={err.minStockAlert?.message} htmlFor="min">
                    <Input id="min" type="number" min={0} {...register('minStockAlert')} />
                  </Field>
                  {!editing && (
                    <Field label="Opening stock" hint="Recorded in the stock ledger" htmlFor="open">
                      <Input id="open" type="number" min={0} {...register('openingStock')} />
                    </Field>
                  )}
                </>
              )}
              <Field label="Default supplier" htmlFor="sup">
                <Select id="sup" {...register('supplierId')}>
                  <option value="">None</option>
                  {suppliers.data?.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Point of sale" />
            <div className="space-y-4 p-5">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">Quick-sell favourite</span>
                  <span className="block text-xs text-ink-500">Shown as a big tile in the POS app</span>
                </span>
                <Switch checked={watch('isFavorite')} onCheckedChange={(v) => setValue('isFavorite', v, { shouldDirty: true })} />
              </label>
              {watch('isFavorite') && (
                <Field label="Tile order" htmlFor="fo">
                  <Input id="fo" type="number" min={0} {...register('favoriteOrder')} />
                </Field>
              )}
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">Active</span>
                  <span className="block text-xs text-ink-500">Inactive products cannot be billed</span>
                </span>
                <Switch checked={watch('isActive')} onCheckedChange={(v) => setValue('isActive', v, { shouldDirty: true })} />
              </label>
            </div>
          </Card>

          {editing && (
            <Card>
              <CardHeader title="Image" />
              <div className="p-5">
                {product!.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product!.imageUrl} alt={product!.name} className="mb-3 aspect-square w-full rounded-xl object-cover ring-1 ring-ink-200" />
                ) : null}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
                <Button type="button" variant="secondary" className="w-full" onClick={() => fileRef.current?.click()} loading={upload.isPending}>
                  <ImagePlus /> {product!.imageUrl ? 'Replace image' : 'Upload image'}
                </Button>
                <p className="mt-2 text-xs text-ink-500">JPEG, PNG or WebP, up to 2 MB.</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {editing && (
        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title={`Archive ${product!.name}?`}
          description="It will be hidden from the POS and can no longer be billed. Past bills keep their details. Products that were never used are deleted permanently."
          confirmLabel="Archive"
          loading={archive.isPending}
          onConfirm={() => archive.mutate()}
        />
      )}
    </form>
  );
}
