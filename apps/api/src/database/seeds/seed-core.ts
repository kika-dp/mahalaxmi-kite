import { DataSource, EntityManager } from 'typeorm';
import { Role } from '@kite/shared';
import { hashPassword } from '../../modules/auth/password.service';
import { ProductCategory, SeasonEntity, ShopSettingsEntity, User } from '../entities';

export const DEFAULT_CATEGORIES = [
  'Regular Kites',
  'Designer Kites',
  'Premium Kites',
  'Kids Kites',
  'Manjha',
  'Firki',
  'Kite Threads',
  'Accessories',
  'Other Products',
];

export interface SeedUser {
  username: string;
  email: string;
  fullName: string;
  role: Role;
  password: string;
}

/** Development-only accounts (specification.md §5.1). Never used in production. */
export const DEV_USERS: SeedUser[] = [
  { username: 'superadmin', email: 'superadmin@kite.local', fullName: 'Super Admin', role: Role.SUPER_ADMIN, password: 'KiteDev@2026#01' },
  { username: 'admin01', email: 'admin01@kite.local', fullName: 'Admin One', role: Role.ADMIN, password: 'KiteDev@2026#02' },
  { username: 'admin02', email: 'admin02@kite.local', fullName: 'Admin Two', role: Role.ADMIN, password: 'KiteDev@2026#03' },
  ...Array.from({ length: 9 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      username: `seller${n}`,
      email: `seller${n}@kite.local`,
      fullName: `Seller ${n}`,
      role: Role.SALESPERSON,
      password: `KiteDev@2026#${String(i + 4).padStart(2, '0')}`,
    };
  }),
];

export async function ensureSettings(m: EntityManager): Promise<void> {
  await m.query(
    `INSERT INTO shop_settings (id, shop_name, address, phone, invoice_footer)
     VALUES (1, 'Uttarayan Kite Shop', 'Main Bazaar, Ahmedabad, Gujarat', '', 'Thank you! Happy Uttarayan!')
     ON CONFLICT (id) DO NOTHING`,
  );
}

export async function ensureCategories(m: EntityManager): Promise<number> {
  let created = 0;
  for (const [i, name] of DEFAULT_CATEGORIES.entries()) {
    const res: unknown[] = await m.query(
      `INSERT INTO product_categories (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name, i + 1],
    );
    created += res.length;
  }
  return created;
}

export async function ensureSeason(m: EntityManager): Promise<void> {
  const any = await m.getRepository(SeasonEntity).count();
  if (any > 0) return;
  await m.getRepository(SeasonEntity).insert({
    name: 'Uttarayan 2026–27',
    code: 'UTR-2026',
    startsOn: '2026-11-01',
    endsOn: '2027-01-31',
    invoiceSeries: '2026',
    isActive: true,
  });
}

/**
 * Upsert users by username. Existing users are left untouched unless `resetPasswords` is set,
 * so running the seeder twice never duplicates users or clobbers changed passwords.
 */
export async function ensureUsers(
  m: EntityManager,
  users: SeedUser[],
  opts: { mustChangePassword: boolean; resetPasswords: boolean },
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const repo = m.getRepository(User);
  for (const u of users) {
    const existing = await repo.findOneBy({ username: u.username });
    if (!existing) {
      await repo.insert({
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        passwordHash: await hashPassword(u.password),
        mustChangePassword: opts.mustChangePassword,
        isActive: true,
      });
      created++;
    } else if (opts.resetPasswords) {
      await repo.update(existing.id, {
        passwordHash: await hashPassword(u.password),
        mustChangePassword: opts.mustChangePassword,
        isActive: true,
        role: u.role,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      updated++;
    }
  }
  return { created, updated };
}

export async function seedBase(ds: DataSource): Promise<void> {
  await ds.transaction(async (m) => {
    await ensureSettings(m);
    await ensureCategories(m);
    await ensureSeason(m);
  });
}

export { ProductCategory, ShopSettingsEntity };
