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
  // Hosting platforms (Render, Railway, …) inject PORT; fall back to API_PORT.
  await app.listen(Number(process.env.PORT) || env.API_PORT, '0.0.0.0');
}

main().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
