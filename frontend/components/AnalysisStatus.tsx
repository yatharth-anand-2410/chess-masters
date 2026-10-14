"use client";

import React from "react";
import { Check, Loader2, Sparkles, Brain, FileText } from "lucide-react";
import { cn } from "../lib/utils";

type AnalysisStatusProps = {
  status?: string;
  isAnalyzing?: boolean;
};

export default function AnalysisStatus({
  status,
  isAnalyzing,
}: AnalysisStatusProps) {
  if (!status && !isAnalyzing) {
    return null;
  }

  const s = (status || "").toLowerCase();

  // Determine current pipeline stage (1: Extract, 2: Engine, 3: AI Lesson)
  let currentStep = 1;
  if (
    s.includes("ai") ||
    s.includes("generat") ||
    s.includes("writing") ||
    s.includes("report") ||
    s.includes("synthes")
  ) {
    currentStep = 3;
  } else if (
    s.includes("analyz") ||
    s.includes("engine") ||
    s.includes("eval") ||
    s.includes("stockfish") ||
    s.includes("blunder")
  ) {
    currentStep = 2;
  } else if (s.includes("complete") || (!isAnalyzing && status)) {
    currentStep = 4; // all done
  }

  const steps = [
    { id: 1, label: "Fetch PGN", icon: FileText },
    { id: 2, label: "Stockfish Engine", icon: Brain },
    { id: 3, label: "AI Master Lesson", icon: Sparkles },
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full flex flex-col items-center gap-3 p-3.5 sm:p-4 rounded-[var(--radius-card)] bg-[var(--ink-2)] border border-[var(--line-soft)]"
    >
      {/* Step Indicators */}
      <div className="flex items-center justify-between w-full max-w-md relative">
        {/* Connecting track line */}
        <div
          className="absolute left-6 right-6 top-3.5 h-[1px] bg-[var(--line-soft)] -z-0"
          aria-hidden="true"
        />

        {steps.map((step) => {
          const isDone = currentStep > step.id || currentStep === 4;
          const isActive = currentStep === step.id && isAnalyzing;
          const StepIcon = step.icon;

          return (
            <div
              key={step.id}
              className="flex flex-col items-center gap-1.5 z-10"
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-medium transition-colors duration-300",
                  isDone &&
                    "bg-[var(--green)] text-[#0c1214] shadow-sm",
                  isActive &&
                    "bg-[var(--gold)] text-[#0c1214] ring-4 ring-[rgba(201,153,63,0.2)] animate-pulse",
                  !isDone &&
                    !isActive &&
                    "bg-[var(--ink-3)] text-[var(--text-muted)] border border-[var(--line-soft)]"
                )}
              >
                {isDone ? (
                  <Check size={14} strokeWidth={3} />
                ) : isActive ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <StepIcon size={12} />
                )}
              </div>
              <span
                className={cn(
                  "text-[0.72rem] font-medium tracking-tight",
                  isDone && "text-[var(--text)]",
                  isActive && "text-[var(--gold-bright)] font-semibold",
                  !isDone && !isActive && "text-[var(--text-muted)]"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Live Message Description */}
      {status && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
          {isAnalyzing && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--gold-bright)] animate-ping"
              aria-hidden="true"
            />
          )}
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}
