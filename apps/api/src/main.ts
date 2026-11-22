import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  await configureApp(app, env);
  await app.listen(env.API_PORT, '0.0.0.0');
}

main().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
