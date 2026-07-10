import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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

  async redirects() {
    return [
      { source: '/faq.html', destination: '/faq', permanent: true },
      { source: '/privacy.html', destination: '/privacy', permanent: true },
      { source: '/tos.html', destination: '/tos', permanent: true },
      { source: '/about.html', destination: '/about', permanent: true },
      { source: '/~witnesses', destination: '/witnesses', permanent: true },
    ];
  },

  // Security response headers applied to all routes. A full script-src CSP is
  // intentionally not added here because Next.js relies on inline runtime for
  // hydration; instead we set frame-ancestors (clickjacking) plus the standard
  // hardening headers. Strengthen to a strict script-src once nonce support is
  // wired up.
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
          // Mitigate clickjacking; allow no framing.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
