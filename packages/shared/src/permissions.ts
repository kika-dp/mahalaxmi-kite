import { Role } from './enums';

export const Permission = {
  USERS_MANAGE: 'users.manage',
  USERS_MANAGE_ADMINS: 'users.manageAdmins',
  SETTINGS_MANAGE: 'settings.manage',
  CATALOG_READ: 'catalog.read',
  CATALOG_WRITE: 'catalog.write',
  CATALOG_VIEW_COST: 'catalog.viewCost',
  INVENTORY_RECEIVE: 'inventory.receive',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_APPROVE: 'inventory.approve',
  INVENTORY_VIEW_LEDGER: 'inventory.viewLedger',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  SUPPLIERS_PAY: 'suppliers.pay',
  INVOICES_CREATE: 'invoices.create',
  INVOICES_READ_ALL: 'invoices.readAll',
  INVOICES_READ_OWN: 'invoices.readOwn',
  PAYMENTS_RECORD: 'payments.record',
  INVOICES_RETURN: 'invoices.return',
  INVOICES_REFUND: 'invoices.refund',
  INVOICES_VOID: 'invoices.void',
  DISCOUNTS_UNLIMITED: 'discounts.unlimited',
  DISCOUNTS_APPROVE: 'discounts.approve',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_WRITE: 'customers.write',
  CUSTOMERS_EDIT: 'customers.edit',
  DASHBOARD_VIEW: 'dashboard.view',
  REPORTS_FINANCIAL: 'reports.financial',
  REPORTS_INVENTORY: 'reports.inventory',
  CASH_MANAGE: 'cash.manage',
  CASH_REOPEN: 'cash.reopen',
  AUDIT_VIEW: 'audit.view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

const ADMIN_PERMISSIONS: Permission[] = [
  P.USERS_MANAGE,
  P.SETTINGS_MANAGE,
  P.CATALOG_READ,
  P.CATALOG_WRITE,
  P.CATALOG_VIEW_COST,
  P.INVENTORY_RECEIVE,
  P.INVENTORY_ADJUST,
  P.INVENTORY_APPROVE,
  P.INVENTORY_VIEW_LEDGER,
  P.SUPPLIERS_MANAGE,
  P.SUPPLIERS_PAY,
  P.INVOICES_CREATE,
  P.INVOICES_READ_ALL,
  P.INVOICES_READ_OWN,
  P.PAYMENTS_RECORD,
  P.INVOICES_RETURN,
  P.INVOICES_REFUND,
  P.INVOICES_VOID,
  P.DISCOUNTS_UNLIMITED,
  P.DISCOUNTS_APPROVE,
  P.CUSTOMERS_READ,
  P.CUSTOMERS_WRITE,
  P.CUSTOMERS_EDIT,
  P.DASHBOARD_VIEW,
  P.REPORTS_FINANCIAL,
  P.REPORTS_INVENTORY,
  P.CASH_MANAGE,
  P.AUDIT_VIEW,
];

/** Single source of truth for role → permission mapping (specification.md §3). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...ADMIN_PERMISSIONS, P.USERS_MANAGE_ADMINS, P.CASH_REOPEN],
  ADMIN: ADMIN_PERMISSIONS,
  INVENTORY_MANAGER: [
    P.CATALOG_READ,
    P.CATALOG_VIEW_COST,
    P.INVENTORY_RECEIVE,
    P.INVENTORY_ADJUST,
    P.INVENTORY_VIEW_LEDGER,
    P.SUPPLIERS_MANAGE,
    P.REPORTS_INVENTORY,
  ],
  SALESPERSON: [
    P.CATALOG_READ,
    P.INVOICES_CREATE,
    P.INVOICES_READ_OWN,
    P.PAYMENTS_RECORD,
    P.CUSTOMERS_READ,
    P.CUSTOMERS_WRITE,
  ],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Roles that only SUPER_ADMIN may create/modify. */
export const PRIVILEGED_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

/** Roles allowed to sign in to the web CRM. */
export const CRM_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.INVENTORY_MANAGER];
