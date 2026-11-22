import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  normalizeIndianPhone,
  passwordPolicyError,
  Permission,
  PRIVILEGED_ROLES,
  Role,
  UserRecord,
} from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors, pgCode, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { offset, paged } from '../../common/utils/pagination';
import { User } from '../../database/entities';
import { AuditService } from '../audit/audit.service';
import { AuthService, toAuthUser } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { SessionCacheService } from '../auth/session-cache.service';
import type { CreateUserDto, UpdateUserDto } from './users.controller';

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  private repo() {
    return this.ds.getRepository(User);
  }

  private async toRecord(u: User): Promise<UserRecord> {
    const [{ n }] = await this.ds.query(
      `SELECT count(DISTINCT family_id)::int AS n FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [u.id],
    );
    return {
      ...toAuthUser(u),
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
      activeSessions: n,
    };
  }

  /** ADMINs may only manage non-privileged users; SUPER_ADMIN manages everyone. */
  private assertCanManage(actor: AuthContext, targetRole: Role): void {
    if (PRIVILEGED_ROLES.includes(targetRole) && !actor.permissions.has(Permission.USERS_MANAGE_ADMINS)) {
      throw Errors.forbidden('Only a Super Admin can manage admin accounts');
    }
  }

  private async assertNotLastSuperAdmin(target: User): Promise<void> {
    if (target.role !== Role.SUPER_ADMIN || !target.isActive) return;
    const count = await this.repo().countBy({ role: Role.SUPER_ADMIN, isActive: true });
    if (count <= 1) throw Errors.invalidState('Cannot remove the last active Super Admin');
  }

  async list(q: { page: number; pageSize: number; role?: Role; isActive?: boolean; q?: string }) {
    const qb = this.repo().createQueryBuilder('u').orderBy('u.role').addOrderBy('u.username');
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.isActive !== undefined) qb.andWhere('u.isActive = :a', { a: q.isActive });
    if (q.q) qb.andWhere('(u.username ILIKE :s OR u.fullName ILIKE :s OR u.email ILIKE :s)', { s: `%${q.q}%` });
    const [rows, total] = await qb.skip(offset(q)).take(q.pageSize).getManyAndCount();
    return paged(await Promise.all(rows.map((u) => this.toRecord(u))), total, q);
  }

  async staffDirectory() {
    const rows = await this.repo().find({ order: { fullName: 'ASC' } });
    return rows.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, isActive: u.isActive }));
  }

  async get(id: string) {
    const u = await this.repo().findOneBy({ id });
    if (!u) throw Errors.notFound('User');
    return this.toRecord(u);
  }

  async create(dto: CreateUserDto, actor: AuthContext, meta: RequestMeta) {
    this.assertCanManage(actor, dto.role);
    const policy = passwordPolicyError(dto.password, dto.username);
    if (policy) throw Errors.validation(policy, [{ field: 'password', message: policy }]);
    const phone = dto.phone ? normalizeIndianPhone(dto.phone) : null;
    if (dto.phone && !phone) throw Errors.validation('Invalid phone number');
    try {
      const user = await this.ds.transaction(async (m) => {
        const saved = await m.getRepository(User).save(
          m.getRepository(User).create({
            username: dto.username,
            email: dto.email,
            fullName: dto.fullName.trim(),
            phone,
            role: dto.role,
            passwordHash: await this.passwords.hash(dto.password),
            mustChangePassword: true,
            isActive: true,
            maxDiscountBps: dto.maxDiscountBps ?? null,
          }),
        );
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'USER_CREATED',
            entityType: 'user',
            entityId: saved.id,
            after: { username: saved.username, role: saved.role, email: saved.email },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
        return saved;
      });
      return this.toRecord(user);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('Username or email already in use');
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthContext, meta: RequestMeta) {
    const user = await this.repo().findOneBy({ id });
    if (!user) throw Errors.notFound('User');
    this.assertCanManage(actor, user.role);
    if (dto.role && dto.role !== user.role) {
      this.assertCanManage(actor, dto.role);
      if (user.id === actor.userId) throw Errors.invalidState('You cannot change your own role');
      await this.assertNotLastSuperAdmin(user);
    }
    const before = toAuthUser(user);
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      const phone = dto.phone ? normalizeIndianPhone(dto.phone) : null;
      if (dto.phone && !phone) throw Errors.validation('Invalid phone number');
      user.phone = phone;
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.maxDiscountBps !== undefined) user.maxDiscountBps = dto.maxDiscountBps;
    try {
      await this.ds.transaction(async (m) => {
        await m.getRepository(User).save(user);
        await this.audit.log(
          {
            actorId: actor.userId,
            actorUsername: actor.username,
            action: 'USER_UPDATED',
            entityType: 'user',
            entityId: user.id,
            before,
            after: toAuthUser(user),
            ip: meta.ip,
            requestId: meta.requestId,
          },
          m,
        );
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('Email already in use');
      throw err;
    }
    this.sessionCache.invalidate();
    return this.toRecord(user);
  }

  async setActive(id: string, active: boolean, actor: AuthContext, meta: RequestMeta) {
    const user = await this.repo().findOneBy({ id });
    if (!user) throw Errors.notFound('User');
    this.assertCanManage(actor, user.role);
    if (!active && user.id === actor.userId) throw Errors.invalidState('You cannot deactivate your own account');
    if (!active) await this.assertNotLastSuperAdmin(user);
    await this.ds.transaction(async (m) => {
      await m.getRepository(User).update(user.id, { isActive: active, ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}) });
      if (!active) await this.auth.revokeAllForUser(m, user.id, 'USER_DISABLED');
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.get(user.id);
  }

  async resetPassword(id: string, temporaryPassword: string, actor: AuthContext, meta: RequestMeta) {
    const user = await this.repo().findOneBy({ id });
    if (!user) throw Errors.notFound('User');
    this.assertCanManage(actor, user.role);
    const policy = passwordPolicyError(temporaryPassword, user.username);
    if (policy) throw Errors.validation(policy, [{ field: 'temporaryPassword', message: policy }]);
    const hash = await this.passwords.hash(temporaryPassword);
    await this.ds.transaction(async (m) => {
      await m.getRepository(User).update(user.id, {
        passwordHash: hash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      await this.auth.revokeAllForUser(m, user.id, 'PASSWORD_RESET');
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'PASSWORD_RESET',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.get(user.id);
  }

  async revokeSessions(id: string, actor: AuthContext, meta: RequestMeta) {
    const user = await this.repo().findOneBy({ id });
    if (!user) throw Errors.notFound('User');
    this.assertCanManage(actor, user.role);
    const n = await this.ds.transaction(async (m) => {
      const revoked = await this.auth.revokeAllForUser(m, user.id, 'ADMIN_REVOKED');
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'SESSIONS_REVOKED',
          entityType: 'user',
          entityId: user.id,
          metadata: { revoked },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return revoked;
    });
    return { revoked: n };
  }
}
