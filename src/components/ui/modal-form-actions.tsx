"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** Tailwind classes for primary/submit and secondary/cancel buttons inside modals (equal width, touch-friendly height). */
export const modalFormActionButtonClassName =
  "h-11 w-full min-w-0 text-base sm:h-12 sm:text-[1.0625rem]"

export interface ModalFormActionsProps extends React.ComponentProps<"div"> {
  /** One column = single full-width primary; two = equal primary + secondary. */
  columns?: 1 | 2
}

/**
 * Standard action row for dialog/sheet forms: equal-width buttons when columns=2.
 */
function ModalFormActions({
  columns = 2,
  className,
  ...props
}: ModalFormActionsProps) {
  return (
    <div
      role="group"
      data-slot="modal-form-actions"
      className={cn(
        "grid gap-3 sm:gap-4",
        columns === 2 ? "grid-cols-2" : "grid-cols-1",
        className
      )}
      {...props}
    />
  )
}

export { ModalFormActions }
