import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { DATE_PATTERN, Permission, PAYMENT_METHODS, PaymentMethod } from '@kite/shared';
import { AuthContext, CurrentUser, Permissions, RawResponse, ReqMeta, RequestMeta } from '../../common/decorators';
import { PageQuery } from '../../common/utils/pagination';
import { PdfService } from '../documents/pdf.service';
import { InvoicesQueryService } from '../invoices/invoices.query';
import { SettingsService } from '../settings/settings.service';
import { CustomersService } from './customers.service';

class CustomerDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(20) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
}

class UpdateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(20) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
}

class CustomersQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() hasOutstanding?: boolean;
}

class LookupDto {
  @ApiProperty() @IsString() @MaxLength(20) phone: string;
}

class CollectDto {
  @ApiProperty() @IsUUID() idempotencyKey: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000_000) amountPaise: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) invoiceIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class StatementQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly invoices: InvoicesQueryService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Permissions(Permission.CUSTOMERS_READ)
  list(@Query() q: CustomersQuery, @CurrentUser() u: AuthContext) {
    return this.customers.list(q, u);
  }

  @Get('lookup')
  @Permissions(Permission.CUSTOMERS_READ)
  lookup(@Query() q: LookupDto, @CurrentUser() u: AuthContext) {
    return this.customers.lookup(q.phone, u);
  }

  @Post()
  @Permissions(Permission.CUSTOMERS_WRITE)
  create(@Body() dto: CustomerDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.customers.create(dto, u, meta);
  }

  @Get(':id')
  @Permissions(Permission.CUSTOMERS_READ)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext) {
    return this.customers.get(id, u);
  }

  @Patch(':id')
  @Permissions(Permission.CUSTOMERS_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.customers.update(id, dto, u, meta);
  }

  @Get(':id/invoices')
  @Permissions(Permission.CUSTOMERS_READ)
  async invoicesOf(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery, @CurrentUser() u: AuthContext) {
    await this.customers.get(id, u);
    return this.invoices.list({ ...q, customerId: id } as never, u);
  }

  @Post(':id/payments')
  @Permissions(Permission.PAYMENTS_RECORD)
  collect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CollectDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.customers.collect(id, dto, u, meta);
  }

  @Get(':id/statement.pdf')
  @RawResponse()
  @Permissions(Permission.REPORTS_FINANCIAL)
  async statement(@Param('id', ParseUUIDPipe) id: string, @Query() q: StatementQuery, @CurrentUser() u: AuthContext, @Res() res: Response) {
    const data = await this.customers.statement(id, q.from, q.to, u);
    const buf = await this.pdf.statement(data, await this.settings.get());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${data.customer.phone ?? id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }
}
