"use client";

import React, { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  id: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { className, label, id, hint, error, action, disabled, ...props },
  ref
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {(label || action) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <label
              htmlFor={id}
              className="font-medium text-[var(--text-muted)] in-[[data-surface=paper]]:text-[var(--paper-muted)]"
            >
              {label}
            </label>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      <input
        ref={ref}
        id={id}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          "w-full px-3.5 py-2.5 rounded-[var(--radius-control)] text-sm font-sans",
          "bg-[var(--input-bg)] text-[var(--text)] border border-[var(--input-line)]",
          "placeholder:text-[var(--text-muted)] transition-colors duration-150",
          "hover:border-[#4d6267] focus-visible:outline-none focus-visible:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[rgba(201,153,63,0.2)]",
          "in-[[data-surface=paper]]:bg-white in-[[data-surface=paper]]:text-[var(--paper-text)] in-[[data-surface=paper]]:border-[var(--paper-line)]",
          "in-[[data-surface=paper]]:focus-visible:border-[var(--accent)] in-[[data-surface=paper]]:focus-visible:ring-[rgba(47,107,98,0.2)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          error && "border-[var(--red)] focus-visible:border-[var(--red)] focus-visible:ring-[rgba(201,106,90,0.2)]",
          className
        )}
        {...props}
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--red)] in-[[data-surface=paper]]:text-[var(--alert)]"
        >
          {error}
        </p>
      )}
      {hint && !error && (
        <p
          id={hintId}
          className="text-xs text-[var(--text-muted)] in-[[data-surface=paper]]:text-[var(--paper-muted)]"
        >
          {hint}
        </p>
      )}
    </div>
  );
});
