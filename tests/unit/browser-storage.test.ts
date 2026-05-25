import { describe, expect, it, beforeEach } from 'vitest';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
  clearRememberedDeviceAuth,
  getRememberedDeviceUsername,
} from '@/lib/auth/browser-storage';

describe('browser-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clearRememberedDeviceAuth removes username and posting key', () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5Jtest');

    clearRememberedDeviceAuth();

    expect(getRememberedDeviceUsername()).toBeNull();
    expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBeNull();
  });
});
