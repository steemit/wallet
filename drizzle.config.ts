import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is required. There is intentionally no hardcoded fallback with
// real credentials — a local dev value should be set via .env or the shell,
// e.g. DATABASE_URL=mysql://root:root@127.0.0.1/wallet_dev
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'drizzle.config: DATABASE_URL is not set. Provide it via env (e.g. .env).'
  );
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});
