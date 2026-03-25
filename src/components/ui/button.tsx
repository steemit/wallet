import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /* wallet-legacy .e-btn: offset box-shadow + hover swap (_themes.scss) */
        default:
          "bg-[var(--btn-solid-bg)] font-bold capitalize text-[var(--btn-solid-fg)] shadow-[var(--btn-solid-shadow)] transition-[background-color,box-shadow,color,text-shadow] duration-200 ease-in-out hover:bg-[var(--btn-solid-bg-hover)] hover:text-[var(--btn-solid-fg-hover)] hover:shadow-[var(--btn-solid-shadow-hover)] hover:[text-shadow:var(--btn-solid-text-shadow-hover)] focus-visible:border-transparent focus-visible:ring-0 focus-visible:bg-[var(--btn-solid-bg-hover)] focus-visible:text-[var(--btn-solid-fg-hover)] focus-visible:shadow-[var(--btn-solid-shadow-hover)] focus-visible:[text-shadow:var(--btn-solid-text-shadow-hover)] active:translate-y-0 disabled:opacity-25 disabled:shadow-none disabled:hover:bg-[var(--btn-solid-bg)] disabled:hover:text-[var(--btn-solid-fg)] disabled:hover:shadow-none disabled:hover:[text-shadow:none]",
        /* wallet-legacy .e-btn-hollow */
        outline:
          "bg-transparent [border:var(--btn-hollow-border)] font-normal text-[var(--btn-hollow-text)] shadow-none transition-[border,color] duration-200 ease-in-out hover:bg-transparent hover:[border:var(--btn-hollow-border-hover)] hover:text-[var(--btn-hollow-text-hover)] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:[border:var(--btn-hollow-border-hover)] focus-visible:text-[var(--btn-hollow-text-hover)] aria-expanded:bg-transparent aria-expanded:[border:var(--btn-hollow-border)] aria-expanded:text-[var(--btn-hollow-text)] disabled:opacity-25",
        secondary:
          "bg-secondary text-secondary-foreground transition-all duration-200 ease-in-out hover:bg-secondary/80 active:translate-y-px aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:opacity-50",
        ghost:
          "transition-all duration-200 ease-in-out hover:bg-muted hover:text-foreground active:translate-y-px aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 disabled:opacity-50",
        destructive:
          "bg-destructive/10 text-destructive transition-all duration-200 ease-in-out hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 active:translate-y-px dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 disabled:opacity-50",
        link: "text-primary underline-offset-4 transition-all duration-200 ease-in-out hover:underline disabled:opacity-50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
