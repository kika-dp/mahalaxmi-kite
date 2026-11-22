import { config as loadDotenv } from 'dotenv';
import * as path from 'path';
import { z } from 'zod';

// Load the repository-root .env (apps/api/src/config → ../../../../.env), then a local one.
loadDotenv({ path: path.resolve(__dirname, '../../../../.env') });
loadDotenv({ path: path.resolve(process.cwd(), '.env') });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().optional(),
  DATABASE_SSL: bool,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_REMEMBER_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  REFRESH_TTL_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional().transform((v) => (v ? v : undefined)),
  UPLOAD_DIR: z.string().default('./uploads'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SWAGGER_ENABLED: bool,
  SEED_MUST_CHANGE_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  THROTTLE_DISABLED: bool,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.JWT_ACCESS_SECRET.startsWith('change-me')) {
      throw new Error('JWT_ACCESS_SECRET must be changed in production');
    }
  }
  cached = parsed.data;
  return cached;
}

/** For tests: force re-read of process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const ENV = Symbol('ENV');
