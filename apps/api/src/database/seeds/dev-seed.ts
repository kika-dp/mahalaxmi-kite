/**
 * Development seeder — idempotent.
 *   pnpm --filter api seed:dev                      # settings, categories, season, 12 users
 *   pnpm --filter api seed:dev -- --reset-passwords # restore the documented dev passwords
 *   pnpm --filter api seed:dev -- --with-demo-catalog
 * Refuses to run when NODE_ENV=production.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadEnv } from '../../config/env';
import { buildDataSourceOptions } from '../data-source';
import { DEV_USERS, ensureUsers, seedBase } from './seed-core';
import { seedDemoCatalog } from './demo-catalog';

export async function runDevSeed(
  ds: DataSource,
  opts: { resetPasswords?: boolean; withDemoCatalog?: boolean; mustChangePassword?: boolean } = {},
): Promise<{ created: number; updated: number; demoProducts: number }> {
  if (loadEnv().NODE_ENV === 'production') {
    throw new Error('Refusing to run the development seeder in production. Use bootstrap:prod.');
  }
  await seedBase(ds);
  const users = await ds.transaction((m) =>
    ensureUsers(m, DEV_USERS, {
      mustChangePassword: opts.mustChangePassword ?? loadEnv().SEED_MUST_CHANGE_PASSWORD,
      resetPasswords: !!opts.resetPasswords,
    }),
  );
  const demoProducts = opts.withDemoCatalog ? await seedDemoCatalog(ds) : 0;
  return { ...users, demoProducts };
}

if (require.main === module) {
  (async () => {
    const args = new Set(process.argv.slice(2));
    const ds = new DataSource(buildDataSourceOptions());
    await ds.initialize();
    try {
      const pending = await ds.showMigrations();
      if (pending) throw new Error('Pending migrations. Run `pnpm --filter api migration:run` first.');
      const r = await runDevSeed(ds, {
        resetPasswords: args.has('--reset-passwords'),
        withDemoCatalog: args.has('--with-demo-catalog'),
      });
      const [{ count }] = await ds.query('SELECT count(*)::int AS count FROM users');
      console.log(
        `Dev seed complete: users created=${r.created}, passwords reset=${r.updated}, total users=${count}` +
          (r.demoProducts ? `, demo products=${r.demoProducts}` : ''),
      );
    } finally {
      await ds.destroy();
    }
  })().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
