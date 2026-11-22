import {
  allocateProportionally,
  divRoundHalfUp,
  formatINR,
  paiseToDecimalString,
  percentOf,
  percentToBps,
  rupeesToPaise,
  tryRupeesToPaise,
} from './money';
import { normalizeIndianPhone, passwordPolicyError } from './normalize';
import { addDays, formatIstDateTime, istDateString, isValidYmd } from './dates';
import { permissionsFor, Permission, roleHas, ROLE_PERMISSIONS } from './permissions';
import { Role } from './enums';

describe('money', () => {
  it('parses rupees to paise without floating point errors', () => {
    expect(rupeesToPaise('12.5')).toBe(1250);
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise('1,250.75')).toBe(125075);
    expect(rupeesToPaise('₹ 99')).toBe(9900);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(() => rupeesToPaise('1.234')).toThrow();
    expect(() => rupeesToPaise('-5')).toThrow();
    expect(() => rupeesToPaise('abc')).toThrow();
    expect(tryRupeesToPaise('')).toBeNull();
  });

  it('rounds half up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(percentOf(4995, 1000)).toBe(500); // 499.5 → 500
    expect(percentOf(0, 1000)).toBe(0);
  });

  it('converts percent to bps', () => {
    expect(percentToBps('10')).toBe(1000);
    expect(percentToBps('12.5')).toBe(1250);
    expect(percentToBps(7.25)).toBe(725);
    expect(() => percentToBps('1.234')).toThrow();
  });

  it('formats INR with Indian grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(2000, { compact: true })).toBe('₹20');
    expect(formatINR(2050, { compact: true })).toBe('₹20.50');
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(-1500)).toBe('−₹15.00');
    expect(formatINR(1234567890)).toBe('₹1,23,45,678.90');
    expect(paiseToDecimalString(123405)).toBe('1234.05');
  });

  it('allocates proportionally and exactly', () => {
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(7, [0, 10])).toEqual([0, 7]);
    const big = allocateProportionally(987654321, [123456789, 987654321, 5]);
    expect(big.reduce((a, b) => a + b, 0)).toBe(987654321);
    expect(() => allocateProportionally(5, [0, 0])).toThrow();
  });
});

describe('normalize', () => {
  it('normalizes Indian phone numbers', () => {
    expect(normalizeIndianPhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianPhone('09876543210')).toBe('9876543210');
    expect(normalizeIndianPhone('12345')).toBeNull();
    expect(normalizeIndianPhone('5876543210')).toBeNull();
  });
  it('enforces password policy', () => {
    expect(passwordPolicyError('short1')).toMatch(/10/);
    expect(passwordPolicyError('onlyletterslong')).toMatch(/digit/);
    expect(passwordPolicyError('seller01abc1', 'seller01abc1')).toMatch(/username/);
    expect(passwordPolicyError('KiteDev@2026#01')).toBeNull();
  });
});

describe('dates', () => {
  it('computes IST dates across midnight', () => {
    expect(istDateString(new Date('2027-01-13T18:29:00Z'))).toBe('2027-01-13');
    expect(istDateString(new Date('2027-01-13T18:30:00Z'))).toBe('2027-01-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidYmd('2027-02-30')).toBe(false);
    expect(formatIstDateTime('2027-01-14T05:02:00Z')).toBe('14 Jan 2027, 10:32 AM');
  });
});

describe('permissions', () => {
  it('salesperson cannot write catalog, adjust stock, view cost, void or see reports', () => {
    for (const p of [
      Permission.CATALOG_WRITE,
      Permission.INVENTORY_ADJUST,
      Permission.CATALOG_VIEW_COST,
      Permission.INVOICES_VOID,
      Permission.INVOICES_RETURN,
      Permission.REPORTS_FINANCIAL,
      Permission.DASHBOARD_VIEW,
      Permission.INVOICES_READ_ALL,
      Permission.DISCOUNTS_UNLIMITED,
    ]) {
      expect(roleHas(Role.SALESPERSON, p)).toBe(false);
    }
    expect(roleHas(Role.SALESPERSON, Permission.INVOICES_CREATE)).toBe(true);
  });
  it('inventory manager has no financial access', () => {
    expect(roleHas(Role.INVENTORY_MANAGER, Permission.REPORTS_FINANCIAL)).toBe(false);
    expect(roleHas(Role.INVENTORY_MANAGER, Permission.INVOICES_READ_ALL)).toBe(false);
    expect(roleHas(Role.INVENTORY_MANAGER, Permission.INVENTORY_APPROVE)).toBe(false);
    expect(roleHas(Role.INVENTORY_MANAGER, Permission.INVENTORY_ADJUST)).toBe(true);
  });
  it('only super admin manages admins and reopens cash sessions', () => {
    expect(roleHas(Role.ADMIN, Permission.USERS_MANAGE_ADMINS)).toBe(false);
    expect(roleHas(Role.SUPER_ADMIN, Permission.USERS_MANAGE_ADMINS)).toBe(true);
    expect(roleHas(Role.ADMIN, Permission.CASH_REOPEN)).toBe(false);
  });
  it('super admin is a superset of admin', () => {
    for (const p of ROLE_PERMISSIONS.ADMIN) expect(roleHas(Role.SUPER_ADMIN, p)).toBe(true);
    expect(permissionsFor(Role.SUPER_ADMIN).length).toBeGreaterThan(permissionsFor(Role.ADMIN).length);
  });
});
