import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@kite/shared';

/** Application error carrying a stable machine-readable code (specification.md §20). */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  notFound: (what = 'Resource') => new AppException(ErrorCode.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN),
  unauthenticated: (message = 'Authentication required', code: ErrorCode = ErrorCode.UNAUTHENTICATED) =>
    new AppException(code, message, HttpStatus.UNAUTHORIZED),
  validation: (message: string, details?: unknown) =>
    new AppException(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details),
  duplicate: (message: string, details?: unknown) =>
    new AppException(ErrorCode.DUPLICATE, message, HttpStatus.CONFLICT, details),
  invalidState: (message: string, details?: unknown) =>
    new AppException(ErrorCode.INVALID_STATE, message, HttpStatus.CONFLICT, details),
  insufficientStock: (details: { productId: string; name: string; requested: number; available: number }[]) =>
    new AppException(
      ErrorCode.INSUFFICIENT_STOCK,
      details.length === 1
        ? `Only ${details[0].available} left of ${details[0].name}`
        : 'Not enough stock for some items',
      HttpStatus.CONFLICT,
      details,
    ),
  rule: (code: ErrorCode, message: string, details?: unknown) =>
    new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details),
};

/** PostgreSQL error helpers. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; driverError?: { code?: string } };
  return e?.driverError?.code ?? e?.code;
}
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; driverError?: { constraint?: string } };
  return e?.driverError?.constraint ?? e?.constraint;
}
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FK_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_DEADLOCK = '40P01';
export const PG_SERIALIZATION = '40001';
