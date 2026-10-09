// /vitest entry: augments vitest's Assertion interface with the DOM matchers
// (the default entry augments the jest namespace, which does not apply to
// vitest's expect). Tests import describe/it/expect from 'vitest' explicitly —
// no vitest globals are injected into the src type environment.
import '@testing-library/jest-dom/vitest';
