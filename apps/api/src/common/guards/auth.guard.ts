import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, Permission, permissionsFor } from '@kite/shared';
import { ENV, Env } from '../../config/env';
import {
  ALLOW_PASSWORD_CHANGE_PENDING,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  RequestWithAuth,
} from '../decorators';
import { AppException, Errors } from '../errors';
import { SessionCacheService } from '../../modules/auth/session-cache.service';
import type { AccessTokenPayload } from '../../modules/auth/auth.service';

interface PermissionMeta {
  mode: 'all' | 'any' | 'authenticated';
  permissions: Permission[];
}

/**
 * Global guard: authentication (JWT + live session/user check), forced password change gate,
 * and RBAC. Default-deny: a non-public route without permission metadata is rejected.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionCacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthenticated();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), {
        secret: this.env.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
    } catch (err) {
      const expired = (err as Error)?.name === 'TokenExpiredError';
      throw Errors.unauthenticated(
        expired ? 'Access token expired' : 'Invalid access token',
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHENTICATED,
      );
    }

    const state = await this.sessions.get(payload.sid, payload.sub);
    if (!state) throw Errors.unauthenticated();
    if (!state.isActive) {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled', HttpStatus.UNAUTHORIZED);
    }
    if (!state.valid) throw Errors.unauthenticated('Session has ended. Please sign in again.', ErrorCode.SESSION_REVOKED);

    // Role is read from the database (not the token) so role changes apply immediately.
    req.auth = {
      userId: state.userId,
      username: state.username,
      fullName: state.fullName,
      role: state.role,
      sessionId: payload.sid,
      permissions: new Set(permissionsFor(state.role)),
    };

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, targets);
    if (state.mustChangePassword && !allowPending) {
      throw new AppException(
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        'You must change your password before continuing',
        HttpStatus.FORBIDDEN,
      );
    }

    const meta = this.reflector.getAllAndOverride<PermissionMeta>(PERMISSIONS_KEY, targets);
    if (!meta) {
      this.logger.error(`Route ${req.method} ${req.path} has no permission metadata — denied`);
      throw Errors.forbidden();
    }
    const has = (p: Permission) => req.auth!.permissions.has(p);
    const allowed =
      meta.mode === 'authenticated' ||
      (meta.mode === 'all' ? meta.permissions.every(has) : meta.permissions.some(has));
    if (!allowed) throw Errors.forbidden();
    return true;
  }
}
