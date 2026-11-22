import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { DATE_PATTERN, Permission, PAYMENT_METHODS } from '@kite/shared';
import { AnyPermission, AuthContext, CurrentUser, RawResponse } from '../../common/decorators';
import { REPORT_TYPES, ReportsService } from './reports.service';

class ReportQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() salespersonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) @Matches(/^[0-9a-f,-]*$/i) seasonIds?: string;
  @ApiPropertyOptional({ enum: ['json', 'csv', 'xlsx'] }) @IsOptional() @IsIn(['json', 'csv', 'xlsx']) format?: 'json' | 'csv' | 'xlsx';
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @AnyPermission(Permission.REPORTS_FINANCIAL, Permission.REPORTS_INVENTORY)
  list() {
    return REPORT_TYPES;
  }

  /** Per-report permission is enforced in the service (financial vs inventory reports). */
  @Get(':type')
  @RawResponse()
  @ApiParam({ name: 'type', enum: REPORT_TYPES })
  @AnyPermission(Permission.REPORTS_FINANCIAL, Permission.REPORTS_INVENTORY)
  async run(@Param('type') type: string, @Query() q: ReportQuery, @CurrentUser() u: AuthContext, @Res() res: Response) {
    const { format = 'json', ...filters } = q;
    const report = await this.reports.run(type, filters, u);
    const name = `${type}-${filters.from ?? ''}${filters.to ? `_${filters.to}` : ''}`.replace(/-$/, '');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      res.send(this.reports.toCsv(report));
      return;
    }
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      res.send(await this.reports.toXlsx(report));
      return;
    }
    res.json({ data: report });
  }
}
