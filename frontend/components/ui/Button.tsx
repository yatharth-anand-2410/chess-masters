"use client";

import Link from "next/link";
import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer active:scale-[0.98] transition-transform duration-100",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--gold)] text-[#121b1e] font-semibold hover:bg-[var(--gold-bright)] in-[[data-surface=paper]]:bg-[var(--ink-2)] in-[[data-surface=paper]]:text-[var(--paper)] in-[[data-surface=paper]]:hover:bg-[var(--ink-3)]",
        ghost:
          "bg-transparent text-[var(--text)] border border-[var(--line)] hover:border-[var(--line-soft)] hover:bg-[var(--ink-2)] in-[[data-surface=paper]]:text-[var(--paper-text)] in-[[data-surface=paper]]:border-[var(--paper-line)] in-[[data-surface=paper]]:hover:bg-[var(--paper-2)]",
        quiet:
          "bg-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[rgba(255,255,255,0.04)] in-[[data-surface=paper]]:text-[var(--paper-muted)] in-[[data-surface=paper]]:hover:text-[var(--paper-text)] in-[[data-surface=paper]]:hover:bg-[rgba(0,0,0,0.04)]",
        toggle:
          "bg-transparent text-[var(--text-muted)] border border-transparent hover:text-[var(--text)] aria-pressed:bg-[var(--ink-3)] aria-pressed:text-[var(--gold-bright)] aria-pressed:border-[var(--line)] in-[[data-surface=paper]]:aria-pressed:bg-[var(--paper-2)] in-[[data-surface=paper]]:aria-pressed:text-[var(--accent)] in-[[data-surface=paper]]:aria-pressed:border-[var(--paper-line)]",
        danger:
          "bg-transparent text-[var(--red)] border border-transparent hover:bg-[rgba(201,106,90,0.1)] hover:border-[rgba(201,106,90,0.3)] in-[[data-surface=paper]]:text-[var(--alert)]",
      },
      size: {
        sm: "text-xs px-3 py-1.5 rounded-full gap-1.5",
        md: "text-sm px-4 py-2 rounded-lg gap-2",
        lg: "text-base px-6 py-2.5 rounded-xl gap-2.5",
      },
      full: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  href?: string;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  busy?: boolean;
  pressed?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    full,
    href,
    iconStart,
    iconEnd,
    busy,
    pressed,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref
) {
  const classes = cn(buttonVariants({ variant, size, full }), className);

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        aria-pressed={pressed}
        aria-busy={busy}
        {...(props as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {iconStart && <span className="inline-flex shrink-0">{iconStart}</span>}
        {children}
        {iconEnd && <span className="inline-flex shrink-0">{iconEnd}</span>}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-pressed={pressed}
      aria-busy={busy}
      {...props}
    >
      {busy ? (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
      ) : (
        iconStart && <span className="inline-flex shrink-0">{iconStart}</span>
      )}
      {children}
      {iconEnd && !busy && <span className="inline-flex shrink-0">{iconEnd}</span>}
    </button>
  );
});
