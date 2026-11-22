import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CashMovementType, CashSession, CashSessionStatus, CashSummary, istDateString } from '@kite/shared';
import { AuthContext, RequestMeta } from '../../common/decorators';
import { Errors, pgCode, PG_UNIQUE_VIOLATION } from '../../common/errors';
import { resolveRange } from '../../common/utils/dates';
import { offset, paged } from '../../common/utils/pagination';
import { CashMovementEntity, CashSessionEntity } from '../../database/entities';
import { AuditService } from '../audit/audit.service';

const n = (v: unknown) => Number(v ?? 0);
const ref = (id: string | null, name: string | null, username: string | null) => (id ? { id, fullName: name ?? '', username: username ?? '' } : null);

/**
 * Daily shop closing (specification.md §13). Expected cash is derived only from recorded CASH
 * payments/refunds and cash movements on the IST business date — never from unpaid invoices.
 */
@Injectable()
export class CashService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async computeSummary(businessDate: string, openingCashPaise: number, sessionId: string | null, m: EntityManager = this.ds.manager): Promise<CashSummary> {
    const r = resolveRange(businessDate, businessDate);
    const [p] = await m.query(
      `SELECT
         COALESCE(sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'CASH'), 0) AS cash_in,
         COALESCE(sum(amount_paise) FILTER (WHERE direction = 'OUT' AND method = 'CASH'), 0) AS cash_out,
         COALESCE(sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'UPI'), 0) AS upi,
         COALESCE(sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'CARD'), 0) AS card,
         COALESCE(sum(amount_paise) FILTER (WHERE direction = 'IN' AND method = 'OTHER'), 0) AS other
       FROM payments WHERE created_at >= $1 AND created_at < $2`,
      [r.start, r.end],
    );
    const [mv] = sessionId
      ? await m.query(
          `SELECT COALESCE(sum(amount_paise) FILTER (WHERE type = 'OTHER_RECEIPT'), 0) AS receipts,
                  COALESCE(sum(amount_paise) FILTER (WHERE type IN ('PAYOUT','EXPENSE')), 0) AS payouts
           FROM cash_movements WHERE cash_session_id = $1`,
          [sessionId],
        )
      : [{ receipts: 0, payouts: 0 }];
    const [b] = await m.query(
      `SELECT count(*) AS bills, COALESCE(sum(total_paise), 0) AS value FROM invoices
       WHERE status = 'FINALIZED' AND created_at >= $1 AND created_at < $2`,
      [r.start, r.end],
    );
    const [o] = await m.query(`SELECT COALESCE(sum(outstanding_paise), 0) AS o FROM invoices WHERE status = 'FINALIZED'`);
    const expected = openingCashPaise + n(p.cash_in) + n(mv.receipts) - n(p.cash_out) - n(mv.payouts);
    return {
      businessDate,
      openingCashPaise,
      cashSalesPaise: n(p.cash_in),
      otherReceiptsPaise: n(mv.receipts),
      cashRefundsPaise: n(p.cash_out),
      payoutsPaise: n(mv.payouts),
      expectedCashPaise: expected,
      upiPaise: n(p.upi),
      cardPaise: n(p.card),
      otherMethodPaise: n(p.other),
      billsCount: n(b.bills),
      billsValuePaise: n(b.value),
      pendingCustomerPaymentsPaise: n(o.o),
    };
  }

  async get(id: string): Promise<CashSession> {
    const [s] = await this.ds.query(
      `SELECT cs.*, to_char(cs.business_date, 'YYYY-MM-DD') AS bdate, ou.full_name AS o_name, ou.username::text AS o_username,
              cu.full_name AS c_name, cu.username::text AS c_username
       FROM cash_sessions cs JOIN users ou ON ou.id = cs.opened_by_id LEFT JOIN users cu ON cu.id = cs.closed_by_id
       WHERE cs.id = $1`,
      [id],
    );
    if (!s) throw Errors.notFound('Cash session');
    const movements = await this.ds.query(
      `SELECT m.*, u.full_name, u.username::text AS username FROM cash_movements m JOIN users u ON u.id = m.created_by_id
       WHERE m.cash_session_id = $1 ORDER BY m.created_at`,
      [id],
    );
    const summary: CashSummary =
      s.status === CashSessionStatus.CLOSED && s.summary ? (s.summary as CashSummary) : await this.computeSummary(s.bdate, n(s.opening_cash_paise), id);
    return {
      id: s.id,
      businessDate: s.bdate,
      status: s.status,
      openingCashPaise: n(s.opening_cash_paise),
      openedBy: ref(s.opened_by_id, s.o_name, s.o_username)!,
      openedAt: new Date(s.opened_at).toISOString(),
      closedBy: ref(s.closed_by_id, s.c_name, s.c_username),
      closedAt: s.closed_at ? new Date(s.closed_at).toISOString() : null,
      expectedCashPaise: s.expected_cash_paise === null ? null : n(s.expected_cash_paise),
      countedCashPaise: s.counted_cash_paise === null ? null : n(s.counted_cash_paise),
      differencePaise: s.difference_paise === null ? null : n(s.difference_paise),
      notes: s.notes,
      movements: movements.map((x: Record<string, any>) => ({
        id: x.id,
        type: x.type,
        amountPaise: n(x.amount_paise),
        reason: x.reason,
        createdBy: ref(x.created_by_id, x.full_name, x.username)!,
        createdAt: new Date(x.created_at).toISOString(),
      })),
      summary,
    };
  }

  async today(): Promise<{ session: CashSession | null; preview: CashSummary }> {
    const date = istDateString();
    const [s] = await this.ds.query(`SELECT id, opening_cash_paise FROM cash_sessions WHERE business_date = $1`, [date]);
    if (s) {
      const session = await this.get(s.id);
      return { session, preview: session.summary };
    }
    return { session: null, preview: await this.computeSummary(date, 0, null) };
  }

  async list(q: { page: number; pageSize: number }) {
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM cash_sessions`);
    const ids: { id: string }[] = await this.ds.query(
      `SELECT id FROM cash_sessions ORDER BY business_date DESC LIMIT ${q.pageSize} OFFSET ${offset(q)}`,
    );
    return paged(await Promise.all(ids.map((x) => this.get(x.id))), total, q);
  }

  async open(dto: { openingCashPaise: number; notes?: string }, actor: AuthContext, meta: RequestMeta): Promise<CashSession> {
    try {
      const saved = await this.ds.getRepository(CashSessionEntity).save({
        businessDate: istDateString(),
        status: CashSessionStatus.OPEN,
        openingCashPaise: dto.openingCashPaise,
        openedById: actor.userId,
        openedAt: new Date(),
        notes: dto.notes ?? null,
      });
      this.audit.logAsync({ actorId: actor.userId, actorUsername: actor.username, action: 'CASH_SESSION_OPENED', entityType: 'cash_session', entityId: saved.id, metadata: dto, ip: meta.ip });
      return this.get(saved.id);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw Errors.invalidState("Today's cash session is already open");
      throw err;
    }
  }

  async addMovement(id: string, dto: { type: CashMovementType; amountPaise: number; reason: string }, actor: AuthContext, meta: RequestMeta) {
    await this.ds.transaction(async (m) => {
      const s = await m.getRepository(CashSessionEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw Errors.notFound('Cash session');
      if (s.status !== CashSessionStatus.OPEN) throw Errors.invalidState('This cash session is closed');
      await m.getRepository(CashMovementEntity).insert({ cashSessionId: id, type: dto.type, amountPaise: dto.amountPaise, reason: dto.reason.trim(), createdById: actor.userId });
      await this.audit.log({ actorId: actor.userId, actorUsername: actor.username, action: 'CASH_MOVEMENT', entityType: 'cash_session', entityId: id, metadata: dto, ip: meta.ip }, m);
    });
    return this.get(id);
  }

  async close(id: string, dto: { countedCashPaise: number; notes?: string }, actor: AuthContext, meta: RequestMeta) {
    await this.ds.transaction(async (m) => {
      const s = await m.getRepository(CashSessionEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw Errors.notFound('Cash session');
      if (s.status !== CashSessionStatus.OPEN) throw Errors.invalidState('This cash session is already closed');
      const summary = await this.computeSummary(s.businessDate, s.openingCashPaise, id, m);
      const difference = dto.countedCashPaise - summary.expectedCashPaise;
      await m.getRepository(CashSessionEntity).update(id, {
        status: CashSessionStatus.CLOSED,
        closedById: actor.userId,
        closedAt: new Date(),
        expectedCashPaise: summary.expectedCashPaise,
        countedCashPaise: dto.countedCashPaise,
        differencePaise: difference,
        notes: [s.notes, dto.notes].filter(Boolean).join('\n') || null,
        summary: summary as unknown as object,
      });
      await this.audit.log(
        {
          actorId: actor.userId,
          actorUsername: actor.username,
          action: 'CASH_SESSION_CLOSED',
          entityType: 'cash_session',
          entityId: id,
          metadata: { expected: summary.expectedCashPaise, counted: dto.countedCashPaise, difference },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        m,
      );
    });
    return this.get(id);
  }

  async reopen(id: string, reason: string, actor: AuthContext, meta: RequestMeta) {
    const res = await this.ds
      .getRepository(CashSessionEntity)
      .update({ id, status: CashSessionStatus.CLOSED }, { status: CashSessionStatus.OPEN, closedAt: null, closedById: null, expectedCashPaise: null, countedCashPaise: null, differencePaise: null, summary: null as unknown as object });
    if (!res.affected) throw Errors.invalidState('Only a closed session can be reopened');
    await this.audit.log({ actorId: actor.userId, actorUsername: actor.username, action: 'CASH_SESSION_REOPENED', entityType: 'cash_session', entityId: id, metadata: { reason }, ip: meta.ip });
    return this.get(id);
  }
}
