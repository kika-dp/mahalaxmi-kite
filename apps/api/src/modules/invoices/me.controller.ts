import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { istDateString, MySummary, Permission } from '@kite/shared';
import { AuthContext, CurrentUser, Permissions } from '../../common/decorators';
import { resolveRange } from '../../common/utils/dates';
import { PageQuery } from '../../common/utils/pagination';
import { InvoicesQueryService } from './invoices.query';

/** Salesperson self-service figures — always scoped to the signed-in user. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly query: InvoicesQueryService,
  ) {}

  @Get('summary')
  @Permissions(Permission.INVOICES_CREATE)
  async summary(@CurrentUser() u: AuthContext): Promise<MySummary> {
    const today = istDateString();
    const r = resolveRange(today, today);
    const [s] = await this.ds.query(
      `SELECT
         (SELECT count(*)::int FROM invoices WHERE salesperson_id = $1 AND status = 'FINALIZED' AND created_at >= $2 AND created_at < $3) AS bills,
         (SELECT COALESCE(sum(total_paise - returned_amount_paise), 0)::bigint FROM invoices
            WHERE salesperson_id = $1 AND status = 'FINALIZED' AND created_at >= $2 AND created_at < $3) AS sales,
         (SELECT COALESCE(sum(CASE WHEN direction = 'IN' THEN amount_paise ELSE -amount_paise END), 0)::bigint FROM payments
            WHERE received_by_id = $1 AND created_at >= $2 AND created_at < $3) AS collected,
         (SELECT COALESCE(sum(outstanding_paise), 0)::bigint FROM invoices WHERE salesperson_id = $1 AND status = 'FINALIZED') AS outstanding,
         (SELECT count(*)::int FROM invoices WHERE salesperson_id = $1 AND status = 'FINALIZED' AND outstanding_paise > 0) AS outstanding_count`,
      [u.userId, r.start, r.end],
    );
    return {
      date: today,
      billsCount: s.bills,
      salesPaise: Number(s.sales),
      collectedPaise: Number(s.collected),
      outstandingPaise: Number(s.outstanding),
      outstandingCount: s.outstanding_count,
    };
  }

  @Get('outstanding')
  @Permissions(Permission.INVOICES_READ_OWN)
  outstanding(@Query() q: PageQuery, @CurrentUser() u: AuthContext) {
    return this.query.list({ ...q, mine: true, hasOutstanding: true, sort: 'oldest' } as never, u);
  }
}
