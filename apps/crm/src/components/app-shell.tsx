'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  FileClock,
  FileText,
  FolderTree,
  HandCoins,
  History,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package,
  ReceiptIndianRupee,
  ScrollText,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Permission, ROLE_LABELS } from '@kite/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { KiteLogo } from './kite-logo';
import { Menu } from './ui/overlay';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm: Permission;
}
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: Permission.DASHBOARD_VIEW }] },
  {
    group: 'Sales',
    items: [
      { href: '/bills', label: 'Bills', icon: ReceiptIndianRupee, perm: Permission.INVOICES_READ_ALL },
      { href: '/outstanding', label: 'Outstanding', icon: HandCoins, perm: Permission.INVOICES_READ_ALL },
      { href: '/customers', label: 'Customers', icon: Users, perm: Permission.CUSTOMERS_EDIT },
      { href: '/cash', label: 'Cash closing', icon: Wallet, perm: Permission.CASH_MANAGE },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Package, perm: Permission.CATALOG_READ },
      { href: '/categories', label: 'Categories', icon: FolderTree, perm: Permission.CATALOG_WRITE },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock', icon: Boxes, perm: Permission.INVENTORY_VIEW_LEDGER },
      { href: '/inventory/low-stock', label: 'Low stock', icon: AlertTriangle, perm: Permission.INVENTORY_VIEW_LEDGER },
      { href: '/inventory/movements', label: 'Stock history', icon: History, perm: Permission.INVENTORY_VIEW_LEDGER },
      { href: '/inventory/adjustments', label: 'Adjustments', icon: SlidersHorizontal, perm: Permission.INVENTORY_ADJUST },
      { href: '/inventory/counts', label: 'Stock counts', icon: ClipboardList, perm: Permission.INVENTORY_ADJUST },
    ],
  },
  {
    group: 'Purchasing',
    items: [
      { href: '/suppliers', label: 'Suppliers', icon: Truck, perm: Permission.SUPPLIERS_MANAGE },
      { href: '/purchases', label: 'Purchases', icon: ShoppingCart, perm: Permission.SUPPLIERS_MANAGE },
    ],
  },
  {
    group: 'Insights',
    items: [
      { href: '/reports', label: 'Reports', icon: BarChart3, perm: Permission.REPORTS_INVENTORY },
    ],
  },
  {
    group: 'Admin',
    items: [
      { href: '/users', label: 'Users & roles', icon: UserCog, perm: Permission.USERS_MANAGE },
      { href: '/settings', label: 'Shop settings', icon: Settings, perm: Permission.SETTINGS_MANAGE },
      { href: '/audit', label: 'Audit log', icon: ScrollText, perm: Permission.AUDIT_VIEW },
    ],
  },
];

export function firstAllowedPath(can: (p: Permission) => boolean): string {
  for (const g of NAV) for (const i of g.items) if (can(i.perm)) return i.href;
  return '/products';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, can, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get(), staleTime: 300_000 });
  const pending = useQuery({
    queryKey: ['adjustments', 'pending-count'],
    queryFn: () => api.inventory.adjustments({ status: 'PENDING', pageSize: 1 }),
    enabled: can(Permission.INVENTORY_APPROVE),
    refetchInterval: 60_000,
  });

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (settings.data?.brandColor) document.documentElement.style.setProperty('--brand', settings.data.brandColor);
  }, [settings.data?.brandColor]);

  const isActive = (href: string) =>
    pathname === href || (pathname.startsWith(`${href}/`) && !NAV.some((g) => g.items.some((i) => i.href !== href && i.href.startsWith(`${href}/`) && pathname.startsWith(i.href))));

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.group}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={isActive(i.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive(i.href) ? 'bg-white/12 font-medium text-white' : 'text-white/70 hover:bg-white/6 hover:text-white',
                    )}
                  >
                    <i.icon className={cn('size-4', isActive(i.href) && 'text-brand-500')} />
                    <span className="flex-1">{i.label}</span>
                    {i.href === '/inventory/adjustments' && (pending.data?.meta.total ?? 0) > 0 && (
                      <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{pending.data?.meta.total}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-night-900">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
        <KiteLogo className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{settings.data?.shopName ?? 'Kite Shop'}</p>
          <p className="text-[11px] text-white/50">CRM</p>
        </div>
      </div>
      {nav}
      <div className="border-t border-white/10 p-3 text-[11px] text-white/40">
        <FileClock className="mr-1 inline size-3" /> Times shown in IST
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{sidebar}</div>
          <button className="absolute left-[19rem] top-4 rounded-full bg-white p-2" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-ink-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon className="size-5" />
          </button>
          <div className="hidden text-sm text-ink-500 lg:block">
            <FileText className="mr-1.5 inline size-4" />
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
          </div>
          <Menu
            trigger={
              <button className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-ink-100" aria-label="Account menu">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">{user?.fullName.slice(0, 1)}</span>
                <span className="hidden sm:block">
                  <span className="block text-sm font-medium text-ink-900">{user?.fullName}</span>
                  <span className="block text-xs text-ink-500">{user ? ROLE_LABELS[user.role] : ''}</span>
                </span>
              </button>
            }
            items={[{ label: 'Sign out', icon: <LogOut />, onSelect: () => logout(), danger: true }]}
          />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
