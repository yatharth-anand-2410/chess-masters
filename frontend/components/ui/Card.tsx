"use client";

import React, { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const cardVariants = cva(
  "rounded-[var(--radius-card)] transition-colors relative",
  {
    variants: {
      surface: {
        shell:
          "bg-[var(--ink-2)] text-[var(--text)] border border-[var(--line-soft)]",
        paper:
          "bg-[var(--paper)] text-[var(--paper-text)] border border-[var(--paper-line)]",
        empty:
          "bg-transparent text-[var(--text-muted)] border border-dashed border-[var(--line-soft)] in-[[data-surface=paper]]:text-[var(--paper-muted)] in-[[data-surface=paper]]:border-[var(--paper-line)]",
      },
      pad: {
        none: "p-0",
        sm: "p-3",
        md: "p-5 sm:p-6",
        lg: "p-6 sm:p-8",
      },
    },
    defaultVariants: {
      surface: "shell",
      pad: "md",
    },
  }
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  as?: "div" | "article" | "section" | "aside";
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, surface = "shell", pad, as = "div", children, ...props },
  ref
) {
  const Component = as;
  return (
    <Component
      ref={ref}
      data-surface={surface}
      className={cn(cardVariants({ surface, pad }), className)}
      {...props}
    >
      {children}
    </Component>
  );
});
