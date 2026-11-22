import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Permission } from '@kite/shared';
import { Permissions } from '../../common/decorators';
import { DateRangeQuery } from '../../common/utils/pagination';
import { DashboardService } from './dashboard.service';

class TopQuery extends DateRangeQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Permissions(Permission.DASHBOARD_VIEW)
  summary(@Query() q: DateRangeQuery) {
    return this.dashboard.summary(q.from, q.to);
  }

  @Get('sales-trend')
  @Permissions(Permission.DASHBOARD_VIEW)
  trend(@Query() q: DateRangeQuery) {
    return this.dashboard.salesTrend(q.from, q.to);
  }

  @Get('payment-summary')
  @Permissions(Permission.DASHBOARD_VIEW)
  payments(@Query() q: DateRangeQuery) {
    return this.dashboard.paymentSummary(q.from, q.to);
  }

  @Get('top-products')
  @Permissions(Permission.DASHBOARD_VIEW)
  top(@Query() q: TopQuery) {
    return this.dashboard.topProducts(q.from, q.to, q.limit ?? 10);
  }

  @Get('employee-performance')
  @Permissions(Permission.DASHBOARD_VIEW)
  employees(@Query() q: DateRangeQuery) {
    return this.dashboard.employeePerformance(q.from, q.to);
  }

  @Get('stock-overview')
  @Permissions(Permission.DASHBOARD_VIEW)
  stock() {
    return this.dashboard.stockOverview();
  }
}
