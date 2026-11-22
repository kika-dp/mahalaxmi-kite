import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators';

/** A handler can return `new Envelope(data, meta)` to add meta; plain values become {data}. */
export class Envelope<T> {
  constructor(
    public readonly data: T,
    public readonly meta?: Record<string, unknown>,
  ) {}
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();
    return next.handle().pipe(
      map((value) => {
        if (value instanceof Envelope) {
          return value.meta ? { data: value.data, meta: value.meta } : { data: value.data };
        }
        return { data: value ?? null };
      }),
    );
  }
}
