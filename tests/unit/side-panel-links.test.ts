import { describe, expect, it } from 'vitest';
import { SIDE_PANEL_EXTERNAL, SIDE_PANEL_INTERNAL } from '@/lib/navigation/side-panel-links';

describe('side-panel-links', () => {
  it('exposes legacy-aligned external URLs', () => {
    expect(SIDE_PANEL_EXTERNAL.binance).toContain('binance.com');
    expect(SIDE_PANEL_EXTERNAL.apiDocs).toBe('https://developers.steem.io/');
    expect(SIDE_PANEL_EXTERNAL.whitepaper).toContain('SteemWhitePaper.pdf');
  });

  it('exposes internal wallet routes', () => {
    expect(SIDE_PANEL_INTERNAL.faq).toBe('/faq');
    expect(SIDE_PANEL_INTERNAL.recoverAccount).toBe('/recover_account_step_1');
    expect(SIDE_PANEL_INTERNAL.witnesses).toBe('/witnesses');
  });
});
