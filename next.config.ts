import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Content-Security-Policy is set per-request in src/proxy.ts with a random nonce
// (the RSC streaming payload uses framework inline scripts, so a static
// `script-src 'self'` without a nonce blocks hydration — SRI only covers
// external scripts). Do not re-add a static CSP here: duplicate CSP headers
// intersect, and the static one would override the nonce policy.

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
  // complementing the nonce-based CSP set in src/proxy.ts (integrity checks
  // still apply to external scripts; SRI cannot cover inline scripts).
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
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
