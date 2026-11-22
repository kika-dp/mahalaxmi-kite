import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode } from '@kite/shared';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppException, pgCode, pgConstraint, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION } from '../errors';
import type { RequestWithAuth } from '../decorators';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.DUPLICATE,
  422: ErrorCode.BUSINESS_RULE,
  429: ErrorCode.RATE_LIMITED,
};

/** Converts every error into the standard envelope (specification.md §20). Never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithAuth>();
    const requestId = req.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = ErrorCode.RATE_LIMITED;
      message = 'Too many requests. Please wait a moment and try again.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BUSINESS_RULE);
      const body = exception.getResponse() as string | { message?: string | string[]; details?: unknown };
      if (typeof body === 'string') {
        message = body;
      } else if (Array.isArray(body.message)) {
        message = 'Some fields are invalid';
        details = body.message;
      } else if (body.message) {
        message = body.message;
        details = body.details;
      }
      if (status === 404 && message.startsWith('Cannot ')) message = 'Route not found';
      if (status === 413) message = 'Upload is too large';
    } else if (exception instanceof QueryFailedError) {
      const pg = pgCode(exception);
      if (pg === PG_UNIQUE_VIOLATION) {
        status = HttpStatus.CONFLICT;
        code = ErrorCode.DUPLICATE;
        message = 'A record with the same unique value already exists';
        details = { constraint: pgConstraint(exception) };
      } else if (pg === PG_CHECK_VIOLATION && pgConstraint(exception) === 'chk_stock_non_negative') {
        status = HttpStatus.CONFLICT;
        code = ErrorCode.INSUFFICIENT_STOCK;
        message = 'Not enough stock';
      } else {
        this.logger.error({ err: exception, requestId }, 'Database error');
      }
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    if (status >= 500) {
      code = ErrorCode.INTERNAL_ERROR;
      message = 'Something went wrong. Please try again.';
      details = undefined;
    }

    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) }, requestId });
  }
}
