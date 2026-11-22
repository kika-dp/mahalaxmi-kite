import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  ADJUSTMENT_TYPES,
  AdjustmentStatus,
  AdjustmentType,
  DATE_PATTERN,
  Permission,
  STOCK_MOVEMENT_TYPES,
  STOCK_REFERENCE_TYPES,
  StockMovementType,
  StockReferenceType,
} from '@kite/shared';
import { AuthContext, CurrentUser, Permissions, ReqMeta, RequestMeta } from '../../common/decorators';
import { PageQuery } from '../../common/utils/pagination';
import { InventoryService } from './inventory.service';

class StockLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000_000) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) unitCostPaise?: number;
}

class ReceiveDto {
  @ApiProperty({ type: [StockLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StockLineDto)
  items: StockLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class AdjustmentDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ enum: ADJUSTMENT_TYPES }) @IsIn(ADJUSTMENT_TYPES) type: AdjustmentType;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000_000) quantity: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

class DecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class InventoryQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['in', 'low', 'out'] }) @IsOptional() @IsIn(['in', 'low', 'out']) stock?: 'in' | 'low' | 'out';
}

class MovementsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_TYPES }) @IsOptional() @IsIn(STOCK_MOVEMENT_TYPES) type?: StockMovementType;
  @ApiPropertyOptional({ enum: STOCK_REFERENCE_TYPES }) @IsOptional() @IsIn(STOCK_REFERENCE_TYPES) referenceType?: StockReferenceType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() referenceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
}

class AdjustmentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPLIED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPLIED', 'REJECTED'])
  status?: AdjustmentStatus;
}

class DailyStockQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
}

class OpenCountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class CountLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_000) countedQuantity: number;
}

class CountItemsDto {
  @ApiProperty({ type: [CountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  items: CountLineDto[];
}

const viewCost = (u: AuthContext) => u.permissions.has(Permission.CATALOG_VIEW_COST);

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  list(@Query() q: InventoryQuery, @CurrentUser() u: AuthContext) {
    return this.inventory.list(q, viewCost(u));
  }

  @Get('summary')
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  summary(@CurrentUser() u: AuthContext) {
    return this.inventory.summary(viewCost(u));
  }

  @Get('low-stock')
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  lowStock(@CurrentUser() u: AuthContext) {
    return this.inventory.lowStock(viewCost(u));
  }

  @Get('movements')
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  movements(@Query() q: MovementsQuery, @CurrentUser() u: AuthContext) {
    return this.inventory.movements(q, viewCost(u));
  }

  @Get('daily-stock')
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  dailyStock(@Query() q: DailyStockQuery) {
    return this.inventory.dailyStock(q);
  }

  @Post('opening')
  @Permissions(Permission.INVENTORY_RECEIVE)
  opening(@Body() dto: ReceiveDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.receive(dto.items, { opening: true, reason: dto.reason }, u, meta);
  }

  @Post('receipts')
  @Permissions(Permission.INVENTORY_RECEIVE)
  receipts(@Body() dto: ReceiveDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.receive(dto.items, { opening: false, reason: dto.reason }, u, meta);
  }

  @Get('adjustments')
  @Permissions(Permission.INVENTORY_VIEW_LEDGER)
  adjustments(@Query() q: AdjustmentsQuery) {
    return this.inventory.listAdjustments(q);
  }

  @Post('adjustments')
  @Permissions(Permission.INVENTORY_ADJUST)
  adjust(@Body() dto: AdjustmentDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.createAdjustment(dto, u, meta);
  }

  @Post('adjustments/:id/approve')
  @HttpCode(200)
  @Permissions(Permission.INVENTORY_APPROVE)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.decideAdjustment(id, true, dto.note, u, meta);
  }

  @Post('adjustments/:id/reject')
  @HttpCode(200)
  @Permissions(Permission.INVENTORY_APPROVE)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.decideAdjustment(id, false, dto.note, u, meta);
  }

  @Get('counts')
  @Permissions(Permission.INVENTORY_ADJUST)
  counts(@Query() q: PageQuery) {
    return this.inventory.listCounts(q);
  }

  @Post('counts')
  @Permissions(Permission.INVENTORY_ADJUST)
  openCount(@Body() dto: OpenCountDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.openCount(dto.notes, u, meta);
  }

  @Get('counts/:id')
  @Permissions(Permission.INVENTORY_ADJUST)
  count(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getCount(id);
  }

  @Put('counts/:id/items')
  @Permissions(Permission.INVENTORY_ADJUST)
  countItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CountItemsDto, @CurrentUser() u: AuthContext) {
    return this.inventory.recordCountItems(id, dto.items, u);
  }

  @Post('counts/:id/complete')
  @HttpCode(200)
  @Permissions(Permission.INVENTORY_ADJUST)
  completeCount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.completeCount(id, u, meta);
  }

  @Post('counts/:id/cancel')
  @HttpCode(200)
  @Permissions(Permission.INVENTORY_ADJUST)
  cancelCount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.inventory.cancelCount(id, u, meta);
  }
}
