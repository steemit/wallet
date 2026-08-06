import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Development needs 'unsafe-eval' because React DevTools uses eval for
// enhanced error stack reconstruction. Not required (or used) in production.
const isDev = process.env.NODE_ENV === 'development';

// Full Content-Security-Policy. With SRI enabled (below), script tags get
// build-time integrity hashes, so we can use script-src 'self' without
// 'unsafe-inline' — any injected inline script is blocked by the browser.
const cspHeader = [
  "default-src 'self'",
  `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Optimize for production
  reactStrictMode: true,

  // Disable powered by header for security
  poweredByHeader: false,

  // Compress responses
  compress: true,

  // Exclude mysql2 from client-side bundling (server-only native module)
  serverExternalPackages: ['mysql2'],

  // Subresource Integrity: generate SHA-256 hashes for all JS bundles at
  // build time. Browsers verify file integrity via the `integrity` attribute,
  // which allows a strict CSP (script-src 'self') without 'unsafe-inline'.
  // This preserves static generation / CDN caching — no nonce or dynamic
  // rendering required.
  experimental: {
    sri: {
      algorithm: 'sha256',
    },
  },

  async redirects() {
    return [
      { source: '/faq.html', destination: '/faq', permanent: true },
      { source: '/privacy.html', destination: '/privacy', permanent: true },
      { source: '/tos.html', destination: '/tos', permanent: true },
      { source: '/about.html', destination: '/about', permanent: true },
      { source: '/~witnesses', destination: '/witnesses', permanent: true },
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
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Full CSP with strict script-src (no unsafe-inline in production).
          // SRI provides integrity hashes for framework scripts so 'self'
          // suffices; any attacker-injected inline script is blocked.
          { key: 'Content-Security-Policy', value: cspHeader },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
