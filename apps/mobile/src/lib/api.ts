import { ApiError, createApiClient, errorMessage } from '@kite/api-client';
import type { TokenPair } from '@kite/shared';
import { session } from './session';

type Listener = (reason: string) => void;
let onSessionEnded: Listener | null = null;
export const setSessionEndedListener = (fn: Listener | null) => {
  onSessionEnded = fn;
};

/** Exchange the stored refresh token for a new pair (rotation). Returns null if the session is over. */
export async function refreshTokens(): Promise<string | null> {
  const rt = session.refresh();
  if (!rt) return null;
  try {
    const res = await fetch(`${session.server()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (res.status === 401 || res.status === 403) {
      await session.clear();
      return null;
    }
    if (!res.ok) return null; // server hiccup: keep the refresh token, try later
    const body = (await res.json()) as { data: TokenPair };
    await session.setTokens(body.data.accessToken, body.data.refreshToken ?? null);
    return body.data.accessToken;
  } catch {
    return null; // offline: keep tokens
  }
}

/** A thin proxy so the base URL can change at runtime (dev server override). */
let client = build();
function build() {
  return createApiClient({
    baseUrl: session.server(),
    credentials: 'omit',
    timeoutMs: 15_000,
    getAccessToken: session.access,
    refreshAccessToken: refreshTokens,
    onSessionExpired: (err: ApiError) => {
      if (['SESSION_REVOKED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'ACCOUNT_DISABLED'].includes(err.code)) onSessionEnded?.(err.message);
    },
  });
}
export function rebuildClient() {
  client = build();
}
export const api = new Proxy({} as ReturnType<typeof build>, {
  get: (_t, prop) => (client as unknown as Record<string | symbol, unknown>)[prop],
});

export { ApiError, errorMessage };
