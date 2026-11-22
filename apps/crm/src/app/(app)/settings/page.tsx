'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, CheckCircle2, ImagePlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { percentToBps, type Season, type ShopSettings } from '@kite/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Skeleton, Switch, Textarea } from '@/components/ui/core';
import { PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { date } from '@/lib/utils';

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });
  if (settings.isLoading || !settings.data) return <Skeleton className="h-96" />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Shop settings" description="Shop profile, invoice branding, tax, discount limits and seasons." />
      <Tabs defaultValue="shop">
        <TabsList className="mb-6">
          <TabsTrigger value="shop">Shop & invoice</TabsTrigger>
          <TabsTrigger value="rules">Billing rules</TabsTrigger>
          <TabsTrigger value="seasons">Seasons</TabsTrigger>
        </TabsList>
        <TabsContent value="shop">
          <ShopTab s={settings.data} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab s={settings.data} />
        </TabsContent>
        <TabsContent value="seasons">
          <SeasonsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ShopSettings>) => api.settings.update(body),
    onSuccess: (s) => (qc.setQueryData(['settings'], s), toast.success('Settings saved')),
  });
}

function ShopTab({ s }: { s: ShopSettings }) {
  const save = useSave();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({ shopName: s.shopName, address: s.address, phone: s.phone, email: s.email ?? '', invoicePrefix: s.invoicePrefix, invoiceTitle: s.invoiceTitle, invoiceFooter: s.invoiceFooter ?? '', brandColor: s.brandColor });
  const logo = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.settings.uploadLogo(fd);
    },
    onSuccess: (r) => (qc.setQueryData(['settings'], r), toast.success('Logo updated')),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader title="Shop profile & invoice" description="Shown on every printed or shared bill." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Shop name" className="sm:col-span-2">
          <Input value={v.shopName} onChange={set('shopName')} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea value={v.address} onChange={set('address')} rows={2} />
        </Field>
        <Field label="Phone">
          <Input value={v.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <Input value={v.email} onChange={set('email')} />
        </Field>
        <Field label="Invoice number prefix" hint={`Bills look like ${v.invoicePrefix || 'KITE'}-2026-000001. Changing it starts a new series; old numbers never change.`}>
          <Input value={v.invoicePrefix} onChange={(e) => setV((x) => ({ ...x, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }))} />
        </Field>
        <Field label="Invoice title" hint="“Tax Invoice” is only used when tax and GSTIN are configured.">
          <Input value={v.invoiceTitle} onChange={set('invoiceTitle')} />
        </Field>
        <Field label="Invoice footer" className="sm:col-span-2">
          <Input value={v.invoiceFooter} onChange={set('invoiceFooter')} placeholder="Thank you! Happy Uttarayan!" />
        </Field>
        <Field label="Brand colour">
          <div className="flex items-center gap-2">
            <input type="color" value={v.brandColor} onChange={set('brandColor')} className="h-10 w-14 cursor-pointer rounded-lg border border-ink-200" aria-label="Brand colour" />
            <Input value={v.brandColor} onChange={set('brandColor')} className="w-32" />
          </div>
        </Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.logoUrl && <img src={s.logoUrl} alt="Shop logo" className="size-12 rounded-lg object-contain ring-1 ring-ink-200" />}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={logo.isPending}>
              <ImagePlus /> Upload
            </Button>
          </div>
        </Field>
      </div>
      <div className="flex justify-end border-t border-ink-100 p-4">
        <Button onClick={() => save.mutate({ ...v, email: v.email || null, invoiceFooter: v.invoiceFooter || null })} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}

