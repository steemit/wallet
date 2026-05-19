/**
 * UI Redux slice unit tests
 *
 * Covers initial state shape and all reducers to maintain branch coverage threshold.
 * toggleSidebar is the only reducer with computed (non-trivial) next state.
 */

import { describe, it, expect } from 'vitest';
import uiReducer, {
  toggleSidebar,
  setSidebarOpen,
  setTheme,
  setLocale,
} from '@/lib/store/slices/ui';

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

  it('setSidebarOpen sets sidebarOpen to the payload value', () => {
    const state = uiReducer(undefined, { type: 'init' });
    expect(uiReducer(state, setSidebarOpen(false)).sidebarOpen).toBe(false);
    expect(uiReducer(state, setSidebarOpen(true)).sidebarOpen).toBe(true);
  });

  it('setTheme updates the theme', () => {
    const state = uiReducer(undefined, { type: 'init' });
    expect(uiReducer(state, setTheme('dark')).theme).toBe('dark');
    expect(uiReducer(state, setTheme('light')).theme).toBe('light');
  });

  it('setLocale updates the locale', () => {
    const state = uiReducer(undefined, { type: 'init' });
    expect(uiReducer(state, setLocale('zh')).locale).toBe('zh');
    expect(uiReducer(state, setLocale('en')).locale).toBe('en');
  });
});
