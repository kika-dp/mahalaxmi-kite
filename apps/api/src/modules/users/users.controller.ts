import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
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
import { Permission, Role, ROLES, USERNAME_PATTERN } from '@kite/shared';
import { AnyPermission, AuthContext, CurrentUser, Permissions, ReqMeta, RequestMeta } from '../../common/decorators';
import { PageQuery } from '../../common/utils/pagination';
import { UsersService } from './users.service';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateUserDto {
  @ApiProperty() @Transform(lower) @Matches(USERNAME_PATTERN, { message: 'username: 3–32 chars a-z 0-9 . _ -' }) username: string;
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(120) email: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role: Role;
  @ApiProperty({ description: 'Temporary password; user must change it at first login' }) @IsString() @MaxLength(128) password: string;
  @ApiPropertyOptional({ description: 'Per-user discount cap in bps (null = shop default)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(10000)
  maxDiscountBps?: number | null;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @Transform(lower) @IsEmail() @MaxLength(120) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(100) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(15) phone?: string | null;
  @ApiPropertyOptional({ enum: ROLES }) @IsOptional() @IsIn(ROLES) role?: Role;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(10000) maxDiscountBps?: number | null;
}

class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(128) temporaryPassword: string;
}

class UsersQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ROLES }) @IsOptional() @IsIn(ROLES) role?: Role;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions(Permission.USERS_MANAGE)
  list(@Query() q: UsersQuery) {
    return this.users.list(q);
  }

  /** Lightweight list for report/filter dropdowns. */
  @Get('salespeople')
  @AnyPermission(Permission.INVOICES_READ_ALL, Permission.REPORTS_FINANCIAL, Permission.INVENTORY_VIEW_LEDGER)
  salespeople() {
    return this.users.staffDirectory();
  }

  @Post()
  @Permissions(Permission.USERS_MANAGE)
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.users.create(dto, actor, meta);
  }

  @Get(':id')
  @Permissions(Permission.USERS_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @Permissions(Permission.USERS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.users.update(id, dto, actor, meta);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Permissions(Permission.USERS_MANAGE)
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.users.setActive(id, true, actor, meta);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Permissions(Permission.USERS_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.users.setActive(id, false, actor, meta);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Permissions(Permission.USERS_MANAGE)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthContext,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.resetPassword(id, dto.temporaryPassword, actor, meta);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  @Permissions(Permission.USERS_MANAGE)
  revokeSessions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.users.revokeSessions(id, actor, meta);
  }
}
