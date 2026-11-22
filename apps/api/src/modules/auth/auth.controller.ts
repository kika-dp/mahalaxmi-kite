import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import {
  AllowPasswordChangePending,
  Authenticated,
  AuthContext,
  CurrentUser,
  Public,
  ReqMeta,
  RequestMeta,
  RequestWithAuth,
} from '../../common/decorators';
import { Errors } from '../../common/errors';
import { ENV, Env } from '../../config/env';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';

export const REFRESH_COOKIE = 'kite_rt';

class LoginDto {
  @ApiProperty({ example: 'admin01' }) @IsString() @MinLength(3) @MaxLength(120) identifier: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() remember?: boolean;
  @ApiPropertyOptional({ enum: ['crm', 'mobile'] }) @IsOptional() @IsIn(['crm', 'mobile']) client?: 'crm' | 'mobile';
}

class RefreshDto {
  @ApiPropertyOptional({ description: 'Omit when using the CRM cookie' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(128) currentPassword: string;
  @ApiProperty() @IsString() @MaxLength(128) newPassword: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/v1/auth',
      domain: this.env.COOKIE_DOMAIN,
      ...(maxAge ? { maxAge } : {}),
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const remember = dto.remember ?? dto.client === 'mobile';
    const result = await this.auth.login(dto.identifier, dto.password, remember, meta);
    if (dto.client === 'crm') {
      res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions(remember ? this.auth.refreshTtlMs(true) : undefined));
      const { refreshToken: _omit, ...rest } = result;
      return rest;
    }
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const fromCookie = !dto.refreshToken;
    const token = dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) throw Errors.unauthenticated('No refresh token');
    try {
      const result = await this.auth.refresh(token, meta);
      if (fromCookie) {
        res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions(result.remember ? this.auth.refreshTtlMs(true) : undefined));
        return { accessToken: result.accessToken, expiresIn: result.expiresIn };
      }
      return { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn };
    } catch (err) {
      if (fromCookie) res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  /** Public so a client with an expired access token can still end its session. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() dto: RefreshDto, @Req() req: RequestWithAuth, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    let familyId: string | undefined;
    let userId: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const p = await this.jwt.verifyAsync<{ sid: string; sub: string }>(header.slice(7), {
          secret: this.env.JWT_ACCESS_SECRET,
          ignoreExpiration: true,
        });
        familyId = p.sid;
        userId = p.sub;
      } catch {
        /* invalid token: ignore */
      }
    }
    const refreshToken = dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    await this.auth.logout({ familyId, refreshToken, userId, meta });
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @Authenticated()
  @AllowPasswordChangePending()
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user.userId);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(200)
  @Authenticated()
  @AllowPasswordChangePending()
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthContext,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, meta);
    // CRM clients (cookie present) get a fresh cookie; mobile gets tokens in the body.
    if (req.cookies?.[REFRESH_COOKIE]) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions(this.auth.refreshTtlMs(true)));
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    }
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn };
  }
}
