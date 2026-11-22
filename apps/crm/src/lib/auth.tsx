'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CRM_ROLES, type AuthUser, type Permission } from '@kite/shared';
import { ApiError } from '@kite/api-client';
import { api, refreshViaCookie, tokenStore } from './api';

type Status = 'loading' | 'anonymous' | 'authenticated' | 'must-change-password';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  login: (identifier: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export class CrmAccessError extends Error {}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());

  const loadMe = useCallback(async () => {
    const me = await api.auth.me();
    if (!CRM_ROLES.includes(me.user.role)) {
      await api.auth.logout().catch(() => undefined);
      tokenStore.set(null);
      throw new CrmAccessError('Salespeople use the Kite POS app on their iPhone. The CRM is for owners, admins and inventory staff.');
    }
    setUser(me.user);
    setPermissions(new Set(me.permissions));
    setStatus(me.user.mustChangePassword ? 'must-change-password' : 'authenticated');
  }, []);

  useEffect(() => {
    tokenStore.onExpired(() => {
      setUser(null);
      setPermissions(new Set());
      setStatus('anonymous');
      qc.clear();
    });
    (async () => {
      const token = await refreshViaCookie();
      if (!token) return setStatus('anonymous');
      try {
        await loadMe();
      } catch {
        setStatus('anonymous');
      }
    })();
  }, [loadMe, qc]);

  const login = useCallback(
    async (identifier: string, password: string, remember: boolean) => {
      const res = await api.auth.login({ identifier, password, remember, client: 'crm' });
      tokenStore.set(res.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    tokenStore.set(null);
    setUser(null);
    setPermissions(new Set());
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const pair = await api.auth.changePassword(current, next);
      tokenStore.set(pair.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const value = useMemo<AuthState>(
    () => ({ status, user, permissions, can: (p) => permissions.has(p), login, logout, changePassword }),
    [status, user, permissions, login, logout, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export { ApiError };
