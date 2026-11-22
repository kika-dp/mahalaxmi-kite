/**
 * Production bootstrap (specification.md §5.2). Creates settings, categories, the season and ONE
 * Super Admin from environment variables — only if no Super Admin exists yet.
 *   BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { passwordPolicyError, Role, USERNAME_PATTERN } from '@kite/shared';
import { buildDataSourceOptions } from '../data-source';
import { User } from '../entities';
import { DEV_USERS, ensureUsers, seedBase } from './seed-core';

async function main(): Promise<void> {
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? '').trim().toLowerCase();
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  if (!USERNAME_PATTERN.test(username)) throw new Error('BOOTSTRAP_ADMIN_USERNAME is missing or invalid');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL is missing or invalid');
  const policy = passwordPolicyError(password, username);
  if (policy) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${policy}`);
  if (DEV_USERS.some((u) => u.password === password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must not be one of the documented development passwords');
  }

  const ds = new DataSource(buildDataSourceOptions());
  await ds.initialize();
  try {
    if (await ds.showMigrations()) throw new Error('Pending migrations. Run migrations first.');
    await seedBase(ds);
    const existing = await ds.getRepository(User).countBy({ role: Role.SUPER_ADMIN });
    if (existing > 0) {
      console.log('A Super Admin already exists; nothing to do.');
      return;
    }
    await ds.transaction((m) =>
      ensureUsers(m, [{ username, email, fullName: 'Shop Owner', role: Role.SUPER_ADMIN, password }], {
        mustChangePassword: true,
        resetPasswords: false,
      }),
    );
    console.log(`Created Super Admin "${username}". Change the password at first login, then unset BOOTSTRAP_ADMIN_PASSWORD.`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
