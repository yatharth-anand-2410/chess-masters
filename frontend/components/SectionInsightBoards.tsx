"use client";

import React, { useId, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import CriticalPositionBoard from "./CriticalPositionBoard";
import { ChevronDownIcon } from "./ReportIcons";
import type { InsightMoment } from "./insights";
import { moveLabel, signedMoveLabel } from "./reportParsing";

function qualityBadge(quality: string, isStrength: boolean): string {
  switch (quality) {
    case "blunder":
      return "Critical blunder";
    case "mistake":
      return "Costly mistake";
    case "inaccuracy":
      return "Inaccuracy";
    case "strong":
      return "Tactical strength";
    default:
      return isStrength ? "Strong play" : quality;
  }
}

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
    <div className="review-moment-evidence">
      {spent && <span>Took {spent}</span>}
      {clock && <span>{clock} left</span>}
      {rushed && (
        <span title="Move made in under 1.5s after an opponent's error">
          Rushed reply
        </span>
      )}
    </div>
  );
}

function MomentCard({ moment }: { moment: InsightMoment }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const hasBoard =
    Boolean(moment.fen_before) &&
    (moment.player_color === "white" || moment.player_color === "black");
  const isStrength = moment.quality === "strong";
  const badge = qualityBadge(moment.quality, isStrength);

  const strongerIdea = !isStrength && moment.best_move_san ? moment.best_move_san : null;
  const hasDeeper = Boolean(
    moment.motif || moment.blindspot || strongerIdea || moment.mechanism
  );
  const explanation =
    moment.note ||
    moment.better_move_idea ||
    moment.blindspot?.explanation ||
    moment.motif_details ||
    null;
  const title = `${isStrength ? moveLabel(moment) : signedMoveLabel(moment)}${
    moment.motif ? ` — ${moment.motif}` : ""
  }`;

  return (
    <article className={`review-moment is-${isStrength ? "strength" : "weakness"}`}>
      <div className="review-moment-board">
        {hasBoard ? (
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
        ) : (
          <span className="review-moment-board-empty" aria-hidden="true">
            ♟
          </span>
        )}
      </div>

      <div className="review-moment-body">
        <div className="review-moment-pills">
          <span className={`review-moment-pill is-${isStrength ? "strength" : "weakness"}`}>
            {badge} · Move {moment.move_number}
          </span>
          {moment.phase && (
            <span className="review-moment-pill is-neutral">{phaseLabel(moment.phase)}</span>
          )}
        </div>

        <strong className="review-moment-title">{title}</strong>

        {explanation && <p className="review-moment-text">{explanation}</p>}

        <MoveEvidence moment={moment} />

        {hasDeeper && (
          <div className="review-moment-more">
            <button
              type="button"
              className="review-moment-more-toggle"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={panelId}
            >
              <span>{open ? "Hide deeper analysis" : "Deeper analysis"}</span>
              <ChevronDownIcon
                className={`review-moment-more-icon${open ? " is-open" : ""}`}
              />
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  id={panelId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {moment.mechanism && (
                    <div className="review-moment-block">
                      <span className="review-moment-label">Why this happens</span>
                      <p>{moment.mechanism}</p>
                    </div>
                  )}

                  {moment.motif && (
                    <div className="review-moment-block">
                      <span className="review-moment-label">Detected motif</span>
                      <p>
                        <strong>{moment.motif}</strong>
                        {moment.motif_details ? ` — ${moment.motif_details}` : ""}
                      </p>
                    </div>
                  )}

                  {moment.blindspot && (
                    <div className="review-moment-block">
                      <span className="review-moment-label">Calculation blind spot</span>
                      <p>{moment.blindspot.explanation}</p>
                    </div>
                  )}

                  {strongerIdea && (
                    <div className="review-moment-block">
                      <span className="review-moment-label">Stronger idea</span>
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
    </article>
  );
}

type SectionInsightBoardsProps = {
  moments?: InsightMoment[];
  /** Cap the cards on the main canvas; the full list stays in the report notes. */
  limit?: number;
};

export default function SectionInsightBoards({
  moments,
  limit,
}: SectionInsightBoardsProps) {
  if (!moments || moments.length === 0) {
    return null;
  }
  const shown =
    typeof limit === "number" && limit > 0 ? moments.slice(0, limit) : moments;
  return (
    <div className="review-moments">
      {shown.map((moment, index) => (
        <MomentCard key={`${moment.move_number}-${moment.san}-${index}`} moment={moment} />
      ))}
    </div>
  );
}
