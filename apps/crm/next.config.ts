import path from 'path';
import type { NextConfig } from 'next';

/**
 * API_PROXY_TARGET (optional, e.g. https://kite-api.onrender.com):
 * when set, the CRM proxies /api/* and /uploads/* to the API so the browser talks to ONE origin.
 * Needed when the CRM and API live on different sites (e.g. *.vercel.app and *.onrender.com):
 * the CRM's httpOnly refresh cookie stays first-party. Pair it with NEXT_PUBLIC_API_URL=/api/v1.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is for Docker; Vercel uses its own output format.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  transpilePackages: ['@kite/shared', '@kite/api-client'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [
      { source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` },
      { source: '/uploads/:path*', destination: `${apiProxyTarget}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
