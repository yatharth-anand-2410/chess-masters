"use client";

import React, { type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const pillVariants = cva(
  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium tracking-tight border select-none transition-colors",
  {
    variants: {
      tone: {
        shell:
          "bg-[rgba(201,153,63,0.1)] text-[var(--gold-bright)] border-[rgba(201,153,63,0.3)] in-[[data-surface=paper]]:bg-[rgba(47,107,98,0.12)] in-[[data-surface=paper]]:text-[var(--accent)] in-[[data-surface=paper]]:border-[rgba(47,107,98,0.28)]",
        neutral:
          "bg-[var(--ink-3)] text-[var(--text-muted)] border-[var(--line-soft)] in-[[data-surface=paper]]:bg-[var(--paper-2)] in-[[data-surface=paper]]:text-[var(--paper-muted)] in-[[data-surface=paper]]:border-[var(--paper-line)]",
        accent:
          "bg-[rgba(87,164,150,0.12)] text-[var(--teal-light)] border-[rgba(87,164,150,0.3)] in-[[data-surface=paper]]:bg-[rgba(47,107,98,0.12)] in-[[data-surface=paper]]:text-[var(--accent)] in-[[data-surface=paper]]:border-[rgba(47,107,98,0.28)]",
        alert:
          "bg-[rgba(201,106,90,0.12)] text-[var(--red)] border-[rgba(201,106,90,0.3)] in-[[data-surface=paper]]:bg-[rgba(125,53,39,0.1)] in-[[data-surface=paper]]:text-[var(--alert)] in-[[data-surface=paper]]:border-[rgba(125,53,39,0.3)]",
        positive:
          "bg-[rgba(111,163,131,0.12)] text-[var(--green)] border-[rgba(111,163,131,0.3)] in-[[data-surface=paper]]:bg-[rgba(47,107,98,0.12)] in-[[data-surface=paper]]:text-[var(--accent)] in-[[data-surface=paper]]:border-[rgba(47,107,98,0.3)]",
        caution:
          "bg-[rgba(211,162,74,0.12)] text-[var(--amber)] border-[rgba(211,162,74,0.3)] in-[[data-surface=paper]]:bg-[rgba(125,90,28,0.12)] in-[[data-surface=paper]]:text-[var(--bronze)] in-[[data-surface=paper]]:border-[rgba(125,90,28,0.3)]",
      },
      size: {
        sm: "text-[0.7rem] px-2 py-0.5",
        md: "text-xs px-2.5 py-0.5",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  }
);

export interface PillProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  dot?: boolean;
  icon?: ReactNode;
}

export function Pill({
  className,
  tone,
  size,
  dot,
  icon,
  children,
  ...props
}: PillProps) {
  return (
    <span className={cn(pillVariants({ tone, size }), className)} {...props}>
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-current shrink-0"
          aria-hidden="true"
        />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
