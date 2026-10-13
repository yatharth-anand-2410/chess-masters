"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

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

/**
 * The board pulls in a chess library, so it is code-split and only fetched
 * once a player actually opens a drill. Collapsed cards cost nothing.
 */
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
  /** Analysis the moment belongs to; enables engine-backed validation. */
  analysisId?: string | null;
};

/**
 * A collapsed-by-default challenge card built from the player's own blunder.
 *
 * Collapsing keeps the section scannable, and it also defers the board (and the
 * chess engine behind it) until someone chooses to play.
 */
export default function DrillCard({ moment, insights, index, analysisId }: DrillCardProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DrillStatus>("idle");
  const [attempts, setAttempts] = useState(0);
  const [live, setLive] = useState("");
  /**
   * Bumped on reset. Remounting the board is the simplest way to guarantee it
   * returns to an interactive starting position: the "revealed" path locks
   * `movable`, and a stale lock would otherwise survive the reset.
   */
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
    setRound((value) => value + 1);
    setLive("Position reset. Try again.");
  }, []);

  const themeLabel = moment.motif?.trim();
  const practiceLabel = resource?.url
    ? `Practise ${themeLabel ? themeLabel.toLowerCase() : "this theme"}`
    : "Practise mixed tactics";

  const showHint = status === "idle" && attempts >= HINT_AFTER_ATTEMPTS;
  const hintText = themeLabel ? `Hint: it is a ${themeLabel.toLowerCase()} idea.` : null;

  const openDrill = useCallback(() => {
    setOpen(true);
    trackEvent("drill_opened", {
      index,
      phase: moment.phase,
      motif: themeLabel ?? null,
    });
  }, [index, moment.phase, themeLabel]);

  return (
    <article
      className={`drill-card${open ? " is-open" : ""} status-${status}`}
      id={`drill-${index}`}
    >
      <header className="drill-head">
        <span className="drill-rank" aria-hidden="true">
          {index + 1}
        </span>
        <div className="drill-tags">
          {themeLabel && (
            <span className="drill-pill drill-pill-theme">
              <SparkIcon className="drill-pill-icon" />
              {themeLabel}
            </span>
          )}
          {phase && <span className="drill-pill">{phase}</span>}
          <span className={`drill-pill drill-pill-stakes stakes-${stakes.tier}`}>
            {stakes.label}
          </span>
        </div>
        {status === "solved" && (
          <span className="drill-flag">
            <CheckIcon className="drill-flag-icon" />
            Solved
          </span>
        )}
      </header>

      <p className="drill-lead">
        You played <strong>{label}</strong> in this position.
      </p>
      <p className="drill-prompt">
        A stronger move was available. {open ? "Find it on the board." : "Can you find it?"}
      </p>

      {showHint && hintText && <p className="drill-hint">{hintText}</p>}

      {open && (
        <DrillBoard
          key={round}
          moment={moment}
          status={status}
          onAttempt={onAttempt}
          analysisId={analysisId}
          liveMessage={live}
        />
      )}

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

      <footer className="drill-foot">
        {!open && (
          <button
            type="button"
            className="drill-btn drill-btn-primary"
            onClick={openDrill}
          >
            <PlayIcon className="drill-btn-icon" />
            Attempt move
          </button>
        )}

        {open && status === "idle" && (
          <>
            {attempts > 0 && (
              <span className="drill-attempts">
                <XIcon className="drill-attempts-icon" />
                {attempts} {attempts === 1 ? "try" : "tries"}
              </span>
            )}
            <button type="button" className="drill-btn drill-btn-ghost" onClick={reveal}>
              Show me the move
            </button>
          </>
        )}

        {open && status !== "idle" && (
          <button type="button" className="drill-btn drill-btn-ghost" onClick={reset}>
            <RotateIcon className="drill-btn-icon" />
            Try again
          </button>
        )}

        <a
          className="drill-link"
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
          <ExternalLinkIcon className="drill-link-icon" />
        </a>

        {open && (
          <button
            type="button"
            className="drill-collapse"
            onClick={() => setOpen(false)}
            aria-label="Collapse this drill"
          >
            <ChevronDownIcon className="drill-collapse-icon" />
          </button>
        )}
      </footer>
    </article>
  );
}
