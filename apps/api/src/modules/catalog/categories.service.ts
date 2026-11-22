import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Category } from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors, pgCode, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { ProductCategory } from '../../database/entities';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<Category[]> {
    const rows: { id: string; name: string; sort_order: number; is_active: boolean; product_count: number }[] =
      await this.ds.query(
        `SELECT c.id, c.name::text AS name, c.sort_order, c.is_active,
                (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
         FROM product_categories c ${includeInactive ? '' : 'WHERE c.is_active'}
         ORDER BY c.sort_order, c.name`,
      );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      isActive: r.is_active,
      productCount: r.product_count,
    }));
  }

  async create(dto: { name: string; sortOrder?: number }, actor: AuthContext, meta: RequestMeta): Promise<Category> {
    try {
      const sortOrder =
        dto.sortOrder ??
        ((await this.ds.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM product_categories`))[0].n as number);
      const saved = await this.ds.getRepository(ProductCategory).save({ name: dto.name, sortOrder });
      this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'CATEGORY_CREATED', entityType: 'category', entityId: saved.id, after: dto, ip: meta.ip });
      return { id: saved.id, name: saved.name, sortOrder: saved.sortOrder, isActive: saved.isActive, productCount: 0 };
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A category with this name already exists');
      throw err;
    }
  }

  async update(
    id: string,
    dto: { name?: string; sortOrder?: number; isActive?: boolean },
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<Category> {
    const repo = this.ds.getRepository(ProductCategory);
    const c = await repo.findOneBy({ id });
    if (!c) throw Errors.notFound('Category');
    const before = { ...c };
    Object.assign(c, dto);
    try {
      await repo.save(c);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A category with this name already exists');
      throw err;
    }
    this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'CATEGORY_UPDATED', entityType: 'category', entityId: id, before, after: dto, ip: meta.ip });
    return (await this.list(true)).find((x) => x.id === id)!;
  }

  async remove(id: string, actor: AuthContext, meta: RequestMeta): Promise<{ deleted: boolean }> {
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM products WHERE category_id = $1`, [id]);
    if (n > 0) throw Errors.invalidState('This category has products. Deactivate it instead of deleting.');
    const res = await this.ds.getRepository(ProductCategory).delete(id);
    if (!res.affected) throw Errors.notFound('Category');
    this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'CATEGORY_DELETED', entityType: 'category', entityId: id, ip: meta.ip });
    return { deleted: true };
  }
}
