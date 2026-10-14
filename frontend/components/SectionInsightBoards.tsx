"use client";

import React, { useId, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import CriticalPositionBoard from "./CriticalPositionBoard";
import { ChevronDownIcon } from "./ReportIcons";
import type { InsightMoment } from "./insights";
import { Pill } from "./ui/Pill";

function qualityLabel(quality: string): string {
  switch (quality) {
    case "blunder":
      return "Blunder";
    case "mistake":
      return "Mistake";
    case "inaccuracy":
      return "Inaccuracy";
    case "strong":
      return "Strong play";
    default:
      return quality;
  }
}

const qualityToneMap: Record<string, "alert" | "caution" | "positive" | "neutral"> = {
  blunder: "alert",
  mistake: "caution",
  inaccuracy: "caution",
  strong: "positive",
};

function phaseLabel(phase: string): string {
  switch (phase) {
    case "opening":
      return "Opening";
    case "middlegame":
      return "Middlegame";
    case "endgame":
      return "Endgame";
    default:
      return phase;
  }
}

function moveLabel(moment: InsightMoment): string {
  return `${moment.move_number}${moment.color === "black" ? "..." : "."} ${moment.san}`;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SUB_TEN_SECOND_LIMIT = 10;

function formatDuration(value: number | null | undefined): string | null {
  const seconds = finite(value);
  if (seconds === null || seconds < 0) {
    return null;
  }
  if (seconds < SUB_TEN_SECOND_LIMIT) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

function formatClock(value: number | null | undefined): string | null {
  const seconds = finite(value);
  if (seconds === null) {
    return null;
  }
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const padded = String(remainder).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${padded}`;
  }
  return `${minutes}:${padded}`;
}

function MoveEvidence({ moment }: { moment: InsightMoment }) {
  const spent = formatDuration(moment.player_seconds_spent ?? moment.seconds_spent);
  const clock = formatClock(moment.player_clock_remaining ?? moment.clock_remaining);
  const rushed = moment.post_error_rush === true;

  if (!spent && !clock && !rushed) {
    return null;
  }

  return (
    <div className="insight-evidence">
      {spent && <span className="insight-stat">Took {spent}</span>}
      {clock && <span className="insight-stat">{clock} left</span>}
      {rushed && (
        <span className="insight-stat insight-stat-rush" title="Move made in under 1.5s after an opponent's error">
          Rushed reply
        </span>
      )}
    </div>
  );
}

function InsightBoardCard({ moment }: { moment: InsightMoment }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const hasBoard =
    moment.fen_before && (moment.player_color === "white" || moment.player_color === "black");
  const isStrength = moment.quality === "strong";
  const hasMomentText = Boolean(
    moment.motif ||
      moment.blindspot ||
      moment.note ||
      moment.better_move_idea ||
      (!isStrength && moment.best_move_san)
  );
  const hasText = hasMomentText;
  const bodyClass = [
    "insight-card-body",
    !hasBoard ? "no-board" : "",
    hasBoard && !hasText ? "board-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const strongerIdea = !isStrength && moment.best_move_san ? moment.best_move_san : null;
  const hasDeeper = Boolean(
    moment.motif || moment.blindspot || strongerIdea || moment.mechanism
  );
  const evidence = <MoveEvidence moment={moment} />;

  const tone = qualityToneMap[moment.quality] ?? "neutral";

  return (
    <div data-surface="paper" className={`insight-card quality-${moment.quality}`}>
      <div className="insight-card-header flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {moment.game_label && (
            <Pill tone="neutral" size="sm">{moment.game_label}</Pill>
          )}
          <span className="insight-move font-mono font-bold text-sm text-[var(--paper-text)]">
            {moveLabel(moment)}
          </span>
          <Pill tone={tone} size="sm">
            {qualityLabel(moment.quality)}
          </Pill>
        </div>
        {moment.phase && (
          <Pill tone="neutral" size="sm">
            {phaseLabel(moment.phase)}
          </Pill>
        )}
      </div>

      <div className={bodyClass}>
        {hasBoard && (
          <div className="insight-board">
            <CriticalPositionBoard
              fen={moment.fen_before}
              orientation={moment.player_color === "black" ? "black" : "white"}
              highlightSquares={moment.highlight_squares ?? []}
              arrows={moment.arrows ?? []}
              lastMove={
                moment.played_move && moment.played_move.length >= 4
                  ? [moment.played_move.slice(0, 2), moment.played_move.slice(2, 4)]
                  : undefined
              }
            />
          </div>
        )}

        <div className="insight-card-text">
          {moment.note && (
            <div className="insight-block">
              <span className="insight-label text-xs font-semibold text-[var(--paper-muted)]">
                {isStrength ? "Why it worked" : "What happened"}
              </span>
              <p>{moment.note}</p>
              {evidence}
            </div>
          )}

          {!moment.note && evidence}

          {hasDeeper && (
            <div className={`insight-more${open ? " is-open" : ""}`}>
              <button
                type="button"
                className="insight-more-toggle inline-flex items-center gap-1.5 text-xs text-[var(--accent)] font-medium hover:underline cursor-pointer"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls={panelId}
              >
                <span>{open ? "Hide deeper analysis" : "Deeper analysis"}</span>
                <ChevronDownIcon className={`insight-more-icon transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {open && (
                  <motion.div
                    id={panelId}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="insight-more-panel overflow-hidden"
                  >
                    {moment.mechanism && (
                      <div className="insight-block">
                        <span className="insight-label text-xs font-semibold text-[var(--paper-muted)]">Why this happens</span>
                        <p>{moment.mechanism}</p>
                      </div>
                    )}

                    {moment.motif && (
                      <div className="insight-block">
                        <span className="insight-label text-xs font-semibold text-[var(--paper-muted)]">Detected motif</span>
                        <p>
                          <strong>{moment.motif}</strong>
                          {moment.motif_details ? ` — ${moment.motif_details}` : ""}
                        </p>
                      </div>
                    )}

                    {moment.blindspot && (
                      <div className="insight-block">
                        <span className="insight-label text-xs font-semibold text-[var(--paper-muted)]">Calculation blind spot</span>
                        <p>{moment.blindspot.explanation}</p>
                      </div>
                    )}

                    {strongerIdea && (
                      <div className="insight-block">
                        <span className="insight-label text-xs font-semibold text-[var(--paper-muted)]">Stronger idea</span>
                        <p>
                          <strong>{strongerIdea}</strong>
                          {moment.better_move_idea ? ` — ${moment.better_move_idea}` : ""}
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SectionInsightBoardsProps = {
  moments?: InsightMoment[];
};

export default function SectionInsightBoards({ moments }: SectionInsightBoardsProps) {
  if (!moments || moments.length === 0) {
    return null;
  }
  return (
    <div className="section-boards">
      {moments.map((moment, index) => (
        <InsightBoardCard key={`${moment.move_number}-${index}`} moment={moment} />
      ))}
    </div>
  );
}