function RulesTab({ s }: { s: ShopSettings }) {
  const save = useSave();
  const [cap, setCap] = useState(String(s.salespersonMaxDiscountBps / 100));
  const [minAlert, setMinAlert] = useState(String(s.defaultMinStockAlert));
  const [phoneForCredit, setPhoneForCredit] = useState(s.requireCustomerPhoneForCredit);
  const [taxEnabled, setTaxEnabled] = useState(s.taxEnabled);
  const [taxRate, setTaxRate] = useState(String(s.taxRateBps / 100));
  const [taxLabel, setTaxLabel] = useState(s.taxLabel);
  const [gstin, setGstin] = useState(s.gstin ?? '');
  const submit = () => {
    try {
      save.mutate({
        salespersonMaxDiscountBps: percentToBps(cap || '0'),
        defaultMinStockAlert: Number(minAlert) || 0,
        requireCustomerPhoneForCredit: phoneForCredit,
        taxEnabled,
        taxRateBps: percentToBps(taxRate || '0'),
        taxLabel,
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Discounts & credit" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Salesperson discount cap (%)" hint="Discounts above this need an admin's username & password on the phone.">
            <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Default low-stock alert" hint="Used for new products">
            <Input value={minAlert} onChange={(e) => setMinAlert(e.target.value)} type="number" min={0} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
            <span>
              <span className="font-medium">Require mobile number for credit bills</span>
              <span className="block text-xs text-ink-500">A customer name is always required for unpaid or partly paid bills.</span>
            </span>
            <Switch checked={phoneForCredit} onCheckedChange={setPhoneForCredit} />
          </label>
        </div>
      </Card>
      <Card>
        <CardHeader title="Tax" description="Leave off unless the shop is registered and your accountant confirms the rate." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
            <span className="font-medium">Add tax to bills</span>
            <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
          </label>
          {taxEnabled && (
            <>
              <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2">
                <AlertTriangle className="size-4 shrink-0" /> Tax is added on top of the discounted price at a single rate. Bills are titled “Tax Invoice” only when a GSTIN is entered. Confirm the correct HSN rates and invoice format with your accountant.
              </div>
              <Field label="Tax label">
                <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} />
              </Field>
              <Field label="Rate (%)">
                <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="GSTIN" className="sm:col-span-2">
                <Input value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} className="uppercase" />
              </Field>
            </>
          )}
        </div>
      </Card>
      <div className="flex justify-end">
        <Button onClick={submit} loading={save.isPending}>
          Save billing rules
        </Button>
      </div>
    </div>
  );
}

function SeasonsTab() {
  const qc = useQueryClient();
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.settings.seasons() });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', code: '', startsOn: '', endsOn: '', invoiceSeries: '' });
  useEffect(() => {
    if (open) setF({ name: '', code: '', startsOn: '', endsOn: '', invoiceSeries: '' });
  }, [open]);
  const create = useMutation({ mutationFn: () => api.settings.createSeason(f), onSuccess: () => (setOpen(false), qc.invalidateQueries({ queryKey: ['seasons'] }), toast.success('Season added')) });
  const activate = useMutation({ mutationFn: (s: Season) => api.settings.activateSeason(s.id), onSuccess: () => (qc.invalidateQueries({ queryKey: ['seasons'] }), toast.success('Active season changed')) });
  return (
    <Card>
      <CardHeader
        title="Seasons"
        description="Each season can have its own invoice number series (e.g. KITE-2026-…, KITE-2027-…). Switching never renumbers old bills."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Add season
          </Button>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>Season</Th>
            <Th>Dates</Th>
            <Th>Invoice series</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {seasons.data?.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">
                <CalendarRange className="mr-2 inline size-4 text-ink-400" />
                {s.name}
              </Td>
              <Td>
                {date(s.startsOn)} – {date(s.endsOn)}
              </Td>
              <Td className="font-mono text-xs">{s.invoiceSeries}</Td>
              <Td align="right">
                {s.isActive ? (
                  <Badge tone="green">
                    <CheckCircle2 className="size-3" /> Active
                  </Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => activate.mutate(s)} loading={activate.isPending && activate.variables?.id === s.id}>
                    Make active
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen} title="Add season" footer={<Button onClick={() => create.mutate()} loading={create.isPending}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Uttarayan 2027–28" />
          </Field>
          <Field label="Code">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="UTR-2027" />
          </Field>
          <Field label="Invoice series">
            <Input value={f.invoiceSeries} onChange={(e) => setF({ ...f, invoiceSeries: e.target.value.toUpperCase() })} placeholder="2027" />
          </Field>
          <Field label="Starts on">
            <Input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </Field>
          <Field label="Ends on">
            <Input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
