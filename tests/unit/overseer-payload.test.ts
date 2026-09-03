import { describe, it, expect } from 'vitest';
import { isValidGaMeasurementId } from '@/lib/analytics/ga-id';
import {
  amountNumber,
  buildRoutePayload,
  buildUserActionPayload,
  buildUserLoginPayload,
  isOverseerRouteTag,
  isOverseerUserAction,
  isSteemAccountName,
  isTrackingId,
  routeTagFromPathname,
  whaleThresholdsFromEnv,
  DEFAULT_WHALE_THRESHOLDS,
} from '@/lib/analytics/overseer-payload';

describe('isValidGaMeasurementId', () => {
  it.each(['G-ABCDEF1234', 'UA-123456-1', 'GT-XXXX', 'AW-999'])(
    'accepts %s',
    (id) => {
      expect(isValidGaMeasurementId(id)).toBe(true);
    }
  );

  it.each(['', 'G-', "G-ABC';alert(1)", 'not-an-id', 'https://evil'])(
    'rejects %s',
    (id) => {
      expect(isValidGaMeasurementId(id)).toBe(false);
    }
  );
});

describe('routeTagFromPathname', () => {
  it('maps static pages to legacy route tags', () => {
    expect(routeTagFromPathname('/')).toEqual({ tag: 'index' });
    expect(routeTagFromPathname('/login')).toEqual({ tag: 'login' });
    expect(routeTagFromPathname('/market')).toEqual({ tag: 'market' });
    expect(routeTagFromPathname('/proposals')).toEqual({ tag: 'proposals' });
    expect(routeTagFromPathname('/witnesses')).toEqual({ tag: 'vote_to_witness' });
    expect(routeTagFromPathname('/privacy')).toEqual({ tag: 'privacy' });
    expect(routeTagFromPathname('/tos')).toEqual({ tag: 'tos' });
    expect(routeTagFromPathname('/faq')).toEqual({ tag: 'faq' });
    expect(routeTagFromPathname('/about')).toEqual({ tag: 'about' });
    expect(routeTagFromPathname('/support')).toEqual({ tag: 'support' });
    expect(routeTagFromPathname('/recover_account_step_1')).toEqual({
      tag: 'recover_account_step1',
    });
  });

  it('does not treat static first segments as accounts (market is a valid name)', () => {
    expect(routeTagFromPathname('/market')).toEqual({ tag: 'market' });
  });

  it('maps account paths to user_index with permlink', () => {
    expect(routeTagFromPathname('/alice')).toEqual({
      tag: 'user_index',
      params: { accountname: 'alice' },
    });
    expect(routeTagFromPathname('/alice/transfers')).toEqual({
      tag: 'user_index',
      params: { accountname: 'alice' },
    });
    expect(routeTagFromPathname('/alice.sub/delegations')).toEqual({
      tag: 'user_index',
      params: { accountname: 'alice.sub' },
    });
  });

  it('maps settings to change_password (legacy ChangePassword mount tag)', () => {
    expect(routeTagFromPathname('/alice/settings')).toEqual({
      tag: 'change_password',
      params: { accountname: 'alice' },
    });
  });

  it('maps recovery confirmation to recover_account_step2', () => {
    expect(routeTagFromPathname('/account_recovery_confirmation/abc')).toEqual({
      tag: 'recover_account_step2',
    });
  });

  it('maps unknown paths to not_found', () => {
    expect(routeTagFromPathname('/this-is-not-valid!!')).toEqual({ tag: 'not_found' });
  });
});

describe('buildRoutePayload', () => {
  it('includes trackingId and is_login like legacy recordRouteTag', () => {
    expect(buildRoutePayload('abc123def456', 'about', undefined, false)).toEqual({
      measurement: 'route',
      tags: { app: 'wallet', tag: 'about', is_login: false },
      fields: { trackingId: 'abc123def456' },
    });
  });

  it('adds permlink for user_index', () => {
    const payload = buildRoutePayload(
      'aabbccddeeff001122334455',
      'user_index',
      { accountname: 'alice' },
      true
    );
    expect(payload.fields).toEqual({
      trackingId: 'aabbccddeeff001122334455',
      permlink: 'alice',
    });
    expect(payload.tags.is_login).toBe(true);
  });
});

