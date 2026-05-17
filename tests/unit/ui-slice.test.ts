/**
 * UI Redux slice unit tests
 *
 * Only covers behavior that isn't a one-line `state.x = payload` setter:
 *   - initial state shape (catches accidental defaults change)
 *   - toggleSidebar (only reducer with computed next state)
 */

import { describe, it, expect } from 'vitest';
import uiReducer, { toggleSidebar } from '@/lib/store/slices/ui';

describe('UI Slice', () => {
  it('seeds the default UI state', () => {
    expect(uiReducer(undefined, { type: 'init' })).toEqual({
      sidebarOpen: true,
      theme: 'light',
      locale: 'en',
    });
  });

  it('toggleSidebar flips the open flag', () => {
    const open = uiReducer(undefined, { type: 'init' });
    const closed = uiReducer(open, toggleSidebar());
    expect(closed.sidebarOpen).toBe(false);
    expect(uiReducer(closed, toggleSidebar()).sidebarOpen).toBe(true);
  });
});
