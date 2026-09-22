// Infra single-source-of-truth guards.
//
// Locks in the decisions from the infra-config-truth PR:
// 1. The root ./Dockerfile and docker/Dockerfile must be byte-identical
//    (the root file feeds the external CodeBuild pipeline, the docker/
//    one is what docker-compose builds — they must never diverge again).
// 2. Exactly one pnpm version: package.json "packageManager" is the source
//    of truth; the Dockerfile corepack pin and CI must agree with it.
// 3. docker-compose.yml must only pass variables the code actually reads
//    (documented in .env.example) and must pass every variable a real
//    deployment needs.
// 4. Container health checks must target the LIVENESS endpoint
//    (/.well-known/healthcheck.json), never the readiness probe
//    (/api/health — 503s while the Steem RPC is degraded).
//
// These tests read files from the repo root; they are intentionally simple
// regex/parsers, not YAML/Dockerfile parsers.

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('Dockerfile single source of truth', () => {
  it('root Dockerfile is byte-identical to docker/Dockerfile', () => {
    const root = readRepoFile('Dockerfile');
    const canonical = readRepoFile('docker/Dockerfile');
    // Byte-for-byte: comments and trailing newlines count too.
    expect(root).toBe(canonical);
  });

  it('both Dockerfiles probe liveness, not upstream readiness', () => {
    const root = readRepoFile('Dockerfile');
    const canonical = readRepoFile('docker/Dockerfile');
    for (const [name, content] of [
      ['Dockerfile', root],
      ['docker/Dockerfile', canonical],
    ] as const) {
      // The directive spans two lines (HEALTHCHECK ... \ + CMD ...).
      const lines = content.split('\n');
      const blocks: string[] = [];
      lines.forEach((line, i) => {
        if (line.includes('HEALTHCHECK')) {
          blocks.push(line, lines[i + 1] ?? '');
        }
      });
      expect(blocks.length).toBeGreaterThan(0);
      const block = blocks.join('\n');
      expect(block).toContain('/.well-known/healthcheck.json');
      expect(block).not.toContain('/api/health');
      void name;
    }
  });
});

describe('pnpm version pinning', () => {
  const packageJson = JSON.parse(readRepoFile('package.json')) as {
    packageManager?: string;
  };

  it('package.json declares a packageManager field', () => {
    expect(packageJson.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('Dockerfile corepack pin matches packageManager', () => {
    const dockerfile = readRepoFile('docker/Dockerfile');
    const m = dockerfile.match(/corepack prepare pnpm@(\d+\.\d+\.\d+)/);
    expect(m).not.toBeNull();
    const pinned = `pnpm@${m?.[1]}`;
    expect(pinned).toBe(packageJson.packageManager);
  });

  it('CI does not pin a divergent pnpm version', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    // Every pnpm/action-setup step must either derive the version from
    // packageManager (no `version:` input) or pin the same exact version.
    const blocks = ci.split('- uses: pnpm/action-setup');
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks.slice(1)) {
      const withSection = block.split('- uses:')[0] ?? '';
      const versionMatch = withSection.match(/version:\s*(\S+)/);
      if (versionMatch) {
        expect(versionMatch[1]).toBe(packageJson.packageManager);
      }
    }
  });
});

describe('docker-compose environment honesty', () => {
  const compose = readRepoFile('docker/docker-compose.yml');
  const envExample = readRepoFile('.env.example');

  const composeEnvKeys = Array.from(
    compose.matchAll(/^\s*-\s*([A-Z][A-Z0-9_]+)=/gm),
    (m) => m[1] as string
  );

  // Variables documented in .env.example (commented or not): `KEY=` at
  // line start, optionally behind a comment marker.
  const documentedKeys = new Set(
    Array.from(
      envExample.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/gm),
      (m) => m[1] as string
    )
  );

  // Runtime variables set by the image itself rather than the deployment.
  const infraAllowlist = new Set(['NODE_ENV', 'PORT']);

  it('compose passes at least the documented runtime set', () => {
    expect(composeEnvKeys.length).toBeGreaterThan(10);
  });

  it('every compose variable is documented in .env.example or allowlisted', () => {
    const undocumented = composeEnvKeys.filter(
      (key) => !documentedKeys.has(key) && !infraAllowlist.has(key)
    );
    expect(undocumented).toEqual([]);
  });

  it('compose passes every variable a real deployment needs', () => {
    const required = [
      'STEEM_RPC_URL',
      'DATABASE_URL',
      'REDIS_URL',
      'CSRF_SECRET',
      'CONVEYOR_USERNAME',
      'CONVEYOR_POSTING_WIF',
      'TRUST_PROXY_COUNT',
    ];
    const missing = required.filter(
      (key) => !composeEnvKeys.includes(key)
    );
    expect(missing).toEqual([]);
  });

  it('compose health check probes liveness, not upstream readiness', () => {
    const healthcheckBlock = compose
      .split('\n')
      .filter((line) => line.includes('healthcheck:') || line.includes('test:'))
      .join('\n');
    expect(healthcheckBlock).toContain('/.well-known/healthcheck.json');
    expect(healthcheckBlock).not.toContain('/api/health');
  });
});
