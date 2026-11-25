import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { loadEnv } from '../config/env';
import { ENTITIES } from './entities';
import { SnakeNamingStrategy } from './naming.strategy';
import { InitialSchema1764000000000 } from './migrations/1764000000000-InitialSchema';

export const MIGRATIONS = [InitialSchema1764000000000];

export function buildDataSourceOptions(url?: string): DataSourceOptions {
  const env = loadEnv();
  return {
    type: 'postgres',
    url: url ?? env.DATABASE_URL,
    // Managed hosts (e.g. Neon) put `sslmode=require` in the URL; only override when DATABASE_SSL is set.
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    entities: ENTITIES,
    migrations: MIGRATIONS,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    // Handled errors (e.g. idempotency races) are expected; unexpected ones are logged by AllExceptionsFilter.
    logging: false,
    extra: {
      max: env.DATABASE_POOL_MAX,
      // No session options: connection poolers (Neon/PgBouncer) reject unknown startup parameters.
      // All business-date SQL converts explicitly with AT TIME ZONE 'Asia/Kolkata', so the session timezone is irrelevant.
      statement_timeout: 30_000,
    },
  };
}

/** Used by the TypeORM CLI. */
export default new DataSource(buildDataSourceOptions());
