import path from 'path';

const config = {
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
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
      'mixpanel-browser': path.resolve(__dirname, './tests/mocks/mixpanel-browser.ts'),
      '@steemit/steem-js': path.resolve(__dirname, './tests/mocks/steem-js.ts'),
    },
  },
};

export default config;
