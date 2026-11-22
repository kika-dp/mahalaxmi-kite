import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@kite/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Route requires ALL listed permissions (use AnyPermission for OR). */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, { mode: 'all', permissions });
/** Route requires at least ONE of the listed permissions. */
export const AnyPermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, { mode: 'any', permissions });
/** Route is available to every authenticated user (explicit, so default-deny can be tested). */
export const Authenticated = () => SetMetadata(PERMISSIONS_KEY, { mode: 'authenticated', permissions: [] });

export const ALLOW_PASSWORD_CHANGE_PENDING = 'allowPasswordChangePending';
/** Route reachable while the user must still change their password. */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

export const RAW_RESPONSE_KEY = 'rawResponse';
/** Skip the {data} envelope (files, streams). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

export interface AuthContext {
  userId: string;
  username: string;
  fullName: string;
  role: Role;
  sessionId: string;
  permissions: Set<Permission>;
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
  requestId?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!req.auth) throw new Error('CurrentUser used on a public route');
  return req.auth;
});

export interface RequestMeta {
  ip: string | null;
  requestId: string | null;
  userAgent: string | null;
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  return {
    ip: req.ip ?? null,
    requestId: req.requestId ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 255) ?? null,
  };
});
