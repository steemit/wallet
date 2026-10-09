import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import { SteemService } from '@/lib/steem/server';

/**
 * Regression tests for validateConveyorConfig (MAIN-60, 2026-10-08).
 *
 * The old implementation shape-checked the WIF with
 * /^5[HJ][1-9A-HJ-NP-Za-km-z]{49}$/, which silently rejects every valid WIF
 * whose second character is 'K' (~39% of random Steem private keys:
 * 5J 51% / 5K 39% / 5H 10% — measured with steem.auth.toWif over 300 seeds
 * in plain Node). Production's conveyor posting key hit exactly that case,
 * so every recovery confirm returned 503 "Recovery service unavailable".
 *
 * The fix delegates to steem.auth.isWif (base58 decode + double-SHA256
 * checksum). The vitest steem-js mock stubs isWif, so these tests pin the
 * delegation and the behavior boundary; real-crypto validation of a 5K WIF
 * was verified against the same steem-js build in plain Node.
 *
 * NOTE: the real isWif cannot run inside this vitest jsdom environment
 * (steem-js passes Node Buffers into @noble/hashes 2.x, whose abytes()
 * rejects them here) — keep these tests mock-driven.
 */
describe('SteemService.validateConveyorConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.mocked(steem.auth.isWif).mockReset();
  });

  it('returns an error when the conveyor env vars are missing', () => {
    delete process.env.CONVEYOR_USERNAME;
    delete process.env.CONVEYOR_POSTING_WIF;
    expect(SteemService.validateConveyorConfig()).toMatch(/missing/);
  });

  it('delegates the format decision to steem.auth.isWif', () => {
    process.env.CONVEYOR_USERNAME = 'conveyor';
    // A well-known example WIF: valid per steem.auth.isWif (checksum
    // verified in plain Node against the same steem-js build) but rejected
    // by the old /^5[HJ]/ regex — the exact production failure class.
    const wif5K = '5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF';
    process.env.CONVEYOR_POSTING_WIF = wif5K;

    vi.mocked(steem.auth.isWif).mockReturnValueOnce(true);
    expect(SteemService.validateConveyorConfig()).toBeNull();
    expect(steem.auth.isWif).toHaveBeenCalledWith(wif5K);

    vi.mocked(steem.auth.isWif).mockReturnValueOnce(false);
    expect(SteemService.validateConveyorConfig()).toMatch(
      /not a valid Steem private key/
    );
  });

  it('still rejects values that fail the WIF checksum', () => {
    process.env.CONVEYOR_USERNAME = 'conveyor';
    process.env.CONVEYOR_POSTING_WIF = 'not-a-wif';
    vi.mocked(steem.auth.isWif).mockReturnValueOnce(false);
    expect(SteemService.validateConveyorConfig()).toMatch(
      /not a valid Steem private key/
    );
  });
});
