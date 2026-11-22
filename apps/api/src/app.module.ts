import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { ConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { buildDataSourceOptions } from './database/data-source';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthController } from './modules/health/health.controller';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { CustomersModule } from './modules/customers/customers.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CashModule } from './modules/cash/cash.module';
import type { RequestWithAuth } from './common/decorators';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          (req as unknown as RequestWithAuth).requestId = id;
          res.setHeader('X-Request-Id', id);
          return id;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.newPassword',
            '*.currentPassword',
            '*.refreshToken',
            '*.accessToken',
          ],
          censor: '[REDACTED]',
        },
        customProps: (req: IncomingMessage) => ({ userId: (req as unknown as RequestWithAuth).auth?.userId }),
        autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health/') },
        transport:
          env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    TypeOrmModule.forRootAsync({ useFactory: () => buildDataSourceOptions() }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 3000 }],
      skipIf: () => env.THROTTLE_DISABLED,
    }),
    AuditModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    CatalogModule,
    InventoryModule,
    SuppliersModule,
    CustomersModule,
    InvoicesModule,
    DashboardModule,
    ReportsModule,
    CashModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    /* request id is assigned by pino-http genReqId */
  }
}
