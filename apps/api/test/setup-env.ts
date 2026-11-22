/* Runs before each test file: point the app at the TEST database. Never the dev/prod one. */
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(__dirname, '../../../.env') });
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST must be set for integration tests');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';
process.env.THROTTLE_DISABLED = 'true';
process.env.SEED_MUST_CHANGE_PASSWORD = 'false';
process.env.UPLOAD_DIR = path.resolve(__dirname, '../.test-uploads');
process.env.DATABASE_POOL_MAX = '30';
