"use client";

import { useId, useState } from "react";

import CriticalPositionBoard from "./CriticalPositionBoard";
import { ChevronDownIcon } from "./ReportIcons";
import type { InsightMoment } from "./insights";

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

/**
 * Numbers arriving from JSON are untrusted: anything that is not a finite
 * number is treated as missing so it renders as nothing instead of `NaN`.
 */
function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SUB_TEN_SECOND_LIMIT = 10;

/** Move duration: `1.4s` below ten seconds, whole seconds above (`12s`). */
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

/** Clock reading: `2:07`, widening to `1:02:07` only for long time controls. */
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

/**
 * Clock evidence for one moment: how long the move took, what was left on the
 * clock, and whether the player rushed the reply.
 *
 * Every part is optional and independently emitted, because clock data only
 * exists for games whose source carried it. A moment with nothing to say
 * renders no element at all — no em dash, no zero.
 */
function MoveEvidence({ moment }: { moment: InsightMoment }) {
  const spent = formatDuration(moment.player_seconds_spent ?? moment.seconds_spent);
  const clock = formatClock(moment.player_clock_remaining ?? moment.clock_remaining);
  const rushed = moment.post_error_rush === true;
  const replySeconds = formatDuration(moment.next_move?.seconds_spent);

  if (!spent && !clock && !rushed) {
    return null;
  }

  return (
    <div className="insight-evidence">
      {spent && <span className="insight-stat">Took {spent}</span>}
      {clock && <span className="insight-stat">{clock} left</span>}
      {rushed && (
        <span className="insight-rush">
          answered in {replySeconds ?? "an instant"} — rushed
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

  return (
    <div className={`insight-card quality-${moment.quality}`}>
      <div className="insight-card-header">
        {moment.game_label && (
          <span className="insight-game">{moment.game_label}</span>
        )}
        <span className="insight-move">{moveLabel(moment)}</span>
        <span className="insight-badge">{qualityLabel(moment.quality)}</span>
        {moment.phase && <span className="insight-phase">{phaseLabel(moment.phase)}</span>}
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
              <span className="insight-label">
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
                className="insight-more-toggle"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls={panelId}
              >
                {open ? "Hide deeper analysis" : "Deeper analysis"}
                <ChevronDownIcon className="insight-more-icon" />
              </button>

              {open && (
                <div className="insight-more-panel" id={panelId}>
                  {moment.mechanism && (
                    <div className="insight-block">
                      <span className="insight-label">Why this happens</span>
                      <p>{moment.mechanism}</p>
                    </div>
                  )}

                  {moment.motif && (
                    <div className="insight-block">
                      <span className="insight-label">Detected motif</span>
                      <p>
                        <strong>{moment.motif}</strong>
                        {moment.motif_details ? ` — ${moment.motif_details}` : ""}
                      </p>
                    </div>
                  )}

                  {moment.blindspot && (
                    <div className="insight-block">
                      <span className="insight-label">Calculation blind spot</span>
                      <p>{moment.blindspot.explanation}</p>
                    </div>
                  )}

                  {strongerIdea && (
                    <div className="insight-block">
                      <span className="insight-label">Stronger idea</span>
                      <p>
                        <strong>{strongerIdea}</strong>
                        {moment.better_move_idea ? ` — ${moment.better_move_idea}` : ""}
                      </p>
                    </div>
                  )}
                </div>
              )}
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
