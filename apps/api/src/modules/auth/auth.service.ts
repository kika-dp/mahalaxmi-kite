import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  AuthUser,
  ErrorCode,
  LoginResponse,
  MeResponse,
  passwordPolicyError,
  permissionsFor,
  Permission,
  roleHas,
  TokenPair,
} from '@kite/shared';
import { ENV, Env } from '../../config/env';
import { AppException, Errors } from '../../common/errors';
import { RequestMeta } from '../../common/decorators';
import { ShopSettingsEntity, User, UserSession } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { PasswordService } from './password.service';
import { SessionCacheService } from './session-cache.service';

export interface AccessTokenPayload {
  sub: string;
  sid: string; // session family id
  role: string;
}

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
/** Concurrent refreshes with the same token inside this window are not treated as theft. */
const ROTATION_GRACE_MS = 5_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    maxDiscountBps: u.maxDiscountBps,
  };
}

@Injectable()
export class AuthService {
  private readonly limiter = new LoginRateLimiter();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly sessions: SessionCacheService,
  ) {}

  // ------------------------------------------------------------------ login
  async login(
    identifier: string,
    password: string,
    remember: boolean,
    meta: RequestMeta,
  ): Promise<LoginResponse & { refreshToken: string }> {
    const ident = identifier.trim().toLowerCase();
    const ip = meta.ip ?? 'unknown';
    if (!this.env.THROTTLE_DISABLED && !this.limiter.attempt(ip, ident)) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        'Too many login attempts. Please wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :ident OR u.email = :ident', { ident })
      .getOne();

    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user) {
      this.audit.logAsync({ action: 'AUTH_LOGIN_FAILED', metadata: { identifier: ident, reason: 'unknown_user' }, ip });
      throw Errors.unauthenticated('Incorrect username or password', ErrorCode.INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppException(
        ErrorCode.ACCOUNT_LOCKED,
        'Account temporarily locked after too many failed attempts. Try again later or ask an admin.',
        HttpStatus.FORBIDDEN,
        { lockedUntil: user.lockedUntil.toISOString() },
      );
    }
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.ds.getRepository(User).update(user.id, {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      });
      this.audit.logAsync({
        actorId: user.id,
        actorUsername: user.username,
        action: lock ? 'AUTH_LOGIN_LOCKED' : 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        metadata: { failed },
        ip,
      });
      throw Errors.unauthenticated('Incorrect username or password', ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled', HttpStatus.FORBIDDEN);
    }

    this.limiter.reset(ip, ident);
    await this.ds.getRepository(User).update(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    const tokens = await this.ds.transaction((m) => this.createSession(m, user, remember, meta, randomUUID()));
    await this.audit.log({
      actorId: user.id,
      actorUsername: user.username,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      metadata: { remember, userAgent: meta.userAgent },
      ip,
      requestId: meta.requestId,
    });
    return { ...tokens, user: toAuthUser(user), permissions: permissionsFor(user.role) };
  }

  // ---------------------------------------------------------------- refresh
  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair & { refreshToken: string; remember: boolean }> {
    const hash = hashToken(refreshToken);
    // Errors are RETURNED from the transaction (not thrown) so that revocations made while
    // handling them are committed — throwing inside would roll the revocation back.
    const result = await this.ds.transaction(async (m): Promise<{ error: AppException } | { pair: TokenPair & { refreshToken: string; remember: boolean } }> => {
      const session = await m
        .getRepository(UserSession)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.refreshTokenHash = :hash', { hash })
        .getOne();
      if (!session) return { error: Errors.unauthenticated('Session not found', ErrorCode.SESSION_REVOKED) };

      if (session.revokedAt) {
        const withinGrace =
          session.revokedReason === 'ROTATED' && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
        if (session.revokedReason === 'ROTATED' && !withinGrace) {
          await this.revokeFamily(m, session.familyId, 'REUSE_DETECTED');
          await this.audit.log(
            {
              actorId: session.userId,
              action: 'AUTH_REFRESH_REUSE',
              entityType: 'session',
              entityId: session.familyId,
              ip: meta.ip,
              requestId: meta.requestId,
            },
            m,
          );
        }
        return { error: Errors.unauthenticated('Session has ended. Please sign in again.', ErrorCode.SESSION_REVOKED) };
      }
      if (session.expiresAt.getTime() <= Date.now()) {
        return { error: Errors.unauthenticated('Session expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED) };
      }
      const user = await m.getRepository(User).findOneBy({ id: session.userId });
      if (!user || !user.isActive) {
        await this.revokeFamily(m, session.familyId, 'USER_DISABLED');
        return { error: new AppException(ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled', HttpStatus.UNAUTHORIZED) };
      }
      const pair = await this.createSession(m, user, session.remember, meta, session.familyId);
      const newRow = await m.getRepository(UserSession).findOneByOrFail({ refreshTokenHash: hashToken(pair.refreshToken) });
      await m.getRepository(UserSession).update(session.id, {
        revokedAt: new Date(),
        revokedReason: 'ROTATED',
        replacedById: newRow.id,
        lastUsedAt: new Date(),
      });
      return { pair: { ...pair, remember: session.remember } };
    });
    if ('error' in result) throw result.error;
    return result.pair;
  }

  // ----------------------------------------------------------------- logout
  async logout(params: { familyId?: string; refreshToken?: string; userId?: string; meta: RequestMeta }): Promise<void> {
    const families = new Set<string>();
    if (params.familyId) families.add(params.familyId);
    if (params.refreshToken) {
      const s = await this.ds.getRepository(UserSession).findOneBy({ refreshTokenHash: hashToken(params.refreshToken) });
      if (s) families.add(s.familyId);
    }
    for (const f of families) await this.revokeFamily(this.ds.manager, f, 'LOGOUT');
    if (params.userId) {
      this.audit.logAsync({ actorId: params.userId, action: 'AUTH_LOGOUT', ip: params.meta.ip });
    }
  }

  // -------------------------------------------------------- change password
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<TokenPair & { refreshToken: string; remember: boolean }> {
    const user = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw Errors.notFound('User');
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw Errors.validation('Current password is incorrect', [{ field: 'currentPassword', message: 'Incorrect password' }]);
    }
    const policy = passwordPolicyError(newPassword, user.username);
    if (policy) throw Errors.validation(policy, [{ field: 'newPassword', message: policy }]);
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw Errors.validation('New password must be different from the current password');
    }
    const hash = await this.passwords.hash(newPassword);
    const result = await this.ds.transaction(async (m) => {
      await m.getRepository(User).update(user.id, {
        passwordHash: hash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      });
      await this.revokeAllForUser(m, user.id, 'PASSWORD_CHANGED');
      const fresh = await m.getRepository(User).findOneByOrFail({ id: user.id });
      const pair = await this.createSession(m, fresh, true, meta, randomUUID());
      await this.audit.log(
        { actorId: user.id, actorUsername: user.username, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id, ip: meta.ip },
        m,
      );
      return pair;
    });
    return { ...result, remember: true };
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.ds.getRepository(User).findOneBy({ id: userId });
    if (!user) throw Errors.unauthenticated();
    let effectiveMaxDiscountBps: number | null = null;
    if (!roleHas(user.role, Permission.DISCOUNTS_UNLIMITED)) {
      const settings = await this.ds.getRepository(ShopSettingsEntity).findOneBy({ id: 1 });
      effectiveMaxDiscountBps = user.maxDiscountBps ?? settings?.salespersonMaxDiscountBps ?? 0;
    }
    return { user: toAuthUser(user), permissions: permissionsFor(user.role), effectiveMaxDiscountBps };
  }

  // ---------------------------------------------------------------- helpers
  async revokeFamily(m: EntityManager, familyId: string, reason: string): Promise<void> {
    await m
      .getRepository(UserSession)
      .update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
    this.sessions.invalidate();
  }

  async revokeAllForUser(m: EntityManager, userId: string, reason: string): Promise<number> {
    const res = await m
      .getRepository(UserSession)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
    this.sessions.invalidate();
    return res.affected ?? 0;
  }

  private async createSession(
    m: EntityManager,
    user: User,
    remember: boolean,
    meta: RequestMeta,
    familyId: string,
  ): Promise<TokenPair & { refreshToken: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const ttlMs = remember
      ? this.env.REFRESH_TTL_REMEMBER_DAYS * 86_400_000
      : this.env.REFRESH_TTL_SESSION_HOURS * 3_600_000;
    await m.getRepository(UserSession).insert({
      userId: user.id,
      familyId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs),
      remember,
      userAgent: meta.userAgent,
      ip: meta.ip,
      lastUsedAt: new Date(),
    });
    const payload: AccessTokenPayload = { sub: user.id, sid: familyId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }

  refreshTtlMs(remember: boolean): number {
    return remember
      ? this.env.REFRESH_TTL_REMEMBER_DAYS * 86_400_000
      : this.env.REFRESH_TTL_SESSION_HOURS * 3_600_000;
  }
}
