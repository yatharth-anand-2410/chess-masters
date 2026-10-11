"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { Chess } from "chess.js";

import type { InsightMoment } from "./insights";
import { arrowSolution, parseUci, type Solution } from "./reportParsing";

export type DrillStatus = "idle" | "solved" | "revealed";

type DrillBoardProps = {
  moment: InsightMoment;
  status: DrillStatus;
  onAttempt: (correct: boolean) => void;
  /** Result of the last attempt, announced to assistive technology. */
  liveMessage?: string;
};

const WRONG_MOVE_HOLD_MS = 420;

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
 * a real mistake instead of an unrelated puzzle. Only the first move is
 * validated, because the stored solution is a single engine move: the copy
 * asks the player to find *the move*, never to solve a whole line.
 *
 * Promotion gets no picker and always assumes a queen, so a required
 * underpromotion will not auto-validate and falls back to the reveal button.
 */
export default function DrillBoard({
  moment,
  status,
  onAttempt,
  liveMessage,
}: DrillBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const gameRef = useRef<Chess | null>(null);
  const revertTimerRef = useRef<number | null>(null);
  const lockedRef = useRef(false);

  const fen = moment.fen_before;
  const orientation: "white" | "black" = moment.color === "black" ? "black" : "white";
  const solution = useMemo(() => deriveSolution(moment), [moment]);
  const motifKey = (moment.highlight_squares ?? []).join(",");

  const solutionRef = useRef<Solution | null>(solution);
  const statusRef = useRef<DrillStatus>(status);
  solutionRef.current = solution;
  statusRef.current = status;

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

  const evaluate = useCallback(
    (orig: string, dest: string) => {
      const game = gameRef.current;
      const api = apiRef.current;
      if (!game || !api || lockedRef.current || statusRef.current !== "idle") {
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

      const target = solutionRef.current;
      const promotionOk =
        !target?.promotion || target.promotion === (played.promotion ?? "");
      const correct =
        Boolean(target) &&
        target?.from === played.from &&
        target?.to === played.to &&
        promotionOk;

      if (correct) {
        lockBoard();
        api.set({
          // Re-state the fen so a promotion shows the promoted piece: in the
          // `after` event chessground has moved the pawn but not promoted it.
          fen: game.fen(),
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
        return;
      }

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
        api.set({
          fen: game.fen(),
          lastMove: undefined,
          movable: {
            free: false,
            color: toSide(game.turn()),
            dests: computeDests(game),
            showDests: true,
          },
        });
        lockedRef.current = false;
      }, WRONG_MOVE_HOLD_MS);
    },
    [clearRevertTimer, lockBoard, onAttempt]
  );

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

    apiRef.current = Chessground(element, {
      fen,
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true },
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
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </div>
  );
}
