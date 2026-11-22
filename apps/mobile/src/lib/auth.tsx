import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser, Permission } from '@kite/shared';
import { api, refreshTokens, setSessionEndedListener } from './api';
import { session } from './session';

type Status = 'loading' | 'signed-out' | 'must-change-password' | 'signed-in';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  maxDiscountBps: number | null;
  can: (p: Permission) => boolean;
  signIn: (identifier: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  reloadMe: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [perms, setPerms] = useState<Set<Permission>>(new Set());
  const [maxDiscountBps, setMax] = useState<number | null>(null);

  const reloadMe = useCallback(async () => {
    const me = await api.auth.me();
    setUser(me.user);
    setPerms(new Set(me.permissions));
    setMax(me.effectiveMaxDiscountBps);
    setStatus(me.user.mustChangePassword ? 'must-change-password' : 'signed-in');
  }, []);

  useEffect(() => {
    // Session ended elsewhere (revoked, disabled, expired). The cart is persisted separately and survives.
    setSessionEndedListener((reason) => {
      void session.clear();
      setUser(null);
      setStatus('signed-out');
      Alert.alert('Signed out', `${reason}\nYour current bill has been kept.`);
    });
    (async () => {
      await session.load();
      if (!session.refresh()) return setStatus('signed-out');
      const token = await refreshTokens();
      if (!token) {
        // Offline with a stored session: allow the app to open so the cart can be viewed; API calls will retry.
        return setStatus(session.refresh() ? 'signed-in' : 'signed-out');
      }
      try {
        await reloadMe();
      } catch {
        setStatus('signed-out');
      }
    })();
    return () => setSessionEndedListener(null);
  }, [reloadMe]);

  const signIn = useCallback(
    async (identifier: string, password: string, remember: boolean) => {
      const res = await api.auth.login({ identifier, password, remember, client: 'mobile' });
      await session.setTokens(res.accessToken, res.refreshToken ?? null, remember);
      setUser(res.user);
      setPerms(new Set(res.permissions));
      await reloadMe();
    },
    [reloadMe],
  );

  const signOut = useCallback(async () => {
    await api.auth.logout(session.refresh() ?? undefined).catch(() => undefined);
    await session.clear();
    setUser(null);
    setPerms(new Set());
    setStatus('signed-out');
    qc.clear();
  }, [qc]);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const pair = await api.auth.changePassword(current, next);
      await session.setTokens(pair.accessToken, pair.refreshToken ?? null);
      await reloadMe();
    },
    [reloadMe],
  );

  const value = useMemo<AuthState>(
    () => ({ status, user, maxDiscountBps, can: (p) => perms.has(p), signIn, signOut, changePassword, reloadMe }),
    [status, user, maxDiscountBps, perms, signIn, signOut, changePassword, reloadMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
