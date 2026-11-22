'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Layers, Package, PencilLine, Plus, Save, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { paiseToDecimalString, Permission, tryRupeesToPaise, UNIT_LABELS, type Product } from '@kite/shared';
import { Badge, Button, Card } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, StockBadge, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect, MoneyInput, SearchInput } from '@/components/ui/inputs';
import { Dialog } from '@/components/ui/overlay';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr } from '@/lib/utils';

type Sort = 'name' | 'price' | 'quantity' | 'updated';

export default function ProductsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState('');
  const [stock, setStock] = useState('');
  const [active, setActive] = useState('true');
  const [sort, setSort] = useState<{ by: Sort; dir: 'asc' | 'desc' }>({ by: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [bulk, setBulk] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const canWrite = can(Permission.CATALOG_WRITE);
  const canCost = can(Permission.CATALOG_VIEW_COST);

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories() });
  const params = { q, categoryId, kind, stock, isActive: active, sort: sort.by, order: sort.dir, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['products', params], queryFn: () => api.catalog.products(params), placeholderData: (p) => p });

  const save = useMutation({
    mutationFn: () => {
      const items = Object.entries(prices)
        .map(([productId, v]) => ({ productId, sellingPricePaise: tryRupeesToPaise(v) }))
        .filter((i): i is { productId: string; sellingPricePaise: number } => i.sellingPricePaise !== null);
      if (!items.length) throw new Error('No valid price changes');
      return api.catalog.bulkPrice(items);
    },
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} price${r.updated === 1 ? '' : 's'}`);
      setBulk(false);
      setPrices({});
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const toggleSort = (by: Sort) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' }));
  const sorted = (by: Sort) => (sort.by === by ? sort.dir : null);
  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        description="Kites, manjha, firki and accessories. Packets and combos deduct stock from their components."
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadFile('/products/export', 'products.csv')}>
              <Download /> Export CSV
            </Button>
            {canWrite && (
              <>
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  <FileUp /> Import CSV
                </Button>
                {bulk ? (
                  <>
                    <Button variant="ghost" onClick={() => (setBulk(false), setPrices({}))}>
                      <X /> Cancel
                    </Button>
                    <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(prices).length}>
                      <Save /> Save {Object.keys(prices).length || ''} prices
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setBulk(true)}>
                    <PencilLine /> Bulk edit prices
                  </Button>
                )}
                <Button asChild>
                  <Link href="/products/new">
                    <Plus /> Add product
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={reset(setQ)} placeholder="Search name, SKU or barcode" className="w-full sm:w-72" />
          <FilterSelect value={categoryId} onChange={reset(setCategoryId)} placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect value={kind} onChange={reset(setKind)} placeholder="All types" options={[{ value: 'STANDARD', label: 'Single items' }, { value: 'BUNDLE', label: 'Packets & combos' }]} />
          <FilterSelect value={stock} onChange={reset(setStock)} placeholder="Any stock" options={[{ value: 'in', label: 'In stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }]} />
          <FilterSelect value={active} onChange={reset(setActive)} placeholder="Active & inactive" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
        </div>
        <Table>
          <thead>
            <tr>
              <Th onClick={() => toggleSort('name')} sorted={sorted('name')}>Product</Th>
              <Th>Category</Th>
              <Th align="right" onClick={() => toggleSort('price')} sorted={sorted('price')}>Price</Th>
              {canCost && <Th align="right">Cost</Th>}
              <Th align="right" onClick={() => toggleSort('quantity')} sorted={sorted('quantity')}>Stock</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={canCost ? 6 : 5} />
          ) : (
            <tbody>
              {list.data?.data.map((p: Product) => (
                <Tr key={p.id} onClick={bulk ? undefined : () => router.push(`/products/${p.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="size-10 rounded-lg object-cover ring-1 ring-ink-200" />
                      ) : (
                        <div className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{p.kind === 'BUNDLE' ? <Layers className="size-4" /> : <Package className="size-4" />}</div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 font-medium text-ink-900">
                          {p.name}
                          {p.isFavorite && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Quick-sell favourite" />}
                        </div>
                        <div className="text-xs text-ink-500">
                          {p.sku} · {UNIT_LABELS[p.unitType]}
                          {p.kind === 'BUNDLE' && <Badge tone="violet" className="ml-1.5">Combo/Packet</Badge>}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>{p.categoryName}</Td>
                  <Td align="right">
                    {bulk ? (
                      <div className="ml-auto w-28" onClick={(e) => e.stopPropagation()}>
                        <MoneyInput
                          aria-label={`Price for ${p.name}`}
                          defaultValue={paiseToDecimalString(p.sellingPricePaise)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setPrices((m) => {
                              const next = { ...m };
                              if (tryRupeesToPaise(v) === p.sellingPricePaise) delete next[p.id];
                              else next[p.id] = v;
                              return next;
                            });
                          }}
                          className={prices[p.id] !== undefined ? (tryRupeesToPaise(prices[p.id]) === null ? 'border-red-500' : 'border-brand-500 bg-brand-50') : ''}
                        />
                      </div>
                    ) : (
                      inr(p.sellingPricePaise)
                    )}
                  </Td>
                  {canCost && <Td align="right" className="text-ink-500">{inr(p.purchasePricePaise)}</Td>}
                  <Td align="right">
                    {p.kind === 'BUNDLE' ? <span className="text-xs text-ink-500">{p.availableQuantity} sellable</span> : <StockBadge quantity={p.availableQuantity} min={p.minStockAlert} />}
                  </Td>
                  <Td>{p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data && list.data.data.length === 0 && (
          <EmptyState
            title={q || categoryId || stock ? 'No products match these filters' : 'No products yet'}
            description="Add your kites, manjha and firki to start billing."
            action={canWrite && <Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button>}
          />
        )}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.catalog.importCsv>> | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const f = file.current?.files?.[0];
      if (!f) throw new Error('Choose a CSV file first');
      const form = new FormData();
      form.append('file', f);
      return api.catalog.importCsv(form, dryRun);
    },
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun && !r.errors.length) {
        toast.success(`Imported: ${r.created} new, ${r.updated} updated`);
        qc.invalidateQueries({ queryKey: ['products'] });
      }
    },
  });
  const template = 'sku,name,category,unitType,sellingPrice,purchasePrice,mrp,minStockAlert,barcode,isActive,isFavorite,description,openingStock\nKITE-REG-10,Regular Kite,Regular Kites,PIECE,10,6,,200,,true,true,,1500\n';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (onOpenChange(o), setResult(null))}
      title="Import products from CSV"
      description="Rows are matched by SKU: existing products are updated, new SKUs are created. If any row has an error, nothing is imported."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => run.mutate(true)} loading={run.isPending && run.variables === true}>
            Check file
          </Button>
          <Button onClick={() => run.mutate(false)} loading={run.isPending && run.variables === false}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input ref={file} type="file" accept=".csv,text/csv" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700" onChange={() => setResult(null)} />
        <a className="text-sm text-brand-600 hover:underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="products-template.csv">
          Download template
        </a>
        <p className="text-xs text-ink-500">Prices are in rupees (e.g. 12.50). Category must match an existing category name. openingStock applies only to products without opening stock. Packets and combos must be created in the product form.</p>
        {result && (
          <div className="rounded-xl border border-ink-200 p-4 text-sm">
            <p className="font-medium">
              {result.rows} rows · {result.toCreate} new · {result.toUpdate} updates
              {!result.dryRun && !result.errors.length && ` — imported ✓`}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}
                    {e.field && ` (${e.field})`}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
