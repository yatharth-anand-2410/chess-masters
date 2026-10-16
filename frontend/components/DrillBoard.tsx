"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { Chess, type Square } from "chess.js";

import type { InsightMoment } from "./insights";
import { arrowSolution, parseUci, type Solution } from "./reportParsing";
import { trackEvent } from "../lib/analytics";
import { playSound } from "../lib/sound";
import { evaluateAttempt } from "../lib/attempt";

export type DrillStatus = "idle" | "solved" | "revealed";

type DrillBoardProps = {
  moment: InsightMoment;
  status: DrillStatus;
  onAttempt: (correct: boolean) => void;
  /** Analysis the drill belongs to; required for engine-backed validation. */
  analysisId?: string | null;
  /** Result of the last attempt, announced to assistive technology. */
  liveMessage?: string;
};

type Feedback = { tone: "success" | "error" | "info"; text: string };
type PromotionChoice = "q" | "r" | "b" | "n";
type PendingPromotion = { from: string; to: string };

const WRONG_MOVE_HOLD_MS = 420;

const PROMOTION_CHOICES: { piece: PromotionChoice; label: string; glyph: string }[] = [
  { piece: "q", label: "Queen", glyph: "♕" },
  { piece: "r", label: "Rook", glyph: "♖" },
  { piece: "b", label: "Bishop", glyph: "♗" },
  { piece: "n", label: "Knight", glyph: "♘" },
];

function toKey(square: string): Key {
  return square as Key;
}

/** chess.js reports `"w" | "b"`; chessground expects full colour names. */
function toSide(color: string): "white" | "black" {
  return color === "b" ? "black" : "white";
}

/** Every legal destination, keyed by origin square, for chessground. */
function computeDests(game: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const move of game.moves({ verbose: true })) {
    const list = dests.get(toKey(move.from));
    if (list) {
      list.push(toKey(move.to));
    } else {
      dests.set(toKey(move.from), [toKey(move.to)]);
    }
  }
  return dests;
}

function emptyDests(): Map<Key, Key[]> {
  return new Map<Key, Key[]>();
}

/** Convert a SAN move into UCI by replaying it on the position it belongs to. */
function sanToUci(fen: string, san: string): string | null {
  if (!fen || !san) {
    return null;
  }
  try {
    const chess = new Chess(fen);
    const move = chess.move(san.trim());
    return move ? `${move.from}${move.to}${move.promotion ?? ""}` : null;
  } catch {
    return null;
  }
}

/**
 * The engine move for this position.
 *
 * `best_move_san` wins because it survives the promotion piece; the backend's
 * green arrow is the UCI fallback and drops the promotion character.
 */
function deriveSolution(moment: InsightMoment): Solution | null {
  if (moment.best_move_san) {
    const fromSan = parseUci(sanToUci(moment.fen_before, moment.best_move_san));
    if (fromSan && fromSan.to !== fromSan.from) {
      return fromSan;
    }
  }
  return arrowSolution(moment);
}

/**
 * Replay-your-own-blunder board.
 *
 * The position is one the player actually reached, so a solved drill corrects
 * a real mistake instead of an unrelated puzzle. The exact engine move is still
 * accepted instantly, but any other legal move is now graded by Stockfish: an
 * alternative that stays within tolerance of the engine's pick, or that holds
 * the evaluation the player already had, counts as correct. When the engine
 * cannot answer, the board falls back to the old exact-match check and says so
 * rather than calling the move wrong.
 *
 * Promotion is picked by the player, so an underpromotion validates correctly.
 *
 * Chessground never reads the side to move out of a FEN, so every position
 * change restates `turnColor`. Without it a drill where Black is to move — half
 * of them, since the player who blundered is the side to move — was silent: the
 * board's own turn colour stayed on white, my move failed the mobility check
 * and chessground quietly filed it as a *premove*, which never fires the
 * `after` event, so nothing was graded and nothing was shown. Premoves are off
 * below as well, so a future mismatch refuses the move instead of hiding it.
 */
