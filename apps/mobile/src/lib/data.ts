import { useEffect, useMemo, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useQuery } from '@tanstack/react-query';
import type { PosCatalog } from '@kite/shared';
import { api } from './api';

/** Live connectivity (isInternetReachable falls back to isConnected while unknown). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(!!s.isConnected && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}

/**
 * POS catalog, persisted on the device (react-query persister) so the bill screen opens instantly
 * and works offline for browsing. Stock shown is "as of last sync" — the server re-checks at checkout.
 */
export function useCatalog(opts: { live?: boolean } = {}) {
  const q = useQuery<PosCatalog>({
    queryKey: ['pos-catalog'],
    queryFn: () => api.catalog.posCatalog(),
    staleTime: 30_000,
    gcTime: 7 * 24 * 3600_000,
    refetchInterval: opts.live ? 60_000 : false,
    networkMode: 'offlineFirst',
  });
  const byId = useMemo(() => new Map((q.data?.products ?? []).map((p) => [p.id, p])), [q.data]);
  return { ...q, byId };
}

/** "2 min ago" style freshness label. */
export function useFreshness(iso: string | undefined): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return 'never synced';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}
