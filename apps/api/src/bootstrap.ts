import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { promises as fs } from 'fs';
import { Env } from './config/env';
import { Errors } from './common/errors';
import { uploadDir } from './common/utils/uploads';

export const API_PREFIX = 'api/v1';

function flattenError(e: ValidationError, parent = ''): { field: string; message: string }[] {
  const field = parent ? `${parent}.${e.property}` : e.property;
  const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
  return [...own, ...(e.children ?? []).flatMap((c) => flattenError(c, field))];
}

/** Shared app configuration used by main.ts and the integration tests. */
export async function configureApp(app: INestApplication, env: Env): Promise<void> {
  const express = app as NestExpressApplication;
  express.useLogger(app.get(Logger));
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // product images are loaded by the CRM origin
      hsts: env.NODE_ENV === 'production',
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'ETag'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) => Errors.validation('Some fields are invalid', errors.flatMap((e) => flattenError(e))),
    }),
  );

  await fs.mkdir(uploadDir(), { recursive: true });
  express.useStaticAssets(uploadDir(), {
    prefix: '/uploads/',
    maxAge: '365d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  if (env.SWAGGER_ENABLED || env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Kite Shop API')
      .setDescription('Billing, inventory and sales API. Money is integer paise; percentages are basis points.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  app.enableShutdownHooks();
}
