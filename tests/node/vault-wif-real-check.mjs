// Real-crypto WIF verification for the vault validation module (A1.1).
//
// Run with plain Node (NOT vitest):   node tests/node/vault-wif-real-check.mjs
//
// Why this exists: under vitest, '@steemit/steem-js' is aliased to
// tests/mocks/steem-js.ts (isWif always true, getPublicKey is a fake), and
// the REAL steem.auth.isWif cannot run in vitest jsdom anyway because
// @noble/hashes 2.x rejects the Node Buffers steem-js passes in (AGENTS.md,
// 2026-10-09 MAIN-60 precedent). This script imports the same steem-js build
// from node_modules directly and performs the real checks the vitest suite
// cannot: base58/double-SHA256 WIF checksum validation, public-key
// derivation and comparison against the fixture's declared public key.
//
// All WIFs below are PUBLIC TEST-ONLY data from
// tests/fixtures/vault-development-test-vectors.json — never use them for
// real accounts or funds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vectors = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'vault-development-test-vectors.json'), 'utf8'),
);
// Import the steem-js build from node_modules directly — the same artifact
// tests/mocks/steem-js.ts loads its real helpers from.
const { steem } = await import(
  pathToFileURL(path.join(repoRoot, 'node_modules', '@steemit', 'steem-js', 'dist', 'index.js')).href
);

let failures = 0;
function check(label, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`${status}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// --- Fixture WIFs -----------------------------------------------------------
const mainWif = vectors.vault.payload.keys[0].privateKey;
const dappWif = vectors.dappRequest.dappWif;
const dappPublicKey = vectors.dappRequest.dappPublicKey;

// 1. Real isWif (base58 decode + double-SHA256 checksum) accepts both WIFs.
check('isWif(fixture main WIF) === true', steem.auth.isWif(mainWif) === true);
check('isWif(dapp WIF) === true', steem.auth.isWif(dappWif) === true);

// 2. Real public-key derivation from both WIFs.
const mainPublicKey = steem.auth.getPublicKey(mainWif);
const derivedDappPublicKey = steem.auth.getPublicKey(dappWif);
check(
  'getPublicKey(main WIF) returns an STM public key',
  typeof mainPublicKey === 'string' && mainPublicKey.startsWith('STM') && mainPublicKey.length > 40,
  `derived: ${mainPublicKey}`,
);
check(
  'getPublicKey(dapp WIF) matches the fixture-declared dapp public key',
  derivedDappPublicKey === dappPublicKey,
  `derived: ${derivedDappPublicKey} / declared: ${dappPublicKey}`,
);

// Determinism: same WIF derives the same key every time.
check(
  'getPublicKey(main WIF) is deterministic',
  steem.auth.getPublicKey(mainWif) === mainPublicKey,
);

// 3. Invalid inputs must fail the real checksum validation.
const invalidWifs = [
  ['plain text', 'not-a-wif'],
  ['wrong checksum (last char mutated)', mainWif.slice(0, -1) + (mainWif.endsWith('x') ? 'y' : 'x')],
  ['empty string', ''],
  ['prefix-only', '5'],
];
for (const [label, candidate] of invalidWifs) {
  check(`isWif rejects ${label}`, steem.auth.isWif(candidate) === false);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('All real-crypto WIF checks passed.');
console.log(`Main WIF public key (record for A1.1): ${mainPublicKey}`);
