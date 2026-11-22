'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LogOut, MoreHorizontal, Pencil, Plus, Power, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@kite/api-client';
import {
  percentToBps,
  Permission,
  PRIVILEGED_ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  userFormSchema,
  type Role,
  type UserForm,
  type UserRecord,
} from '@kite/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui/core';
import { PageHeader, Pagination, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { FilterSelect, SearchInput } from '@/components/ui/inputs';
import { ConfirmDialog, Dialog, Menu } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, pct } from '@/lib/utils';

const ROLE_TONE = { SUPER_ADMIN: 'violet', ADMIN: 'brand', INVENTORY_MANAGER: 'blue', SALESPERSON: 'neutral' } as const;

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRecord | 'new' | null>(null);
  const [action, setAction] = useState<{ kind: 'reset' | 'toggle' | 'revoke'; user: UserRecord } | null>(null);
  const [tempPw, setTempPw] = useState('');
  const params = { q, role, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['users', params], queryFn: () => api.users.list(params), placeholderData: (p) => p });
  const manageAdmins = can(Permission.USERS_MANAGE_ADMINS);
  const canManage = (u: UserRecord) => manageAdmins || !PRIVILEGED_ROLES.includes(u.role);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const run = useMutation({
    mutationFn: async () => {
      const u = action!.user;
      if (action!.kind === 'reset') return api.users.resetPassword(u.id, tempPw);
      if (action!.kind === 'revoke') return api.users.revokeSessions(u.id);
      return u.isActive ? api.users.deactivate(u.id) : api.users.activate(u.id);
    },
    onSuccess: () => {
      toast.success({ reset: 'Password reset — share the temporary password securely', revoke: 'All sessions signed out', toggle: 'Updated' }[action!.kind]);
      setAction(null);
      setTempPw('');
      refresh();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & roles"
        description="Staff accounts. New and reset accounts must set their own password at first sign-in."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add user
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
          <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Search name, username, email" className="w-full sm:w-72" />
          <FilterSelect value={role} onChange={(v) => (setRole(v), setPage(1))} placeholder="All roles" options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Discount cap</Th>
              <Th>Last sign-in</Th>
              <Th align="right">Devices</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={7} />
          ) : (
            <tbody>
              {list.data?.data.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="font-medium text-ink-900">
                      {u.fullName} {u.id === me?.id && <span className="text-xs text-ink-400">(you)</span>}
                    </div>
                    <div className="text-xs text-ink-500">
                      @{u.username} · {u.email}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                  </Td>
                  <Td className="text-sm">{u.role === 'SALESPERSON' ? (u.maxDiscountBps !== null ? pct(u.maxDiscountBps) : 'Shop default') : '—'}</Td>
                  <Td className="text-xs">{dateTime(u.lastLoginAt)}</Td>
                  <Td align="right">{u.activeSessions}</Td>
                  <Td>
                    {!u.isActive ? <Badge>Disabled</Badge> : u.lockedUntil ? <Badge tone="red">Locked</Badge> : u.mustChangePassword ? <Badge tone="amber">Must set password</Badge> : <Badge tone="green">Active</Badge>}
                  </Td>
                  <Td align="right">
                    {canManage(u) && (
                      <Menu
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${u.username}`}>
                            <MoreHorizontal />
                          </Button>
                        }
                        items={[
                          { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(u) },
                          { label: 'Reset password', icon: <KeyRound />, onSelect: () => setAction({ kind: 'reset', user: u }) },
                          { label: 'Sign out all devices', icon: <LogOut />, onSelect: () => setAction({ kind: 'revoke', user: u }) },
                          'sep',
                          { label: u.isActive ? 'Disable account' : 'Enable account', icon: <Power />, danger: u.isActive, onSelect: () => setAction({ kind: 'toggle', user: u }), hidden: u.id === me?.id },
                        ]}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {list.data && <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />}
      </Card>

      <Card>
        <CardHeader title="Role permissions" description="Enforced by the server on every request." />
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="rounded-xl border border-ink-200 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-brand-600" />
                {ROLE_LABELS[r]}
              </p>
              <ul className="space-y-0.5 text-xs text-ink-600">
                {ROLE_PERMISSIONS[r].map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} manageAdmins={manageAdmins} onSaved={refresh} />}
      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={
          action?.kind === 'reset' ? `Reset password for ${action.user.fullName}` : action?.kind === 'revoke' ? `Sign ${action?.user.fullName} out everywhere?` : `${action?.user.isActive ? 'Disable' : 'Enable'} ${action?.user.fullName}?`
        }
        description={
          action?.kind === 'reset'
            ? 'They will be signed out and must choose a new password at next sign-in.'
            : action?.kind === 'revoke'
              ? 'All their phones and browsers are signed out immediately. Their unsaved POS cart stays on the device.'
              : action?.user.isActive
                ? 'They are signed out immediately and cannot sign in again until re-enabled. Their bills and history are kept.'
                : 'They will be able to sign in again.'
        }
        confirmLabel={action?.kind === 'reset' ? 'Reset password' : 'Confirm'}
        tone={action?.kind === 'toggle' && action.user.isActive ? 'danger' : 'primary'}
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      >
        {action?.kind === 'reset' && <Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="Temporary password (10+ chars, letters & digits)" aria-label="Temporary password" />}
      </ConfirmDialog>
    </div>
  );
}

function UserDialog({ user, onClose, manageAdmins, onSaved }: { user: UserRecord | null; onClose: () => void; manageAdmins: boolean; onSaved: () => void }) {
  const form = useForm<UserForm>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      username: user?.username ?? '',
      email: user?.email ?? '',
      fullName: user?.fullName ?? '',
      phone: user?.phone ?? '',
      role: user?.role ?? 'SALESPERSON',
      password: '',
      maxDiscountPercent: user?.maxDiscountBps !== null && user?.maxDiscountBps !== undefined ? String(user.maxDiscountBps / 100) : '',
    },
  });
  const roles = ROLES.filter((r) => manageAdmins || !PRIVILEGED_ROLES.includes(r as Role));
  const save = useMutation({
    mutationFn: (v: UserForm) => {
      let maxDiscountBps: number | null = null;
      if (v.maxDiscountPercent.trim()) maxDiscountBps = percentToBps(v.maxDiscountPercent.trim());
      const common = { fullName: v.fullName, email: v.email, phone: v.phone || null, role: v.role, maxDiscountBps };
      return user ? api.users.update(user.id, common) : api.users.create({ ...common, username: v.username, password: v.password, phone: v.phone || undefined });
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success(user ? 'User updated' : 'User created — they must set their own password at first sign-in');
      onSaved();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fieldErrors())) form.setError(k as keyof UserForm, { message: m });
      toast.error(e.message);
    },
  });
  const err = form.formState.errors;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={user ? `Edit ${user.fullName}` : 'Add user'}
      footer={
        <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={err.fullName?.message} className="sm:col-span-2">
          <Input {...form.register('fullName')} />
        </Field>
        <Field label="Username" error={err.username?.message}>
          <Input {...form.register('username')} disabled={!!user} />
        </Field>
        <Field label="Role">
          <Select {...form.register('role')}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email" error={err.email?.message}>
          <Input type="email" {...form.register('email')} />
        </Field>
        <Field label="Mobile" error={err.phone?.message}>
          <Input {...form.register('phone')} inputMode="tel" />
        </Field>
        {!user && (
          <Field label="Temporary password" error={err.password?.message} hint="They must change it at first sign-in" className="sm:col-span-2">
            <Input {...form.register('password')} />
          </Field>
        )}
        {form.watch('role') === 'SALESPERSON' && (
          <Field label="Discount cap % (optional)" hint="Blank = shop default. Above the cap needs manager approval." className="sm:col-span-2">
            <Input {...form.register('maxDiscountPercent')} inputMode="decimal" placeholder="e.g. 10" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
