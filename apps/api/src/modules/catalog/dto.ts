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
import { PRODUCT_KINDS, ProductKind, SKU_PATTERN, UNIT_TYPES, UnitType } from '@kite/shared';
import { PageQuery } from '../../common/utils/pagination';

const MAX_PRICE = 10_000_000_00; // ₹1 crore in paise
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value);

export class CategoryDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BundleItemDto {
  @ApiProperty() @IsUUID() componentProductId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(9999) quantity: number;
}

export class CreateProductDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional({ description: 'Auto-generated when blank' })
  @IsOptional()
  @Transform(upperTrim)
  @ValidateIf((_, v) => v !== '' && v !== null)
  @Matches(SKU_PATTERN, { message: 'SKU: letters, digits, - or _ (max 40)' })
  sku?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) barcode?: string | null;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ enum: PRODUCT_KINDS }) @IsIn(PRODUCT_KINDS) kind: ProductKind;
  @ApiProperty({ enum: UNIT_TYPES }) @IsIn(UNIT_TYPES) unitType: UnitType;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) purchasePricePaise?: number;
  @ApiProperty() @IsInt() @Min(0) @Max(MAX_PRICE) sellingPricePaise: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(MAX_PRICE) mrpPaise?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minStockAlert?: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() supplierId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFavorite?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) favoriteOrder?: number;
  @ApiPropertyOptional({ description: 'STANDARD only: opening stock in base units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  openingStock?: number;
  @ApiPropertyOptional({ type: [BundleItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  bundleItems?: BundleItemDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upperTrim) @Matches(SKU_PATTERN) sku?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) barcode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: UNIT_TYPES }) @IsOptional() @IsIn(UNIT_TYPES) unitType?: UnitType;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) purchasePricePaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) sellingPricePaise?: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(MAX_PRICE) mrpPaise?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minStockAlert?: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() supplierId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFavorite?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) favoriteOrder?: number;
  @ApiPropertyOptional({ type: [BundleItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  bundleItems?: BundleItemDto[];
}

export class ProductsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: PRODUCT_KINDS }) @IsOptional() @IsIn(PRODUCT_KINDS) kind?: ProductKind;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isFavorite?: boolean;
  @ApiPropertyOptional({ enum: ['in', 'low', 'out'] }) @IsOptional() @IsIn(['in', 'low', 'out']) stock?: 'in' | 'low' | 'out';
  @ApiPropertyOptional({ enum: ['name', 'price', 'quantity', 'updated', 'sku'] })
  @IsOptional()
  @IsIn(['name', 'price', 'quantity', 'updated', 'sku'])
  sort?: 'name' | 'price' | 'quantity' | 'updated' | 'sku';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class BulkPriceItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) sellingPricePaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) purchasePricePaise?: number;
}

export class BulkPriceDto {
  @ApiProperty({ type: [BulkPriceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkPriceItemDto)
  items: BulkPriceItemDto[];
}

export class ImportQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() dryRun?: boolean;
}

export class LookupQuery {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) code: string;
}
