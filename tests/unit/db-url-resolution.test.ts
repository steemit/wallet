import { describe, it, expect, afterEach } from 'vitest';

import { resolveDatabaseUrl } from '@/lib/db';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalSdcDatabaseUrl = process.env.SDC_DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalSdcDatabaseUrl === undefined) delete process.env.SDC_DATABASE_URL;
  else process.env.SDC_DATABASE_URL = originalSdcDatabaseUrl;
});

describe('resolveDatabaseUrl', () => {
  it('prefers DATABASE_URL when both are set', () => {
    process.env.DATABASE_URL = 'mysql://a:a@host/db';
    process.env.SDC_DATABASE_URL = 'mysql://b:b@host/db';
    expect(resolveDatabaseUrl()).toBe('mysql://a:a@host/db');
  });

  it('falls back to SDC_DATABASE_URL when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    process.env.SDC_DATABASE_URL = 'mysql://b:b@host/db';
    expect(resolveDatabaseUrl()).toBe('mysql://b:b@host/db');
  });

  it('returns DATABASE_URL when only it is set', () => {
    process.env.DATABASE_URL = 'mysql://a:a@host/db';
    delete process.env.SDC_DATABASE_URL;
    expect(resolveDatabaseUrl()).toBe('mysql://a:a@host/db');
  });

  it('returns undefined when neither is set', () => {
    delete process.env.DATABASE_URL;
    delete process.env.SDC_DATABASE_URL;
    expect(resolveDatabaseUrl()).toBeUndefined();
  });
});
