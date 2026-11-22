/* Once per run: recreate the test schema, apply migrations, seed the 12 dev users. */
import 'reflect-metadata';
import { config } from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';

export default async function globalSetup(): Promise<void> {
  config({ path: path.resolve(__dirname, '../../../.env') });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST must be set');
  if (!/test/i.test(url)) throw new Error(`Refusing to wipe a database whose URL does not contain "test": ${url}`);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.SEED_MUST_CHANGE_PASSWORD = 'false';
  const { buildDataSourceOptions } = await import('../src/database/data-source');
  const { runDevSeed } = await import('../src/database/seeds/dev-seed');
  const ds = new DataSource(buildDataSourceOptions(url));
  await ds.initialize();
  // Drops everything this role owns in the TEST database (works without owning the public schema).
  await ds.query('DROP OWNED BY CURRENT_USER CASCADE');
  await ds.runMigrations({ transaction: 'each' });
  await runDevSeed(ds, { mustChangePassword: false });
  await ds.destroy();
}
