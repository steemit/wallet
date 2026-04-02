---
name: wallet-radix-scroll-lock-jitter
description: >-
  Fixes layout shift (header/avatar/hamburger jitter) caused by Radix/shadcn overlays locking body scroll and hiding the browser scrollbar.
  Use when a DropdownMenu/Popover/Select/ContextMenu opens and the scrollbar disappears, or fixed headers shift horizontally.
---

# Wallet Radix scroll-lock jitter

## When to apply

- A shadcn/Radix overlay opens and **the browser scrollbar disappears**.
- **Fixed header elements** (e.g. avatar, hamburger, right-side actions) **jump left/right** on open/close.
- The root cause is scroll locking (typically `body { overflow: hidden; }`) applied by Radix in **modal** mode.

## Diagnose quickly

1. Open the overlay (dropdown/popover/select).
2. Inspect computed styles:
   - `document.body` gets `overflow: hidden` (or equivalent scroll lock), OR
   - The page width changes because the vertical scrollbar is removed.

If yes, follow **Fix A** first.

## Fix A (preferred): disable modal scroll-lock where safe

For *non-critical* overlays that do not need scroll-lock (most header menus), set `modal={false}` on the Radix root:

- **DropdownMenu**
  - `@/components/ui/dropdown-menu` root supports `modal?: boolean`
  - Usage: `<DropdownMenu modal={false}>…</DropdownMenu>`

- **Popover**
  - Usage: `<Popover modal={false}>…</Popover>`

- **ContextMenu / Menubar / Select**
  - If the primitive supports `modal`, disable it for lightweight menus.
  - If it does **not** support `modal`, use Fix B instead.

### Notes

- Do **not** disable modal for true “dialog-like” flows that must trap focus and block background scroll (e.g. `Dialog`, `Sheet`).
- Prefer fixing **at the call site** when only one menu is affected.
- If *many* menus in the app are affected and all should behave the same, consider setting a project-wide default in the wrapper component (e.g. `DropdownMenu` wrapper) and override in the rare cases that need modal behavior.

## Fix B (global): keep scrollbar gutter stable (prevents width change)

If modal scroll lock is required (e.g. dialogs/sheets) or the primitive can’t disable modal, prevent the “scrollbar removed” width change with CSS:

- Add to `src/app/globals.css` (or equivalent global stylesheet):

  - `html { scrollbar-gutter: stable; }`
  - or `:root { scrollbar-gutter: stable; }`

This keeps a consistent gutter even when scroll locking toggles, eliminating header jitter.

### Fallback guidance (when `scrollbar-gutter` is insufficient)

- If some target browsers don’t support `scrollbar-gutter`, use padding compensation:
  - On open: compute \(scrollbarWidth = window.innerWidth - document.documentElement.clientWidth\)
  - Apply `padding-right: scrollbarWidth` to the same element that becomes scroll-locked.
  - Remove on close.

Prefer implementing this once (shared utility) rather than per-component.

## Reference implementation

- `src/components/layout/header.tsx` — avatar dropdown fixed via `modal={false}`.

