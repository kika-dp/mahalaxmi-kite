import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  DATE_PATTERN,
  INVOICE_STATUSES,
  InvoiceStatus,
  MAX_BILL_LINES,
  MAX_LINE_QUANTITY,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PaymentMethod,
  PaymentStatus,
} from '@kite/shared';
import { PageQuery } from '../../common/utils/pagination';

const MAX_AMOUNT = 1_000_000_000; // ₹1 crore

export class DiscountDto {
  @ApiProperty({ enum: ['FIXED', 'PERCENT'] }) @IsIn(['FIXED', 'PERCENT']) type: 'FIXED' | 'PERCENT';
  @ApiProperty({ description: 'FIXED: paise; PERCENT: basis points (1000 = 10%)' })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  value: number;
}

export class BillDiscountDto extends DiscountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class InvoiceItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_LINE_QUANTITY) quantity: number;
  @ApiPropertyOptional({ type: DiscountDto })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CustomerInputDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
}

export class PaymentInputDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_AMOUNT) amountPaise: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class DiscountApprovalDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) username: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
}

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Generated once per cart on the device; retries reuse it' }) @IsUUID() idempotencyKey: string;
  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item' })
  @ArrayMaxSize(MAX_BILL_LINES)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
  @ApiPropertyOptional({ type: BillDiscountDto })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => BillDiscountDto)
  billDiscount?: BillDiscountDto | null;
  @ApiPropertyOptional({ type: CustomerInputDto })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => CustomerInputDto)
  customer?: CustomerInputDto | null;
  @ApiPropertyOptional({ type: [PaymentInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];
  @ApiPropertyOptional({ type: DiscountApprovalDto })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => DiscountApprovalDto)
  discountApproval?: DiscountApprovalDto | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Preview accepts the same body but the idempotency key is optional. */
export class PreviewInvoiceDto extends CreateInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() declare idempotencyKey: string;
}

export class RecordPaymentsDto {
  @ApiProperty() @IsUUID() idempotencyKey: string;
  @ApiPropertyOptional({ type: [PaymentInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];
  @ApiPropertyOptional({ description: 'Pay the full outstanding amount with `method`' }) @IsOptional() @IsBoolean() markPaid?: boolean;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
}

export class ReturnLineDto {
  @ApiProperty() @IsUUID() invoiceItemId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_LINE_QUANTITY) quantity: number;
  @ApiProperty() @IsBoolean() restock: boolean;
}

export class RefundInputDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_AMOUNT) amountPaise: number;
}

export class ReturnDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BILL_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];
  @ApiPropertyOptional({ type: RefundInputDto })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => RefundInputDto)
  refund?: RefundInputDto | null;
}

export class RefundDto extends RefundInputDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

export class VoidDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) refundMethod?: PaymentMethod;
}

export class InvoicesQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() salespersonId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES) paymentStatus?: PaymentStatus;
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES) status?: InvoiceStatus;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) minTotalPaise?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxTotalPaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() mine?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() hasOutstanding?: boolean;
  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'total_desc', 'total_asc', 'outstanding_desc'] })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'total_desc', 'total_asc', 'outstanding_desc'])
  sort?: string;
}

export class PdfQuery {
  @ApiPropertyOptional({ enum: ['a4', 'thermal'] }) @IsOptional() @IsIn(['a4', 'thermal']) format?: 'a4' | 'thermal';
}
