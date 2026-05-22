import { describe, it, expect, vi } from 'vitest';
import {
  buildAccountCreateOperation,
  buildCommunitySetupOperations,
  buildCommunitySubscribeOperation,
  buildHivemindCommunityOperation,
  communityActiveWif,
  communityTitleStartsWithLetter,
  communityTrendingUrl,
  generateCommunityOwnerName,
  generateCommunityOwnerPassword,
  sleep,
} from '@/lib/wallet/community';

describe('community helpers', () => {
  it('generateCommunityOwnerName matches hive- prefix pattern', () => {
    const name = generateCommunityOwnerName();
    expect(name).toMatch(/^hive-\d{6}$/);
    const num = Number(name.replace('hive-', ''));
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThanOrEqual(199999);
  });

  it('generateCommunityOwnerPassword prefixes P', () => {
    expect(generateCommunityOwnerPassword()).toMatch(/^P5J/);
  });

  it('communityTitleStartsWithLetter accepts letters and rejects digits', () => {
    expect(communityTitleStartsWithLetter('My Community')).toBe(true);
    expect(communityTitleStartsWithLetter('社区')).toBe(true);
    expect(communityTitleStartsWithLetter('1bad')).toBe(false);
    expect(communityTitleStartsWithLetter('')).toBe(false);
  });

  it('buildAccountCreateOperation includes fee and creator', () => {
    const op = buildAccountCreateOperation('alice', 'hive-123456', 'Psecret');
    expect(op.fee).toBe('3.000 STEEM');
    expect(op.creator).toBe('alice');
    expect(op.new_account_name).toBe('hive-123456');
    expect(op.owner.weight_threshold).toBe(1);
    expect(typeof op.memo_key).toBe('string');
    expect(op.memo_key.length).toBeGreaterThan(0);
  });

  it('buildHivemindCommunityOperation serializes community custom_json', () => {
    const [type, payload] = buildHivemindCommunityOperation('hive-1', 'setRole', {
      community: 'hive-1',
      account: 'alice',
      role: 'admin',
    });
    expect(type).toBe('custom_json');
    expect(payload.id).toBe('community');
    expect(payload.required_posting_auths).toEqual(['hive-1']);
    expect(JSON.parse(payload.json as string)).toEqual([
      'setRole',
      { community: 'hive-1', account: 'alice', role: 'admin' },
    ]);
  });

  it('buildCommunitySetupOperations returns setRole and updateProps', () => {
    const ops = buildCommunitySetupOperations('alice', 'hive-1', 'Title', 'About');
    expect(ops).toHaveLength(2);
    expect(ops[0]?.[0]).toBe('custom_json');
    expect(ops[1]?.[0]).toBe('custom_json');
    const updateJson = JSON.parse((ops[1]?.[1].json as string) ?? '[]');
    expect(updateJson[0]).toBe('updateProps');
    expect(updateJson[1].props).toEqual({ title: 'Title', about: 'About' });
  });

  it('buildCommunitySubscribeOperation uses account posting auth', () => {
    const [, payload] = buildCommunitySubscribeOperation('alice', 'hive-1');
    expect(payload.required_posting_auths).toEqual(['alice']);
    expect(JSON.parse(payload.json as string)).toEqual(['subscribe', { community: 'hive-1' }]);
  });

  it('communityActiveWif derives the community account active key', () => {
    expect(communityActiveWif('hive-1', 'Psecret')).toBe('5Jmock');
  });

  it('communityTrendingUrl builds steemit trending link', () => {
    expect(communityTrendingUrl('https://steemit.com/', 'hive-123456')).toBe(
      'https://steemit.com/trending/hive-123456'
    );
  });

  it('sleep resolves after delay', async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
