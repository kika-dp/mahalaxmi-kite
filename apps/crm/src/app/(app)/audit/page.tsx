'use client';
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, Input } from '@/components/ui/core';
import { EmptyState, PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect } from '@/components/ui/inputs';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

const ACTIONS = [
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGIN_LOCKED',
  'AUTH_REFRESH_REUSE',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'SESSIONS_REVOKED',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'PRODUCT_PRICE_CHANGED',
  'PRODUCT_ARCHIVED',
  'PRODUCTS_IMPORTED',
  'STOCK_RECEIVED',
  'STOCK_ADJUSTED',
  'STOCK_ADJUSTMENT_REQUESTED',
  'ADJUSTMENT_APPROVED',
  'ADJUSTMENT_REJECTED',
  'STOCK_COUNT_COMPLETED',
  'INVOICE_CREATED',
  'DISCOUNT_OVERRIDE',
  'DISCOUNT_APPROVAL_FAILED',
  'PAYMENT_RECORDED',
  'RETURN_CREATED',
  'REFUND_RECORDED',
  'INVOICE_VOIDED',
  'PURCHASE_CREATED',
  'SUPPLIER_PAYMENT',
  'CASH_SESSION_CLOSED',
  'CASH_SESSION_REOPENED',
  'SETTINGS_UPDATED',
];

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const params = { action, entityType, from, to, page, pageSize: 50 };
  const list = useQuery({ queryKey: ['audit', params], queryFn: () => api.audit.list(params), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Audit log" description="Append-only record of sign-ins and every privileged, stock or money action." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
          <FilterSelect value={action} onChange={(v) => (setAction(v), setPage(1))} placeholder="All actions" options={ACTIONS.map((a) => ({ value: a, label: a.replaceAll('_', ' ').toLowerCase() }))} />
          <FilterSelect
            value={entityType}
            onChange={(v) => (setEntityType(v), setPage(1))}
            placeholder="All records"
            options={['invoice', 'product', 'user', 'stock_adjustment', 'stock_count', 'purchase', 'supplier', 'customer', 'cash_session', 'settings'].map((e) => ({ value: e, label: e.replace('_', ' ') }))}
          />
          <Input type="date" className="h-10 w-40" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="From" />
          <Input type="date" className="h-10 w-40" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="To" />
        </div>
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Record</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : (
            <tbody>
              {list.data?.data.map((a) => (
                <Fragment key={a.id}>
                  <Tr onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <Td>{open === a.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Td>
                    <Td className="whitespace-nowrap text-xs">{dateTime(a.createdAt)}</Td>
                    <Td>{a.actorUsername ?? '—'}</Td>
                    <Td className="font-medium text-ink-900">{a.action.replaceAll('_', ' ').toLowerCase()}</Td>
                    <Td className="text-xs text-ink-500">{a.entityType ? `${a.entityType} ${a.entityId?.slice(0, 8) ?? ''}` : '—'}</Td>
                    <Td className="text-xs text-ink-500">{a.ip ?? '—'}</Td>
                  </Tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={6} className="bg-ink-50 px-6 py-4">
                        <div className="grid gap-4 text-xs md:grid-cols-3">
                          {(['before', 'after', 'metadata'] as const).map((k) => (
                            <div key={k}>
                              <p className="mb-1 font-semibold uppercase text-ink-500">{k}</p>
                              <pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 ring-1 ring-ink-200">{a[k] ? JSON.stringify(a[k], null, 2) : '—'}</pre>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          )}
        </Table>
        {list.data?.data.length === 0 && <EmptyState title="No audit entries" />}
        {list.data && <Pagination page={page} pageSize={50} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
