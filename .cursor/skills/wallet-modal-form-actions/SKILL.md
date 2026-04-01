---
name: wallet-modal-form-actions
description: >-
  Standardizes primary/secondary action rows for Dialog and Sheet forms in the wallet app:
  ModalFormActions grid, shared button sizing, single vs dual columns, DialogFooter alignment,
  and solid-button hover shadows. Use when adding or changing modal dialogs, form footers,
  transfer/convert/delegate/power-down flows, or when fixing misaligned or uneven modal buttons.
---

# Wallet modal form actions

## When to apply

- Any **Dialog** or **Sheet** body that ends with **Submit / Cancel** (or equivalent) pairs.
- New wallet flows opened via `WalletTransfersModals` or similar query-driven dialogs.
- Fixes for **uneven button width**, **hover misalignment** next to outline buttons, or **tiny footers** vs content.

## Required pattern

1. **Import** from `@/components/ui/modal-form-actions`:
   - `ModalFormActions` — wrapper for the action row.
   - `modalFormActionButtonClassName` — apply to **both** primary (default variant) and secondary (`variant="outline"`) buttons.

2. **Layout**
   - Wrap actions in `<ModalFormActions className="pt-4" columns={…}>`.
   - `columns={2}` — two equal-width cells (typical submit + cancel).
   - `columns={1}` — single full-width primary (e.g. only submit, or only built-in Close in a footer).

3. **Do not**
   - Use `flex` + `flex-1` on only the primary button (creates uneven width vs outline).
   - Duplicate one-off `grid grid-cols-2` + ad-hoc height classes; use the shared component/constants instead.
   - Revert `--btn-solid-shadow-hover` second layer to larger offsets than the default solid shadow (see Global tokens).

## Dialog shell

- **`DialogFooter`** (`@/components/ui/dialog`): already uses `ModalFormActions` and `modalFormActionButtonClassName` for optional `showCloseButton`. Pass explicit `columns` if the footer has an unusual number of actions.
- **`SheetFooter`**: spacing aligns with modal rows (`gap-3 sm:gap-4`). For action buttons inside sheets, still use `ModalFormActions` + shared button class.

## Global solid-button hover (alignment)

- Primary buttons use CSS variables in `src/app/globals.css` (`--btn-solid-shadow`, `--btn-solid-shadow-hover`).
- **Rule:** the **offset** of the “hard” shadow on hover must **match** the default state (e.g. `2px 2px`), not a larger offset like `4px 4px`, or the filled button will **appear shifted** relative to outline neighbors on hover.

## Reference implementations

| Area | File |
|------|------|
| Shared primitives | `src/components/ui/modal-form-actions.tsx` |
| Dialog footer | `src/components/ui/dialog.tsx` (`DialogFooter`) |
| Wallet modals host | `src/components/wallet/wallet-transfers-modals.tsx` |
| Forms using pattern | `transfer-form.tsx`, `delegate-form.tsx`, `power-down-form.tsx`, `convert-sbd-form.tsx`, `withdraw-routes-form.tsx` |

## Quick checklist

- [ ] `ModalFormActions` + `modalFormActionButtonClassName` on both actions.
- [ ] Correct `columns` for 1 vs 2 visible buttons (including conditional second action).
- [ ] No legacy `flex-1` / asymmetric flex footers in new code.
- [ ] If touching shadows, preserve matched hover offset per `globals.css` convention.
