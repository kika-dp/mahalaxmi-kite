import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@kite/shared';
import { AnyPermission, AuthContext, CurrentUser, Permissions, RawResponse, ReqMeta, RequestMeta } from '../../common/decorators';
import { Envelope } from '../../common/interceptors/response.interceptor';
import { PdfService } from '../documents/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { CreateInvoiceDto, InvoicesQuery, PdfQuery, PreviewInvoiceDto, RecordPaymentsDto, RefundDto, ReturnDto, VoidDto } from './dto';
import { InvoicesQueryService } from './invoices.query';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly query: InvoicesQueryService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @Permissions(Permission.INVOICES_CREATE)
  preview(@Body() dto: PreviewInvoiceDto, @CurrentUser() u: AuthContext) {
    return this.invoices.preview(dto, u);
  }

  /** 201 for a new invoice; 200 with meta.replayed=true when the idempotency key was already used. */
  @Post()
  @Permissions(Permission.INVOICES_CREATE)
  async create(@Body() dto: CreateInvoiceDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { invoice, replayed } = await this.invoices.create(dto, u, meta);
    res.status(replayed ? 200 : 201);
    return new Envelope(invoice, { replayed });
  }

  @Get()
  @AnyPermission(Permission.INVOICES_READ_ALL, Permission.INVOICES_READ_OWN)
  list(@Query() q: InvoicesQuery, @CurrentUser() u: AuthContext) {
    return this.query.list(q, u);
  }

  @Get(':id')
  @AnyPermission(Permission.INVOICES_READ_ALL, Permission.INVOICES_READ_OWN)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext) {
    return this.query.get(id, u);
  }

  @Get(':id/pdf')
  @RawResponse()
  @AnyPermission(Permission.INVOICES_READ_ALL, Permission.INVOICES_READ_OWN)
  async pdfFile(@Param('id', ParseUUIDPipe) id: string, @Query() q: PdfQuery, @CurrentUser() u: AuthContext, @Res() res: Response) {
    const invoice = await this.query.get(id, u);
    const buf = await this.pdf.invoice(invoice, await this.settings.get(), q.format ?? 'a4');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Get(':id/repeat')
  @Permissions(Permission.INVOICES_CREATE)
  repeat(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext) {
    return this.query.repeat(id, u);
  }

  @Post(':id/payments')
  @Permissions(Permission.PAYMENTS_RECORD)
  async payments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentsDto,
    @CurrentUser() u: AuthContext,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { invoice, replayed } = await this.invoices.recordPayments(id, dto, u, meta);
    res.status(replayed ? 200 : 201);
    return new Envelope(invoice, { replayed });
  }

  @Post(':id/returns')
  @Permissions(Permission.INVOICES_RETURN)
  returns(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.invoices.createReturn(id, dto, u, meta);
  }

  @Post(':id/refunds')
  @Permissions(Permission.INVOICES_REFUND)
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.invoices.refund(id, dto, u, meta);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Permissions(Permission.INVOICES_VOID)
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.invoices.voidInvoice(id, dto, u, meta);
  }
}
