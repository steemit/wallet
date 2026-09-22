import path from 'path';

const config = {
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // next-intl's ESM build imports 'next/server' extensionless, which the
    // Node ESM loader cannot resolve (next ships no package.json `exports`
    // map). Inlining routes the module through Vite's resolver, letting the
    // proxy tests exercise the REAL next-intl middleware instead of a mock
    // double (tests/unit/proxy-csp.test.ts).
    server: {
      deps: {
        inline: ['next-intl'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@steemit/steem-js': path.resolve(__dirname, './tests/mocks/steem-js.ts'),
    },
  },
};

export default config;
