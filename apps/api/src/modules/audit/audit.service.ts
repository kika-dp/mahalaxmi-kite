import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from '../../database/entities';

export interface AuditEntry {
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

const SENSITIVE_KEYS = /password|token|secret|hash/i;

/** Remove secrets from objects stored in the audit log. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value ?? null;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Write an audit entry. Pass the caller's EntityManager to make the entry part of the same
   * transaction (so it rolls back with the business change).
   */
  async log(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repo = (manager ?? this.ds.manager).getRepository(AuditLog);
    await repo.insert({
      actorId: entry.actorId ?? null,
      actorUsername: entry.actorUsername ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: sanitize(entry.before) as object,
      after: sanitize(entry.after) as object,
      metadata: sanitize(entry.metadata) as object,
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    });
  }

  /** Fire-and-forget variant for non-transactional events (e.g. failed logins). */
  logAsync(entry: AuditEntry): void {
    this.log(entry).catch((err) => this.logger.error({ err }, 'Failed to write audit log'));
  }
}