describe('buildUserActionPayload', () => {
  const t = DEFAULT_WHALE_THRESHOLDS;

  it('tags STEEM transfers as whale when amount exceeds the steem threshold', () => {
    const payload = buildUserActionPayload(
      'transfer',
      { transferCoin: 'STEEM', amount: 10001, from: 'alice', to: 'bob' },
      t
    );
    expect(payload.measurement).toBe('user_action');
    expect(payload.tags).toMatchObject({
      app: 'wallet',
      action_type: 'transfer',
      transfer_coin: 'STEEM',
      whale: 'true',
    });
    expect(payload.fields).toEqual({
      from_username: 'alice',
      to_username: 'bob',
      amount: 10001,
    });
  });

  it('does not tag a sub-threshold SBD transfer as whale', () => {
    const payload = buildUserActionPayload(
      'transfer',
      { transferCoin: 'SBD', amount: 10, from: 'alice', to: 'bob' },
      t
    );
    expect(payload.tags.whale).toBe('false');
  });

  it('parses asset strings for transfer_to_vesting amount + whale', () => {
    const payload = buildUserActionPayload(
      'transfer_to_vesting',
      { amount: '10001.000 STEEM', from: 'alice', to: 'alice' },
      t
    );
    expect(payload.tags.whale).toBe('true');
    expect(payload.fields.amount).toBe(10001);
  });

  it('never whales VESTS delegations (no vests threshold, same as legacy)', () => {
    const payload = buildUserActionPayload(
      'delegate_vesting_shares',
      { transferCoin: 'VESTS', amount: 1e12, from: 'alice', to: 'bob' },
      t
    );
    expect(payload.tags.whale).toBe('false');
  });

  it('records witness vote/proxy fields', () => {
    expect(
      buildUserActionPayload('account_witness_vote', {
        username: 'alice',
        witness: 'good-witness',
      }).fields
    ).toEqual({ username: 'alice', witness: 'good-witness' });
    expect(
      buildUserActionPayload('account_witness_proxy', {
        username: 'alice',
        proxy: '',
      }).fields
    ).toEqual({ username: 'alice', proxy: '' });
  });

  it('records password / recovery / cancel / savings / power-down fields', () => {
    expect(buildUserActionPayload('change_password', { username: 'alice' }).fields).toEqual({
      username: 'alice',
    });
    expect(buildUserActionPayload('recovery_account', { username: 'alice' }).fields).toEqual({
      username: 'alice',
    });
    expect(
      buildUserActionPayload('cancel_withdraw_vesting', { username: 'alice' }).tags.action_type
    ).toBe('cancel_withdraw_vesting');
    expect(
      buildUserActionPayload('cancel_transfer_from_savings', { username: 'alice' }).fields
    ).toEqual({ username: 'alice' });
    expect(
      buildUserActionPayload('withdraw_vesting', { username: 'alice', amount: 12.5 }, t).fields
    ).toEqual({ username: 'alice', amount: 12.5 });
    expect(
      buildUserActionPayload(
        'transfer_to_savings',
        { transferCoin: 'SBD', amount: 2, from: 'alice', to: 'alice' },
        t
      ).tags.transfer_coin
    ).toBe('SBD');
    expect(
      buildUserActionPayload(
        'transfer_from_savings',
        { transferCoin: 'STEEM', amount: 3, from: 'alice', to: 'alice' },
        t
      ).tags.action_type
    ).toBe('transfer_from_savings');
  });
});

describe('buildUserLoginPayload', () => {
  it('matches legacy login_account overseer checkpoint', () => {
    expect(buildUserLoginPayload('alice')).toEqual({
      measurement: 'user_login',
      tags: { entry: 'wallet' },
      fields: { username: 'alice' },
    });
  });
});

describe('guards', () => {
  it('accepts a 26-char hex tracking id (legacy 13-byte uid)', () => {
    expect(isTrackingId('aabbccddeeff00112233445566')).toBe(true);
    expect(isTrackingId('nope')).toBe(false);
  });

  it('validates steem account names', () => {
    expect(isSteemAccountName('alice')).toBe(true);
    expect(isSteemAccountName('alice.sub')).toBe(true);
    expect(isSteemAccountName('ab')).toBe(false);
    expect(isSteemAccountName('Alice')).toBe(false);
  });

  it('allowlists actions and route tags', () => {
    expect(isOverseerUserAction('transfer')).toBe(true);
    expect(isOverseerUserAction('nope')).toBe(false);
    expect(isOverseerRouteTag('market')).toBe(true);
    expect(isOverseerRouteTag('hack')).toBe(false);
  });

  it('amountNumber parses numbers and asset strings', () => {
    expect(amountNumber(1.5)).toBe(1.5);
    expect(amountNumber('2.000 STEEM')).toBe(2);
    expect(amountNumber('nope')).toBe(0);
  });
});

describe('whaleThresholdsFromEnv', () => {
  it('uses defaults when unset and ignores non-positive values', () => {
    delete process.env.STEEM_WHALE;
    delete process.env.SBD_WHALE;
    expect(whaleThresholdsFromEnv()).toEqual(DEFAULT_WHALE_THRESHOLDS);
    process.env.STEEM_WHALE = '-1';
    process.env.SBD_WHALE = '0';
    expect(whaleThresholdsFromEnv()).toEqual(DEFAULT_WHALE_THRESHOLDS);
    process.env.STEEM_WHALE = '50';
    process.env.SBD_WHALE = '3';
    expect(whaleThresholdsFromEnv()).toEqual({ steem: 50, sbd: 3 });
    delete process.env.STEEM_WHALE;
    delete process.env.SBD_WHALE;
  });
});
