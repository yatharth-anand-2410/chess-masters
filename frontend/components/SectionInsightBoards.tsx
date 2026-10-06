"use client";

import CriticalPositionBoard from "./CriticalPositionBoard";
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

function InsightBoardCard({ moment }: { moment: InsightMoment }) {
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

          {!isStrength && moment.best_move_san && (
            <div className="insight-block">
              <span className="insight-label">Stronger idea</span>
              <p>
                <strong>{moment.best_move_san}</strong>
                {moment.better_move_idea ? ` — ${moment.better_move_idea}` : ""}
              </p>
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