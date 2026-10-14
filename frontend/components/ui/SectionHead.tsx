"use client";

import React, { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SectionHeadProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  as?: "h2" | "h3";
  id?: string;
  aside?: ReactNode;
  action?: ReactNode;
  hairline?: boolean;
}

export function SectionHead({
  className,
  title,
  as: Component = "h2",
  id,
  aside,
  action,
  hairline = true,
  ...props
}: SectionHeadProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-2.5 mb-5",
        hairline && "border-b border-[var(--line-soft)] in-[[data-surface=paper]]:border-[var(--paper-line)]",
        className
      )}
      {...props}
    >
      <div className="flex items-baseline gap-3">
        <Component
          id={id}
          className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] in-[[data-surface=paper]]:text-[var(--paper-text)] tracking-tight"
        >
          {title}
        </Component>
        {aside && (
          <span className="text-xs font-mono text-[var(--text-muted)] in-[[data-surface=paper]]:text-[var(--paper-muted)]">
            {aside}
          </span>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
