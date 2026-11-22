import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import { DATE_PATTERN, Permission, PAYMENT_METHODS, PaymentMethod } from '@kite/shared';
import { AuthContext, CurrentUser, Permissions, ReqMeta, RequestMeta } from '../../common/decorators';
import { PageQuery } from '../../common/utils/pagination';
import { SuppliersService } from './suppliers.service';

class SupplierDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(20) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
}

class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(20) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class PurchaseLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000_000) quantity: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000_000) unitCostPaise: number;
}

class PurchaseDto {
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() supplierId?: string | null;
  @ApiProperty() @Matches(DATE_PATTERN) purchaseDate: string;
  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items: PurchaseLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) amountPaidPaise?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() updateCostPrice?: boolean;
}

class SupplierPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseId?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000_000) amountPaise: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class SuppliersQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
}

class PurchasesQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get('suppliers')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  list(@Query() q: SuppliersQuery) {
    return this.suppliers.list(q);
  }

  @Post('suppliers')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  create(@Body() dto: SupplierDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.suppliers.create(dto, u, meta);
  }

  @Get('suppliers/:id')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.get(id);
  }

  @Patch('suppliers/:id')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.suppliers.update(id, dto, u, meta);
  }

  @Post('suppliers/:id/payments')
  @Permissions(Permission.SUPPLIERS_PAY)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierPaymentDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.suppliers.paySupplier(id, dto, u, meta);
  }

  @Get('purchases')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  purchases(@Query() q: PurchasesQuery) {
    return this.suppliers.listPurchases(q);
  }

  @Post('purchases')
  @Permissions(Permission.INVENTORY_RECEIVE)
  createPurchase(@Body() dto: PurchaseDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.suppliers.createPurchase(dto, u, meta);
  }

  @Get('purchases/:id')
  @Permissions(Permission.SUPPLIERS_MANAGE)
  purchase(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.getPurchase(id);
  }
}
