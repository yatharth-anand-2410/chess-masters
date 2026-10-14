"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { DrillStatus } from "./DrillBoard";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PlayIcon,
  RotateIcon,
  SparkIcon,
  XIcon,
} from "./ReportIcons";
import type { InsightsData, InsightMoment, Resource } from "./insights";
import { findResourceForMoment, moveLabel, phaseLabel, stakesFor } from "./reportParsing";
import { trackEvent } from "../lib/analytics";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";

const DrillBoard = dynamic(() => import("./DrillBoard"), {
  ssr: false,
  loading: () => <div className="drill-board-loading" aria-hidden="true" />,
});

const MIXED_TACTICS_URL = "https://lichess.org/training/mix";
const HINT_AFTER_ATTEMPTS = 2;

type DrillCardProps = {
  moment: InsightMoment;
  insights?: InsightsData | null;
  index: number;
  analysisId?: string | null;
};

export default function DrillCard({ moment, insights, index, analysisId }: DrillCardProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DrillStatus>("idle");
  const [attempts, setAttempts] = useState(0);
  const [live, setLive] = useState("");
  const [round, setRound] = useState(0);

  const stakes = stakesFor(moment.centipawn_loss);
  const resource: Resource | undefined = useMemo(
    () => findResourceForMoment(insights?.resources, moment),
    [insights?.resources, moment]
  );

  const label = moveLabel(moment);
  const phase = phaseLabel(moment.phase);
  const explanation =
    moment.better_move_idea ?? moment.blindspot?.explanation ?? moment.note ?? "";

  const onAttempt = useCallback((correct: boolean) => {
    setAttempts((count) => count + 1);
    if (correct) {
      setStatus("solved");
      setLive("Correct — that is the move you missed.");
    } else {
      setLive("Not the best move. Try again.");
    }
    trackEvent("drill_outcome", {
      index,
      outcome: correct ? "solved" : "wrong",
      attempts: attempts + 1,
    });
  }, [attempts, index]);

  const reveal = useCallback(() => {
    setStatus("revealed");
    setLive(
      moment.best_move_san
        ? `The engine move was ${moment.best_move_san}.`
        : "Showing the engine move."
    );
    trackEvent("drill_outcome", {
      index,
      outcome: "revealed",
      attempts: attempts + 1,
    });
  }, [attempts, index, moment.best_move_san]);

  const reset = useCallback(() => {
    setStatus("idle");
    setAttempts(0);
    setLive("Position reset. Find the stronger move.");
    setRound((current) => current + 1);
  }, []);

  const openDrill = () => {
    setOpen(true);
    trackEvent("drill_opened", {
      index,
      phase: moment.phase ?? "unknown",
      motif: moment.motif ?? null,
    });
  };

  const themeLabel = moment.motif?.trim();
  const practiceLabel = resource?.url
    ? `Practise ${themeLabel ? themeLabel.toLowerCase() : "this theme"}`
    : "Practise mixed tactics";

  const showHint = status === "idle" && attempts >= HINT_AFTER_ATTEMPTS;
  const hintText = themeLabel ? `Hint: it is a ${themeLabel.toLowerCase()} idea.` : null;

  const stakeTone =
    stakes.tier === "severe" || stakes.tier === "high"
      ? "alert"
      : stakes.tier === "moderate"
        ? "caution"
        : "neutral";

  return (
    <article
      data-surface="paper"
      className={`drill-card${open ? " is-open" : ""} status-${status}`}
      id={`drill-${index}`}
    >
      <header className="drill-head flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="drill-rank font-serif text-lg font-bold text-[var(--paper-text)]" aria-hidden="true">
            {index + 1}
          </span>
          <div className="drill-tags flex items-center gap-1.5 flex-wrap">
            {themeLabel && (
              <Pill tone="accent" size="sm" icon={<SparkIcon className="w-3 h-3" />}>
                {themeLabel}
              </Pill>
            )}
            {phase && <Pill tone="neutral" size="sm">{phase}</Pill>}
            <Pill tone={stakeTone} size="sm">
              {stakes.label}
            </Pill>
          </div>
        </div>
        {status === "solved" && (
          <Pill tone="positive" size="sm" icon={<CheckIcon className="w-3 h-3" />}>
            Solved
          </Pill>
        )}
      </header>

      <p className="drill-lead">
        You played <strong>{label}</strong> in this position.
      </p>
      <p className="drill-prompt">
        A stronger move was available. {open ? "Find it on the board." : "Can you find it?"}
      </p>

      {showHint && hintText && <p className="drill-hint">{hintText}</p>}

      {/* Smooth height expansion for DrillBoard */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden my-3"
          >
            <DrillBoard
              key={round}
              moment={moment}
              status={status}
              onAttempt={onAttempt}
              analysisId={analysisId}
              liveMessage={live}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {status === "solved" && (
        <p className="drill-result drill-result-solved">
          {moment.best_move_san
            ? `Solved. The engine's pick here was ${moment.best_move_san}.`
            : "Solved — that move keeps your position."}
        </p>
      )}

      {status === "revealed" && (
        <p className="drill-result drill-result-revealed">
          The engine move was
          {moment.best_move_san ? (
            <>
              {" "}
              <strong>{moment.best_move_san}</strong>
            </>
          ) : (
            " the move shown on the board"
          )}
          .
        </p>
      )}

      {explanation && status !== "idle" && <p className="drill-explain">{explanation}</p>}

      <footer className="drill-foot flex items-center gap-2 flex-wrap pt-2">
        {!open && (
          <Button
            variant="primary"
            size="sm"
            onClick={openDrill}
            iconStart={<PlayIcon className="w-3.5 h-3.5" />}
          >
            Attempt move
          </Button>
        )}

        {open && status === "idle" && (
          <>
            {attempts > 0 && (
              <span className="drill-attempts text-xs text-[var(--paper-muted)] flex items-center gap-1 font-mono">
                <XIcon className="w-3 h-3 text-[var(--alert)]" />
                {attempts} {attempts === 1 ? "try" : "tries"}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={reveal}>
              Show me the move
            </Button>
          </>
        )}

        {open && status !== "idle" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            iconStart={<RotateIcon className="w-3.5 h-3.5" />}
          >
            Try again
          </Button>
        )}

        <a
          className="drill-link text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1 ml-auto"
          href={resource?.url ?? MIXED_TACTICS_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() =>
            trackEvent("training_link_click", {
              index,
              kind: resource?.url ? "theme" : "mixed",
            })
          }
        >
          {practiceLabel}
          <ExternalLinkIcon className="w-3 h-3" />
        </a>

        {open && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setOpen(false)}
            aria-label="Collapse this drill"
            iconStart={<ChevronDownIcon className="w-3.5 h-3.5 rotate-180" />}
          />
        )}
      </footer>
    </article>
  );
}
