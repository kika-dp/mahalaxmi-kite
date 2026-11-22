import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogEntry, Permission } from '@kite/shared';
import { Permissions } from '../../common/decorators';
import { offset, paged, PagedDateRangeQuery } from '../../common/utils/pagination';
import { resolveRange } from '../../common/utils/dates';

class AuditQuery extends PagedDateRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityId?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @Permissions(Permission.AUDIT_VIEW)
  async list(@Query() q: AuditQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.actorId) add('actor_id = ?', q.actorId);
    if (q.action) add('action = ?', q.action);
    if (q.entityType) add('entity_type = ?', q.entityType);
    if (q.entityId) add('entity_id = ?', q.entityId);
    if (q.from || q.to) {
      const r = resolveRange(q.from, q.to);
      add('created_at >= ?', r.start);
      add('created_at < ?', r.end);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ count }] = await this.ds.query(`SELECT count(*)::int AS count FROM audit_logs ${whereSql}`, params);
    const rows = await this.ds.query(
      `SELECT id::text, actor_id AS "actorId", actor_username AS "actorUsername", action,
              entity_type AS "entityType", entity_id AS "entityId", before, after, metadata, ip,
              created_at AS "createdAt"
       FROM audit_logs ${whereSql} ORDER BY created_at DESC, id DESC
       LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
      params,
    );
    return paged<AuditLogEntry>(rows, count, q);
  }
}
