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
};

export default withNextIntl(nextConfig);
