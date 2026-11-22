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
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    // Handled errors (e.g. idempotency races) are expected; unexpected ones are logged by AllExceptionsFilter.
    logging: false,
    extra: {
      max: env.DATABASE_POOL_MAX,
      // All sessions use UTC; business-date logic converts explicitly to Asia/Kolkata.
      options: '-c timezone=UTC',
      statement_timeout: 30_000,
    },
  };
}

/** Used by the TypeORM CLI. */
export default new DataSource(buildDataSourceOptions());
