import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CASH_MOVEMENT_TYPES, CashMovementType, Permission } from '@kite/shared';
import { AuthContext, CurrentUser, Permissions, ReqMeta, RequestMeta } from '../../common/decorators';
import { PageQuery } from '../../common/utils/pagination';
import { CashService } from './cash.service';

class OpenDto {
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000_000) openingCashPaise: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class MovementDto {
  @ApiProperty({ enum: CASH_MOVEMENT_TYPES }) @IsIn(CASH_MOVEMENT_TYPES) type: CashMovementType;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000_000) amountPaise: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) reason: string;
}
class CloseDto {
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000_000) countedCashPaise: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class ReopenDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

@ApiTags('cash')
@ApiBearerAuth()
@Controller('cash-sessions')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @Permissions(Permission.CASH_MANAGE)
  list(@Query() q: PageQuery) {
    return this.cash.list(q);
  }

  @Get('today')
  @Permissions(Permission.CASH_MANAGE)
  today() {
    return this.cash.today();
  }

  @Get(':id')
  @Permissions(Permission.CASH_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.cash.get(id);
  }

  @Post()
  @Permissions(Permission.CASH_MANAGE)
  open(@Body() dto: OpenDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.cash.open(dto, u, meta);
  }

  @Post(':id/movements')
  @Permissions(Permission.CASH_MANAGE)
  movement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MovementDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.cash.addMovement(id, dto, u, meta);
  }

  @Post(':id/close')
  @HttpCode(200)
  @Permissions(Permission.CASH_MANAGE)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.cash.close(id, dto, u, meta);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Permissions(Permission.CASH_REOPEN)
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.cash.reopen(id, dto.reason, u, meta);
  }
}
