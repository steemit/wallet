import { vi } from 'vitest';

// Mock for mixpanel-browser
const mixpanelBrowserMock = {
  init: vi.fn(),
  track: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  people: {
    set: vi.fn(),
  },
};

export default mixpanelBrowserMock;
