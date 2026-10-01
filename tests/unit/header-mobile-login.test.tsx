/**
 * Header mobile login entry (issue #361).
 *
 * The login/sign-up pair used to live in a `hidden md:flex` container, so on
 * mobile (<md) the header offered no login entry at all and the side panel has
 * none either — an unauthenticated mobile user could not log in. These tests
 * pin the restored wiring: a mobile-only icon login button (md:hidden), the
 * desktop-only login+sign-up pair, a working dialog open action, and no login
 * entry when already authenticated.
 *
 * Note: jsdom does not apply Tailwind CSS, so `hidden`/`md:flex`/`md:hidden`
 * have no runtime effect here — visibility breakpoints are asserted via the
 * class names themselves, and same-named buttons are disambiguated by class.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Header } from '@/components/layout/header';

const push = vi.fn();

// jsdom lacks ResizeObserver, required by radix-ui's Tooltip (remember-user
// label) once the login dialog renders — same stub as login-form-reauth.test.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const authState = {
  username: null as string | null,
  isAuthenticated: false,
  logout: vi.fn(async () => {}),
};

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', cycleTheme: vi.fn() }),
}));

function getMobileLoginButton(): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'login' });
  const mobile = buttons.find((el) => el.className.includes('md:hidden'));
  expect(mobile, 'mobile login button (md:hidden) not found').toBeDefined();
  return mobile as HTMLElement;
}

function renderHeader() {
  // LoginForm (dialog) needs the store + TooltipProvider, as in production.
  return render(
    <Provider store={configureStore({ reducer: { auth: authReducer } })}>
      <TooltipProvider>
        <Header onOpenSidePanel={vi.fn()} />
      </TooltipProvider>
    </Provider>
  );
}

describe('Header mobile login entry (#361)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.username = null;
    authState.isAuthenticated = false;
  });

  it('renders a mobile-only login icon button when logged out', () => {
    renderHeader();
    // Mobile-only: hidden from md up (desktop pair takes over).
    expect(getMobileLoginButton().className).toContain('md:hidden');
  });

  it('keeps the desktop login+sign-up pair out of the mobile layout', () => {
    renderHeader();
    const desktopPair = screen.getByText('signUp').closest('div');
    expect(desktopPair?.className).toContain('hidden');
    expect(desktopPair?.className).toContain('md:flex');
    // Exactly two login entries: mobile icon + desktop text button.
    expect(screen.getAllByRole('button', { name: 'login' })).toHaveLength(2);
  });

  it('opens the login dialog from the mobile button', () => {
    renderHeader();
    fireEvent.click(getMobileLoginButton());
    // Dialog title comes from the same `auth` namespace key.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders no login entry when authenticated', () => {
    authState.isAuthenticated = true;
    authState.username = 'alice';
    renderHeader();
    expect(screen.queryByRole('button', { name: 'login' })).not.toBeInTheDocument();
    expect(screen.queryByText('signUp')).not.toBeInTheDocument();
  });
});
