import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DATE_PATTERN, Permission } from '@kite/shared';
import { Authenticated, AuthContext, CurrentUser, Permissions, ReqMeta, RequestMeta } from '../../common/decorators';
import { imageUploadOptions, saveImage } from '../../common/utils/uploads';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) shopName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail() email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) brandColor?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9]{1,10}$/, { message: 'Prefix: 1–10 capital letters/digits' }) invoicePrefix?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(40) invoiceTitle?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) invoiceFooter?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() taxEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) taxLabel?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBps?: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[0-9A-Z]{15}$/, { message: 'GSTIN must be 15 characters' }) gstin?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) salespersonMaxDiscountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) defaultMinStockAlert?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireCustomerPhoneForCredit?: boolean;
}

class SeasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(60) name: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{2,20}$/) code: string;
  @ApiProperty() @Matches(DATE_PATTERN) startsOn: string;
  @ApiProperty() @Matches(DATE_PATTERN) endsOn: string;
  @ApiProperty() @Matches(/^[A-Z0-9]{1,10}$/) invoiceSeries: string;
}

class UpdateSeasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) startsOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) endsOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9]{1,10}$/) invoiceSeries?: string;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings')
  @Authenticated()
  get() {
    return this.settings.get();
  }

  @Patch('settings')
  @Permissions(Permission.SETTINGS_MANAGE)
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.settings.update(dto, actor, meta);
  }

  @Post('settings/logo')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @Permissions(Permission.SETTINGS_MANAGE)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async logo(@UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.settings.setLogo(await saveImage(file), actor, meta);
  }

  @Get('seasons')
  @Authenticated()
  seasons() {
    return this.settings.listSeasons();
  }

  @Post('seasons')
  @Permissions(Permission.SETTINGS_MANAGE)
  createSeason(@Body() dto: SeasonDto, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.settings.createSeason(dto, actor, meta);
  }

  @Patch('seasons/:id')
  @Permissions(Permission.SETTINGS_MANAGE)
  updateSeason(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSeasonDto, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.settings.updateSeason(id, dto, actor, meta);
  }

  @Post('seasons/:id/activate')
  @HttpCode(200)
  @Permissions(Permission.SETTINGS_MANAGE)
  activateSeason(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.settings.activateSeason(id, actor, meta);
  }
}
