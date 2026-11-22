import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { istDateString, Season, ShopSettings } from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors, pgCode, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { publicUrl } from '../../common/utils/uploads';
import { SeasonEntity, ShopSettingsEntity } from '../../database/entities';
import { AuditService } from '../audit/audit.service';

export function toSettings(s: ShopSettingsEntity): ShopSettings {
  return {
    shopName: s.shopName,
    address: s.address,
    phone: s.phone,
    email: s.email,
    logoUrl: publicUrl(s.logoUrl),
    brandColor: s.brandColor,
    invoicePrefix: s.invoicePrefix,
    invoiceTitle: s.invoiceTitle,
    invoiceFooter: s.invoiceFooter,
    taxEnabled: s.taxEnabled,
    taxLabel: s.taxLabel,
    taxRateBps: s.taxRateBps,
    gstin: s.gstin,
    salespersonMaxDiscountBps: s.salespersonMaxDiscountBps,
    defaultMinStockAlert: s.defaultMinStockAlert,
    requireCustomerPhoneForCredit: s.requireCustomerPhoneForCredit,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toSeason(s: SeasonEntity): Season {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    invoiceSeries: s.invoiceSeries,
    isActive: s.isActive,
  };
}

export type SettingsPatch = Partial<Omit<ShopSettings, 'logoUrl' | 'updatedAt'>>;

@Injectable()
export class SettingsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async getEntity(m: EntityManager = this.ds.manager): Promise<ShopSettingsEntity> {
    const s = await m.getRepository(ShopSettingsEntity).findOneBy({ id: 1 });
    if (!s) throw Errors.invalidState('Shop settings are missing. Run the seeder/bootstrap.');
    return s;
  }

  async get(): Promise<ShopSettings> {
    return toSettings(await this.getEntity());
  }

  async update(patch: SettingsPatch, actor: AuthContext, meta: RequestMeta): Promise<ShopSettings> {
    return this.ds.transaction(async (m) => {
      const s = await this.getEntity(m);
      const before = toSettings(s);
      Object.assign(s, patch, { updatedBy: actor.userId });
      if (s.taxEnabled && s.taxRateBps <= 0) throw Errors.validation('Set a tax rate when tax is enabled');
      await m.getRepository(ShopSettingsEntity).save(s);
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'SETTINGS_UPDATED',
          entityType: 'settings',
          entityId: '1',
          before,
          after: toSettings(s),
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
      return toSettings(s);
    });
  }

  async setLogo(relativePath: string, actor: AuthContext, meta: RequestMeta): Promise<ShopSettings> {
    await this.ds.getRepository(ShopSettingsEntity).update(1, { logoUrl: relativePath, updatedBy: actor.userId });
    this.audit.logAsync({ actorId: actor.userId, action: 'SETTINGS_LOGO_UPDATED', entityType: 'settings', ip: meta.ip });
    return this.get();
  }

  // ---------------------------------------------------------------- seasons
  async listSeasons(): Promise<Season[]> {
    const rows = await this.ds.getRepository(SeasonEntity).find({ order: { startsOn: 'DESC' } });
    return rows.map(toSeason);
  }

  async activeSeason(m: EntityManager = this.ds.manager): Promise<SeasonEntity | null> {
    return m.getRepository(SeasonEntity).findOneBy({ isActive: true });
  }

  /** Invoice number series: active season's series, else the IST calendar year. */
  async invoiceSeries(m: EntityManager): Promise<{ series: string; seasonId: string | null }> {
    const season = await this.activeSeason(m);
    return season ? { series: season.invoiceSeries, seasonId: season.id } : { series: istDateString().slice(0, 4), seasonId: null };
  }

  async createSeason(dto: Omit<Season, 'id' | 'isActive'>, actor: AuthContext, meta: RequestMeta): Promise<Season> {
    if (dto.endsOn < dto.startsOn) throw Errors.validation('End date must be on or after the start date');
    try {
      const saved = await this.ds.getRepository(SeasonEntity).save({ ...dto, isActive: false });
      this.audit.logAsync({ actorId: actor.userId, action: 'SEASON_CREATED', entityType: 'season', entityId: saved.id, after: dto, ip: meta.ip });
      return toSeason(saved);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A season with this name or code exists');
      throw err;
    }
  }

  async updateSeason(id: string, dto: Partial<Omit<Season, 'id' | 'isActive'>>, actor: AuthContext, meta: RequestMeta): Promise<Season> {
    const repo = this.ds.getRepository(SeasonEntity);
    const s = await repo.findOneBy({ id });
    if (!s) throw Errors.notFound('Season');
    Object.assign(s, dto);
    if (s.endsOn < s.startsOn) throw Errors.validation('End date must be on or after the start date');
    try {
      await repo.save(s);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.duplicate('A season with this name or code exists');
      throw err;
    }
    this.audit.logAsync({ actorId: actor.userId, action: 'SEASON_UPDATED', entityType: 'season', entityId: id, after: dto, ip: meta.ip });
    return toSeason(s);
  }

  async activateSeason(id: string, actor: AuthContext, meta: RequestMeta): Promise<Season> {
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(SeasonEntity);
      const s = await repo.findOneBy({ id });
      if (!s) throw Errors.notFound('Season');
      await repo.update({ isActive: true }, { isActive: false });
      await repo.update(id, { isActive: true });
      await this.audit.log(
        { actorId: actor.userId, actorUsername: actor.username, action: 'SEASON_ACTIVATED', entityType: 'season', entityId: id, ip: meta.ip },
        m,
      );
      return toSeason({ ...s, isActive: true });
    });
  }
}
