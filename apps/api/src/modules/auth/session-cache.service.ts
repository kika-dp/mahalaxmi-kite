import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Role } from '@kite/shared';

export interface SessionState {
  valid: boolean;
  userId: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

/**
 * Per-request session validity check with a short in-process cache.
 * Any revocation/user change calls `invalidate()` so it takes effect on the next request.
 */
@Injectable()
export class SessionCacheService {
  private readonly cache = new Map<string, { at: number; state: SessionState | null }>();
  private readonly ttlMs = 10_000;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async get(familyId: string, userId: string): Promise<SessionState | null> {
    const key = `${familyId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.state;
    const rows: {
      id: string;
      username: string;
      full_name: string;
      role: Role;
      is_active: boolean;
      must_change_password: boolean;
      session_ok: boolean;
    }[] = await this.ds.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.must_change_password,
              EXISTS (SELECT 1 FROM user_sessions s
                      WHERE s.family_id = $1 AND s.user_id = u.id
                        AND s.revoked_at IS NULL AND s.expires_at > now()) AS session_ok
       FROM users u WHERE u.id = $2`,
      [familyId, userId],
    );
    const r = rows[0];
    const state: SessionState | null = r
      ? {
          valid: r.session_ok && r.is_active,
          userId: r.id,
          username: r.username,
          fullName: r.full_name,
          role: r.role,
          isActive: r.is_active,
          mustChangePassword: r.must_change_password,
        }
      : null;
    if (this.cache.size > 5_000) this.cache.clear();
    this.cache.set(key, { at: Date.now(), state });
    return state;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
