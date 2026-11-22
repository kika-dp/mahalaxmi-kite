'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Category } from '@kite/shared';
import { Badge, Button, Card, Input, Switch } from '@/components/ui/core';
import { PageHeader, Table, TableSkeleton, Td, Th, Tr } from '@/components/ui/data';
import { ConfirmDialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';

export default function CategoriesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['categories', 'all'], queryFn: () => api.catalog.categories(true) });
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const create = useMutation({ mutationFn: () => api.catalog.createCategory({ name: name.trim() }), onSuccess: () => (setName(''), toast.success('Category added'), refresh()) });
  const update = useMutation({ mutationFn: (v: { id: string; body: Partial<Category> }) => api.catalog.updateCategory(v.id, v.body), onSuccess: () => (setEditing(null), refresh()) });
  const remove = useMutation({ mutationFn: (id: string) => api.catalog.deleteCategory(id), onSuccess: () => (setToDelete(null), toast.success('Category deleted'), refresh()) });

  const rows = list.data ?? [];
  const move = (i: number, dir: -1 | 1) => {
    const a = rows[i];
    const b = rows[i + dir];
    if (!a || !b) return;
    update.mutate({ id: a.id, body: { sortOrder: b.sortOrder } });
    update.mutate({ id: b.id, body: { sortOrder: a.sortOrder } });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Categories" description="Order controls how categories appear in the POS app." />
      <Card>
        <form
          className="flex gap-2 border-b border-ink-100 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) create.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" />
          <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
            <Plus /> Add
          </Button>
        </form>
        <Table>
          <thead>
            <tr>
              <Th className="w-20">Order</Th>
              <Th>Name</Th>
              <Th align="right">Products</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          {list.isLoading ? (
            <TableSkeleton cols={5} />
          ) : (
            <tbody>
              {rows.map((c, i) => (
                <Tr key={c.id}>
                  <Td>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        <ArrowDown />
                      </Button>
                    </div>
                  </Td>
                  <Td>
                    {editing?.id === c.id ? (
                      <div className="flex gap-1">
                        <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8" autoFocus aria-label="Category name" />
                        <Button size="icon" className="size-8" onClick={() => update.mutate({ id: c.id, body: { name: editing.name.trim() } })} aria-label="Save">
                          <Check />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(null)} aria-label="Cancel">
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-ink-900">{c.name}</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Badge>{c.productCount ?? 0}</Badge>
                  </Td>
                  <Td>
                    <Switch checked={c.isActive} onCheckedChange={(v) => update.mutate({ id: c.id, body: { isActive: v } })} />
                  </Td>
                  <Td align="right">
                    <Button variant="ghost" size="icon" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={(c.productCount ?? 0) > 0} title={(c.productCount ?? 0) > 0 ? 'Has products — deactivate instead' : 'Delete'} onClick={() => setToDelete(c)} aria-label={`Delete ${c.name}`}>
                      <Trash2 />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete “${toDelete?.name}”?`}
        description="This category has no products and will be removed permanently."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </div>
  );
}
