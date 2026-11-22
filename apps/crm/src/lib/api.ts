'use client';
import { ApiError, createApiClient } from '@kite/api-client';
import type { TokenPair } from '@kite/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Access token lives in memory only (never localStorage). The refresh token is an httpOnly cookie
 * set by the API for CRM logins, so JavaScript cannot read it.
 */
let accessToken: string | null = null;
let onExpired: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onExpired: (fn: () => void) => {
    onExpired = fn;
  },
};

export async function refreshViaCookie(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (!res || !res.ok) {
    accessToken = null;
    return null;
  }
  const body = (await res.json()) as { data: TokenPair };
  accessToken = body.data.accessToken;
  return accessToken;
}

export const api = createApiClient({
  baseUrl: API_URL,
  credentials: 'include',
  getAccessToken: () => accessToken,
  refreshAccessToken: refreshViaCookie,
  onSessionExpired: (err: ApiError) => {
    if (['SESSION_REVOKED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'ACCOUNT_DISABLED'].includes(err.code)) {
      accessToken = null;
      onExpired?.();
    }
  },
});

/** Download a protected file (PDF/CSV/XLSX) and either open it or save it. */
export async function downloadFile(path: string, filename: string, query?: Record<string, string | number | undefined>, open = false) {
  const blob = await api.blob(path, query);
  const url = URL.createObjectURL(blob);
  if (open) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Print a PDF through a hidden iframe. */
export async function printPdf(path: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(iframe);
}
