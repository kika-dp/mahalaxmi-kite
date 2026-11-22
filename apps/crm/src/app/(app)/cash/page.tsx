'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Lock, Plus, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { formatIstDate, Permission, tryRupeesToPaise, type CashSummary } from '@kite/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Skeleton } from '@/components/ui/core';
import { EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui/data';
import { MoneyInput } from '@/components/ui/inputs';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, inr } from '@/lib/utils';

function SummaryTable({ s, counted, difference }: { s: CashSummary; counted?: number | null; difference?: number | null }) {
  const rows: [string, number, string?][] = [
    ['Opening cash', s.openingCashPaise],
    ['+ Cash sales collected', s.cashSalesPaise],
    ['+ Other cash receipts', s.otherReceiptsPaise],
    ['− Cash refunds', -s.cashRefundsPaise],
    ['− Expenses & payouts', -s.payoutsPaise],
  ];
  return (
    <dl className="divide-y divide-ink-100 text-sm">
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between px-5 py-2.5">
          <dt className="text-ink-600">{l}</dt>
          <dd className="tnum">{inr(v)}</dd>
        </div>
      ))}
      <div className="flex justify-between bg-ink-50 px-5 py-3 text-base font-semibold">
        <dt>Expected cash in drawer</dt>
        <dd className="tnum">{inr(s.expectedCashPaise)}</dd>
      </div>
      {counted !== undefined && counted !== null && (
        <>
          <div className="flex justify-between px-5 py-2.5">
            <dt className="text-ink-600">Actual counted</dt>
            <dd className="tnum">{inr(counted)}</dd>
          </div>
          <div className={`flex justify-between px-5 py-3 font-semibold ${difference === 0 ? 'text-green-700' : 'text-red-600'}`}>
            <dt>Difference</dt>
            <dd className="tnum">{difference! > 0 ? '+' : ''}{inr(difference!)}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

export default function CashPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const today = useQuery({ queryKey: ['cash', 'today'], queryFn: () => api.cash.today(), refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['cash', 'history'], queryFn: () => api.cash.list({ pageSize: 30 }) });
  const [opening, setOpening] = useState('');
  const [mv, setMv] = useState<{ type: string; amount: string; reason: string } | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [reopen, setReopen] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash'] });

  const open = useMutation({ mutationFn: () => api.cash.open(tryRupeesToPaise(opening || '0')!), onSuccess: () => (toast.success('Cash session opened'), refresh()) });
  const addMv = useMutation({ mutationFn: () => api.cash.movement(today.data!.session!.id, { type: mv!.type, amountPaise: tryRupeesToPaise(mv!.amount)!, reason: mv!.reason }), onSuccess: () => (setMv(null), refresh()) });
  const close = useMutation({ mutationFn: () => api.cash.close(today.data!.session!.id, tryRupeesToPaise(counted)!), onSuccess: () => (setCloseOpen(false), toast.success('Day closed'), refresh()) });
  const doReopen = useMutation({ mutationFn: () => api.cash.reopen(reopen!, reopenReason), onSuccess: () => (setReopen(null), refresh()) });

  if (today.isLoading) return <Skeleton className="h-96" />;
  const session = today.data?.session;
  const s = today.data?.preview;

  return (
    <div className="space-y-6">
      <PageHeader title="Daily cash closing" description="Expected cash comes only from recorded cash payments — unpaid bills never count as cash." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={`Today · ${formatIstDate(new Date())}`}
            description={session ? `Opened ${dateTime(session.openedAt)} by ${session.openedBy.fullName}` : 'Not opened yet — billing still works.'}
            action={session && <Badge tone={session.status === 'OPEN' ? 'green' : 'neutral'}>{session.status.toLowerCase()}</Badge>}
          />
          {!session ? (
            <form className="flex flex-wrap items-end gap-3 p-5" onSubmit={(e) => (e.preventDefault(), open.mutate())}>
              <Field label="Opening cash in drawer" className="w-48">
                <MoneyInput value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
              </Field>
              <Button type="submit" loading={open.isPending}>
                <Unlock /> Open today
              </Button>
            </form>
          ) : (
            <SummaryTable s={session.summary} counted={session.countedCashPaise} difference={session.differencePaise} />
          )}
          {session?.status === 'OPEN' && (
            <div className="flex flex-wrap gap-2 border-t border-ink-100 p-4">
              <Button variant="secondary" onClick={() => setMv({ type: 'EXPENSE', amount: '', reason: '' })}>
                <Plus /> Expense / payout
              </Button>
              <Button variant="secondary" onClick={() => setMv({ type: 'OTHER_RECEIPT', amount: '', reason: '' })}>
                <Plus /> Other cash received
              </Button>
              <Button className="ml-auto" onClick={() => (setCounted(''), setCloseOpen(true))}>
                <Lock /> Close the day
              </Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Other collections today" />
          {s && (
            <dl className="divide-y divide-ink-100 text-sm">
              {[
                ['UPI', s.upiPaise],
                ['Card', s.cardPaise],
                ['Other', s.otherMethodPaise],
                ['Bills today', null, `${s.billsCount} · ${inr(s.billsValuePaise)}`],
                ['Pending customer payments (all)', s.pendingCustomerPaymentsPaise],
              ].map(([l, v, t]) => (
                <div key={l as string} className="flex justify-between px-5 py-2.5">
                  <dt className="text-ink-600">{l}</dt>
                  <dd className="tnum">{(t as string) ?? inr(v as number)}</dd>
                </div>
              ))}
            </dl>
          )}
          {session && session.movements.length > 0 && (
            <div className="border-t border-ink-100 p-5">
              <p className="mb-2 text-xs font-semibold uppercase text-ink-500">Cash movements</p>
              <ul className="space-y-1.5 text-sm">
                {session.movements.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>
                      {m.reason} <span className="text-xs text-ink-400">({m.type.replace('_', ' ').toLowerCase()})</span>
                    </span>
                    <span className="tnum">{m.type === 'OTHER_RECEIPT' ? '+' : '−'}{inr(m.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Previous days" />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Opening</Th>
              <Th align="right">Cash sales</Th>
              <Th align="right">Expected</Th>
              <Th align="right">Counted</Th>
              <Th align="right">Difference</Th>
              <Th>Closed by</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {history.data?.data.map((h) => (
              <Tr key={h.id}>
                <Td className="font-medium">{formatIstDate(h.businessDate)}</Td>
                <Td align="right">{inr(h.openingCashPaise)}</Td>
                <Td align="right">{inr(h.summary.cashSalesPaise)}</Td>
                <Td align="right">{inr(h.expectedCashPaise ?? h.summary.expectedCashPaise)}</Td>
                <Td align="right">{inr(h.countedCashPaise)}</Td>
                <Td align="right" className={h.differencePaise ? 'font-semibold text-red-600' : 'text-green-700'}>{h.differencePaise === null ? '—' : inr(h.differencePaise)}</Td>
                <Td className="text-xs">{h.closedBy?.fullName ?? <Badge tone="green">open</Badge>}</Td>
                <Td align="right">
                  {h.status === 'CLOSED' && can(Permission.CASH_REOPEN) && (
                    <Button size="sm" variant="ghost" onClick={() => (setReopenReason(''), setReopen(h.id))}>
                      Reopen
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {history.data?.data.length === 0 && <EmptyState icon={<Banknote className="size-6" />} title="No closed days yet" />}
      </Card>

      <Dialog
        open={!!mv}
        onOpenChange={(o) => !o && setMv(null)}
        title={mv?.type === 'OTHER_RECEIPT' ? 'Other cash received' : 'Cash expense / payout'}
        footer={
          <Button onClick={() => addMv.mutate()} loading={addMv.isPending} disabled={!mv || !tryRupeesToPaise(mv.amount) || mv.reason.trim().length < 3}>
            Save
          </Button>
        }
      >
        {mv && (
          <div className="space-y-4">
            {mv.type !== 'OTHER_RECEIPT' && (
              <Field label="Type">
                <Select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}>
                  <option value="EXPENSE">Expense (tea, transport…)</option>
                  <option value="PAYOUT">Payout (cash taken out)</option>
                </Select>
              </Field>
            )}
            <Field label="Amount">
              <MoneyInput value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} autoFocus />
            </Field>
            <Field label="Reason">
              <Input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Close the day"
        description={session ? `Count the cash in the drawer. Expected: ${inr(session.summary.expectedCashPaise)}.` : undefined}
        footer={
          <Button onClick={() => close.mutate()} loading={close.isPending} disabled={tryRupeesToPaise(counted) === null}>
            Close day
          </Button>
        }
      >
        <Field
          label="Actual cash counted"
          hint={session && tryRupeesToPaise(counted) !== null ? `Difference: ${inr(tryRupeesToPaise(counted)! - session.summary.expectedCashPaise)}` : undefined}
        >
          <MoneyInput value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <ConfirmDialog open={!!reopen} onOpenChange={(o) => !o && setReopen(null)} title="Reopen this day?" description="The closing numbers will be cleared and must be counted again." confirmLabel="Reopen" tone="primary" loading={doReopen.isPending} onConfirm={() => (reopenReason.trim().length >= 3 ? doReopen.mutate() : toast.error('Enter a reason'))}>
        <Input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Reason (required)" aria-label="Reopen reason" />
      </ConfirmDialog>
    </div>
  );
}
