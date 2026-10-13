// /vitest entry: augments vitest's Assertion interface with the DOM matchers
// (the default entry augments the jest namespace, which does not apply to
// vitest's expect). Tests import describe/it/expect from 'vitest' explicitly —
// no vitest globals are injected into the src type environment.
import '@testing-library/jest-dom/vitest';

// Node ≥ 22.4 exposes experimental `localStorage` / `sessionStorage` globals that
// resolve to `undefined` unless `--localstorage-file` is passed. Vitest's jsdom
// environment copies window keys onto the global only when they are not already
// present (`getWindowKeys` drops any key that exists on `global`), so Node's
// stub wins over jsdom's implementation and every `localStorage.clear()` in a
// test throws "Cannot read properties of undefined". CI and the Docker image run
// Node 22, where these globals do not exist yet, so the difference only shows up
// for contributors on a newer Node. Re-point the globals at jsdom's
// implementation (reached through the `jsdom` handle the environment installs)
// so the suite behaves identically on every supported Node.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window?: Window } }).jsdom
  ?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const storage = jsdomWindow[key];
    if (storage) {
      Object.defineProperty(globalThis, key, {
        value: storage,
        writable: true,
        configurable: true,
      });
    }
  }
}