export default function DrillBoard({
  moment,
  status,
  onAttempt,
  analysisId,
  liveMessage,
}: DrillBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const gameRef = useRef<Chess | null>(null);
  const revertTimerRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const mountedRef = useRef(false);
  const attemptCountRef = useRef(0);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  const fen = moment.fen_before;
  const orientation: "white" | "black" = moment.color === "black" ? "black" : "white";
  const solution = useMemo(() => deriveSolution(moment), [moment]);
  const motifKey = (moment.highlight_squares ?? []).join(",");

  const solutionRef = useRef<Solution | null>(solution);
  const statusRef = useRef<DrillStatus>(status);
  const fenRef = useRef(fen);
  const analysisIdRef = useRef<string | null>(analysisId ?? null);
  // A change to the position or the analysis means the shared board instance
  // must not keep using the previous attempt's anchors.
  solutionRef.current = solution;
  statusRef.current = status;
  fenRef.current = fen;
  analysisIdRef.current = analysisId ?? null;

  const clearRevertTimer = useCallback(() => {
    if (revertTimerRef.current !== null) {
      window.clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
  }, []);

  const lockBoard = useCallback(() => {
    lockedRef.current = true;
    apiRef.current?.set({
      movable: { free: false, color: undefined, dests: emptyDests(), showDests: false },
    });
  }, []);

  const unlockBoard = useCallback((game: Chess) => {
    lockedRef.current = false;
    apiRef.current?.set({
      fen: game.fen(),
      turnColor: toSide(game.turn()),
      lastMove: undefined,
      movable: {
        free: false,
        color: toSide(game.turn()),
        dests: computeDests(game),
        showDests: true,
      },
    });
  }, []);

  const acceptPlayed = useCallback(
    (played: { from: string; to: string }, message: string) => {
      const api = apiRef.current;
      const game = gameRef.current;
      if (!api || !game) {
        return;
      }
      clearRevertTimer();
      lockBoard();
      setChecking(false);
      setFeedback({ tone: "success", text: message });
      api.set({
        // Re-state the fen so a promotion shows the promoted piece: in the
        // `after` event chessground has moved the pawn but not promoted it.
        fen: game.fen(),
        turnColor: toSide(game.turn()),
        lastMove: [toKey(played.from), toKey(played.to)],
        drawable: {
          enabled: false,
          visible: true,
          autoShapes: [
            {
              orig: toKey(played.from),
              dest: toKey(played.to),
              brush: "green",
            } as DrawShape,
          ],
        },
      });
      onAttempt(true);
    },
    [clearRevertTimer, lockBoard, onAttempt]
  );

  const rejectPlayed = useCallback(
    (message: string, tone: Feedback["tone"]) => {
      const api = apiRef.current;
      const game = gameRef.current;
      if (!api || !game) {
        return;
      }
      setChecking(false);
      setFeedback({ tone, text: message });
      // Let the player see what they played, then hand the position back.
      // Destinations are cleared immediately so no further move can be made
      // while the revert is pending; otherwise chessground and the local game
      // would drift out of sync.
      onAttempt(false);
      lockBoard();
      clearRevertTimer();
      revertTimerRef.current = window.setTimeout(() => {
        revertTimerRef.current = null;
        if (statusRef.current !== "idle") {
          return;
        }
        game.undo();
        unlockBoard(game);
      }, WRONG_MOVE_HOLD_MS);
    },
    [clearRevertTimer, lockBoard, onAttempt, unlockBoard]
  );

  /**
   * Practice attempt metric. Records how the move was judged — the exact engine
   * move, a non-exact move the engine validated within its 0.5-pawn tolerance
   * (`acceptedAsAlternative`), or an unvalidated/wrong attempt — without ever
   * sending the move itself.
   */
  const trackAttempt = useCallback(
    (
      attemptNumber: number,
      correct: boolean,
      engineValidated: boolean,
      acceptedAsAlternative: boolean
    ) => {
      trackEvent("drill_attempt", {
        attemptNumber,
        phase: moment.phase,
        motif: moment.motif ?? null,
        correct,
        engineValidated,
        acceptedAsAlternative,
      });
    },
    [moment.phase, moment.motif]
  );

  /**
   * Decide one replayed move. `played` has already been applied to the local
   * game, so the board and the game agree about the position.
   */
  const settleMove = useCallback(
    (played: { from: string; to: string; promotion?: string }) => {
      const attemptNumber = (attemptCountRef.current += 1);
      const target = solutionRef.current;
      const promotionOk =
        !target?.promotion || target.promotion === (played.promotion ?? "");
      const exact =
        Boolean(target) &&
        target?.from === played.from &&
        target?.to === played.to &&
        promotionOk;

      if (exact) {
        trackAttempt(attemptNumber, true, false, false);
        acceptPlayed(played, "Correct — that is the move you missed.");
        return;
      }

      const currentAnalysis = analysisIdRef.current;
      if (!currentAnalysis) {
        // No way to ask the engine (signed out, or an unpersisted report).
        trackAttempt(attemptNumber, false, false, false);
        rejectPlayed(
          "Not the move the engine found. Try again, or reveal it.",
          "error"
        );
        return;
      }

      const uci = `${played.from}${played.to}${played.promotion ?? ""}`;
      lockBoard();
      setChecking(true);

      evaluateAttempt({
        analysisId: currentAnalysis,
        fen: fenRef.current,
        played: uci,
        evalBeforePawns: moment.eval_before_pawns ?? null,
      })
        .then((result) => {
          if (!mountedRef.current || statusRef.current !== "idle") {
            return;
          }
          if (result?.validated) {
            if (result.reasonable) {
              trackAttempt(attemptNumber, true, true, true);
              acceptPlayed(
                played,
                result.reason || "That move keeps your position — well found."
              );
            } else {
              trackAttempt(attemptNumber, false, true, false);
              rejectPlayed(
                result.reason || "That move gives up too much. Try again.",
                "error"
              );
            }
            return;
          }
          // Validation unavailable: keep the old exact-match outcome and be
          // honest that the engine did not grade the move.
          trackAttempt(attemptNumber, false, false, false);
          rejectPlayed(
            "We could not verify that move just now. Try the engine move, or reveal it.",
            "info"
          );
        })
        .catch(() => {
          if (!mountedRef.current || statusRef.current !== "idle") {
            return;
          }
          trackAttempt(attemptNumber, false, false, false);
          rejectPlayed(
            "We could not verify that move just now. Try the engine move, or reveal it.",
            "info"
          );
        });
    },
    [acceptPlayed, lockBoard, moment.eval_before_pawns, rejectPlayed, trackAttempt]
  );

  const evaluate = useCallback(
    (orig: string, dest: string) => {
      const game = gameRef.current;
      const api = apiRef.current;
      if (!game || !api || lockedRef.current || statusRef.current !== "idle") {
        return;
      }

      setFeedback(null);

      // A pawn reaching the last rank needs a piece choice. Detect it before
      // touching the local game so the player, not the board, decides.
      const moving = game.get(orig as Square);
      const isPromotion =
        moving?.type === "p" && (dest[1] === "8" || dest[1] === "1");
      if (isPromotion) {
        lockBoard();
        setPromotion({ from: orig, to: dest });
        return;
      }

      let played;
      try {
        played = game.move({ from: orig, to: dest, promotion: "q" });
      } catch {
        return;
      }
      if (!played) {
        return;
      }

      playSound("move");
      settleMove(played);
    },
    [lockBoard, settleMove]
  );

  const resolvePromotion = useCallback(
    (piece: PromotionChoice) => {
      const pending = promotion;
      setPromotion(null);
      const game = gameRef.current;
      if (!pending || !game) {
        return;
      }
      let played;
      try {
        played = game.move({ from: pending.from, to: pending.to, promotion: piece });
      } catch {
        return;
      }
      if (!played) {
        const api = apiRef.current;
        if (api) {
          unlockBoard(game);
        }
        return;
      }
      playSound("move");
      settleMove(played);
    },
    [promotion, settleMove, unlockBoard]
  );

  const cancelPromotion = useCallback(() => {
    setPromotion(null);
    const game = gameRef.current;
    if (!game) {
      return;
    }
    unlockBoard(game);
  }, [unlockBoard]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !fen) {
      return;
    }

    let game: Chess;
    try {
      game = new Chess(fen);
    } catch {
      return;
    }
    gameRef.current = game;
    lockedRef.current = statusRef.current !== "idle";
    mountedRef.current = true;

    apiRef.current = Chessground(element, {
      fen,
      // Chessground does not derive the side to move from the FEN.
      turnColor: toSide(game.turn()),
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true },
      // A drill grades exactly the one move the player makes; a premove would
      // be recorded by chessground without ever reaching `after`.
      premovable: { enabled: false, showDests: false },
      movable: {
        free: false,
        color: lockedRef.current ? undefined : toSide(game.turn()),
        dests: lockedRef.current ? emptyDests() : computeDests(game),
        showDests: !lockedRef.current,
        events: {
          // Handled after chessground applies the move, so the local game and
          // the rendered board never disagree about the position.
          after: (orig, dest) => {
            evaluate(orig, dest);
          },
        },
      },
    });

    return () => {
      mountedRef.current = false;
      clearRevertTimer();
      apiRef.current?.destroy();
      apiRef.current = null;
      gameRef.current = null;
    };
    // The board is created once per position; later updates flow through set().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  /** Reset the position and replay the engine move when the player gives up. */
  useEffect(() => {
    if (status !== "revealed" || !solution || !fen) {
      return;
    }
    const api = apiRef.current;
    if (!api) {
      return;
    }
    clearRevertTimer();
    lockBoard();
    setChecking(false);
    setPromotion(null);

    let game: Chess;
    try {
      game = new Chess(fen);
      game.move({
        from: solution.from,
        to: solution.to,
        promotion: solution.promotion ?? "q",
      });
    } catch {
      return;
    }
    gameRef.current = game;

    const shapes: DrawShape[] = [
      { orig: toKey(solution.from), dest: toKey(solution.to), brush: "green" } as DrawShape,
    ];
    const custom = new Map<Key, string>(
      motifKey
        .split(",")
        .filter(Boolean)
        .map((square) => [toKey(square), "cg-custom-highlight"])
    );

    api.set({
      fen: game.fen(),
      turnColor: toSide(game.turn()),
      lastMove: [toKey(solution.from), toKey(solution.to)],
      highlight: { lastMove: true, check: true, custom },
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    });
  }, [status, solution, fen, motifKey, clearRevertTimer, lockBoard]);

  const sideToMove = useMemo(() => {
    try {
      return toSide(new Chess(fen).turn());
    } catch {
      return orientation;
    }
  }, [fen, orientation]);

  return (
    <div className="drill-board-shell">
      <div
        className="drill-board"
        ref={elementRef}
        role="img"
        aria-label={`Chess position, ${sideToMove} to move. Find the best move.`}
      />

      {promotion && (
        <div
          className="drill-promotion"
          role="group"
          aria-label="Choose a promotion piece"
        >
          <span className="drill-promotion-label">Promote to</span>
          <div className="drill-promotion-options">
            {PROMOTION_CHOICES.map((choice) => (
              <button
                key={choice.piece}
                type="button"
                className="drill-promotion-btn"
                onClick={() => resolvePromotion(choice.piece)}
                aria-label={choice.label}
              >
                <span aria-hidden="true">{choice.glyph}</span>
              </button>
            ))}
            <button
              type="button"
              className="drill-promotion-cancel"
              onClick={cancelPromotion}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {checking && (
        <p className="drill-attempt-note drill-attempt-info">
          Checking with the engine…
        </p>
      )}

      {!checking && feedback && (
        <p className={`drill-attempt-note drill-attempt-${feedback.tone}`}>
          {feedback.text}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </div>
  );
}
