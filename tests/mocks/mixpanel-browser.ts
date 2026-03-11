import { vi } from 'vitest';

// Mock for mixpanel-browser
export default {
  init: vi.fn(),
  track: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  people: {
    set: vi.fn(),
  },
};
