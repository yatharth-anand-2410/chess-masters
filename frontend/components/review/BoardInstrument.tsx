"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { Chess } from "chess.js";

import { apiGet, type AnalysisReplay, type ReplayMove } from "../../lib/api";
import { playSound } from "../../lib/sound";
import type { InsightMoment } from "../insights";
import { arrowSolution, formatClockSeconds } from "../reportParsing";
import { openCoachDrawer } from "./GameHeader";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BAD_QUALITIES = new Set(["blunder", "mistake"]);
const EVAL_CLAMP = 10;

type SideColor = "white" | "black";

/** A replay move plus the geometry the board needs, derived locally. */
type InstrumentMove = ReplayMove & {
  from?: string;
  to?: string;
  before?: string;
};

type BoardInstrumentProps = {
  analysisId?: string | null;
  /** Supabase access token used for the replay fetch. */
  token?: string | null;
  /** Stored PGN; builds the fallback move list when no replay is served. */
  pgn?: string | null;
  playerColor?: string | null;
  playerName?: string | null;
  playerElo?: number | null;
  opponentName?: string | null;
  opponentElo?: number | null;
  timeControl?: string | null;
  /** Weakness moments: the best-move arrow for a blundered ply comes from here. */
  moments?: InsightMoment[];
  /** Pre-built replay (dev-preview fixtures); skips the network fetch. */
  replay?: AnalysisReplay | null;
};

function toKey(square: string): Key {
  return square as Key;
}

function otherSide(side: SideColor): SideColor {
  return side === "white" ? "black" : "white";
}

function sideOf(color?: string | null): SideColor {
  return color === "black" ? "black" : "white";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function qualityLabel(quality?: string | null): string | null {
  switch (quality) {
    case "blunder":
      return "Blunder";
    case "mistake":
      return "Mistake";
    case "inaccuracy":
      return "Inaccuracy";
    case "brilliant":
      return "Brilliant";
    case "good":
      return "Good";
    case "strong":
      return "Strong";
    default:
      return null;
  }
}

function qualityTone(quality?: string | null): "bad" | "good" | "neutral" {
  if (quality === "blunder" || quality === "mistake") {
    return "bad";
  }
  if (quality === "brilliant" || quality === "strong" || quality === "good") {
    return "good";
  }
  return "neutral";
}

function formatEval(pawns: number): string {
  const value = clamp(pawns, -99, 99);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}`;
}

const MISTAKE_SYMBOL: Record<string, string> = {
  blunder: "??",
  mistake: "?",
  inaccuracy: "?!",
  brilliant: "!!",
  strong: "!",
};

/** `28. Re8??` / `28... Re8` — the readout label for one replay move. */
function moveReadout(move: InstrumentMove): string {
  const moveNumber = Math.ceil(move.ply / 2);
  const separator = move.color === "black" ? "..." : ".";
  return `${moveNumber}${separator} ${move.san}${MISTAKE_SYMBOL[move.quality ?? ""] ?? ""}`;
}

/**
 * Resolve `from` / `to` for every move so the board can draw the last-move
 * highlight without the replay payload carrying geometry. Chessground only
 * needs the descendant squares; the SAN is replayed locally for them.
 */
function withGeometry(moves: ReplayMove[]): InstrumentMove[] {
  const out: InstrumentMove[] = [];
  let before: string | null = moves[0]?.color === "white" ? START_FEN : null;
  for (const move of moves) {
    let from: string | undefined;
    let to: string | undefined;
    if (before && move.san) {
      try {
        const chess = new Chess(before);
        const played = chess.move(move.san.trim());
        if (played) {
          from = played.from;
          to = played.to;
        }
      } catch {
        /* unparsable san: no geometry, still a replay step */
      }
    }
    out.push({ ...move, from, to, before: before ?? undefined });
    before = move.fen || before;
  }
  return out;
}

/**
 * Fallback move list for analyses stored before the replay capture existed:
 * chess.js replays the stored PGN. There is no eval curve and no per-move
 * quality, so the instrument hides both rather than inventing them.
 */
function buildFromPgn(
  pgn: string,
  playerColor?: string | null
): AnalysisReplay | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    if (history.length === 0) {
      return null;
    }
    const moves = history.map((move, index) => ({
      ply: index + 1,
      san: move.san,
      color: move.color === "b" ? ("black" as const) : ("white" as const),
      fen: move.after,
      quality: null,
      eval_after_pawns: null,
      seconds_spent: null,
      clock_remaining: null,
      from: move.from,
      to: move.to,
      before: move.before,
    }));
    return {
      analysis_id: "",
      moves,
      eval_curve_pawns: [],
      players: {},
      player_color: sideOf(playerColor),
      time_control: null,
      speed: null,
      result: null,
      opening_name: null,
    };
  } catch {
    return null;
  }
}

/**
 * The dark sticky instrument from the showcase: players, evaluation bar,
 * chessground board and the scrubber deck. Replay data comes from
 * `GET /api/analyses/{id}/replay`; when that endpoint has nothing for the
 * analysis, the stored PGN is replayed with chess.js so an older game still
 * steps through move by move.
 */
export default function BoardInstrument({
  analysisId,
  token,
  pgn,
  playerColor,
  playerName,
  playerElo,
  opponentName,
  opponentElo,
  timeControl,
  moments,
  replay: replayProp,
}: BoardInstrumentProps) {
  const [fetched, setFetched] = useState<AnalysisReplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dragging, setDragging] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const pgnReplay = useMemo(
    () => (pgn ? buildFromPgn(pgn, playerColor) : null),
    [pgn, playerColor]
  );

  useEffect(() => {
    if (replayProp) {
      setFetched(null);
      return;
    }
    if (!analysisId || !token) {
      setFetched(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiGet<AnalysisReplay>(`/api/analyses/${analysisId}/replay`, token)
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.moves) && data.moves.length > 0) {
          setFetched(data);
        }
      })
      .catch(() => {
        /* no stored replay — the PGN fallback (or the empty state) carries on */
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, token, replayProp]);

  const replay = replayProp ?? fetched ?? pgnReplay;
  const hasEngineReplay = Boolean(replayProp || (fetched && fetched.moves.length > 0));
  const moves = useMemo(
    () => (replay ? withGeometry(replay.moves) : []),
    [replay]
  );

  const playerSide = sideOf(replay?.player_color ?? playerColor);
  const orientation: SideColor = flipped ? otherSide(playerSide) : playerSide;

  // Start on the final position; the reader steps back through the game.
  useEffect(() => {
    setCursor(moves.length);
  }, [moves]);

  const current = cursor > 0 ? moves[cursor - 1] : null;
  const currentMoment = useMemo(() => {
    if (!current || !moments || moments.length === 0) {
      return null;
    }
    const moveNumber = Math.ceil(current.ply / 2);
    return (
      moments.find(
        (moment) =>
          moment.move_number === moveNumber && moment.color === current.color
      ) ?? null
    );
  }, [current, moments]);

  useEffect(() => {
    const element = boardRef.current;
    if (!element) {
      return;
    }
    apiRef.current = Chessground(element, {
      fen: current?.fen ?? START_FEN,
      orientation,
      viewOnly: true,
      coordinates: true,
      animation: { enabled: true, duration: 160 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true },
    });
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // The board is created once; every later position flows through set().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const fen = current?.fen ?? START_FEN;
    let turnColor: SideColor = "white";
    try {
      turnColor = new Chess(fen).turn() === "b" ? "black" : "white";
    } catch {
      turnColor = orientation;
    }

    const custom = new Map<Key, string>();
    if (currentMoment) {
      for (const square of currentMoment.highlight_squares ?? []) {
        custom.set(toKey(square), "cg-custom-highlight");
      }
    }
    if (current && BAD_QUALITIES.has(current.quality ?? "") && current.to) {
      custom.set(toKey(current.to), "review-hl-blunder");
    }

    const shapes: DrawShape[] = [];
    const solution = currentMoment ? arrowSolution(currentMoment) : null;
    if (solution) {
      shapes.push({
        orig: toKey(solution.from),
        dest: toKey(solution.to),
        brush: "green",
      } as DrawShape);
    }

    api.set({
      fen,
      orientation,
      turnColor,
      lastMove:
        current?.from && current.to
          ? [toKey(current.from), toKey(current.to)]
          : undefined,
      highlight: { lastMove: true, check: true, custom },
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    });
  }, [current, currentMoment, orientation]);

  /* ---------------------------------------------------------------- scrubber */

  const curve = useMemo(() => {
    const raw = replay?.eval_curve_pawns;
    if (Array.isArray(raw)) {
      const finite = raw.filter(
        (value) => typeof value === "number" && Number.isFinite(value)
      );
      if (finite.length >= 2) {
        let carry = 0;
        return raw.map((value) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            carry = value;
          }
          return carry;
        });
      }
    }
    const fromMoves = moves.map((move) => move.eval_after_pawns);
    const finiteCount = fromMoves.filter(
      (value) => typeof value === "number" && Number.isFinite(value)
    ).length;
    if (finiteCount >= 2 && finiteCount === fromMoves.length) {
      return fromMoves as number[];
    }
    return null;
  }, [replay, moves]);

  const curvePath = useMemo(() => {
    if (!curve || curve.length < 2) {
      return null;
    }
    const points = curve.map((value, index) => {
      const x = (index / (curve.length - 1)) * 100;
      const y = 10 - clamp(value, -EVAL_CLAMP, EVAL_CLAMP) * 0.9;
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    return `M ${points.join(" L ")}`;
  }, [curve]);

  const evalPawns =
    current && typeof current.eval_after_pawns === "number" && Number.isFinite(current.eval_after_pawns)
      ? current.eval_after_pawns
      : null;
  const whiteShare =
    evalPawns === null ? 0.5 : clamp((evalPawns + EVAL_CLAMP) / (EVAL_CLAMP * 2), 0.03, 0.97);

  const step = useCallback(
    (delta: number) => {
      const next = clamp(cursor + delta, 0, moves.length);
      if (next !== cursor) {
        playSound("move");
        setCursor(next);
      }
    },
    [cursor, moves.length]
  );

  const scrubTo = useCallback(
    (clientX: number, withSound: boolean) => {
      const track = trackRef.current;
      if (!track || moves.length === 0) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const next = Math.round(ratio * moves.length);
      if (next !== cursor) {
        if (withSound) {
          playSound("move");
        }
        setCursor(next);
      }
    },
    [cursor, moves.length]
  );

  /* ------------------------------------------------------------------ strips */

  const players = useMemo(() => {
    const fromReplay = replay?.players ?? {};
    const playerIsWhite = playerSide === "white";
    const compose = (side: SideColor) => {
      const isPlayer = side === "white" ? playerIsWhite : !playerIsWhite;
      const replayPlayer = side === "white" ? fromReplay.white : fromReplay.black;
      return {
        isPlayer,
        name:
          replayPlayer?.name ??
          (isPlayer ? playerName : opponentName) ??
          (isPlayer ? "You" : "Opponent"),
        elo:
          replayPlayer?.elo ?? (isPlayer ? playerElo : opponentElo) ?? null,
      };
    };
    return { white: compose("white"), black: compose("black") };
  }, [replay, playerSide, playerName, playerElo, opponentName, opponentElo]);

  const clockFor = useCallback(
    (side: SideColor): number | null => {
      const limit = Math.min(cursor, moves.length);
      for (let index = limit - 1; index >= 0; index -= 1) {
        const move = moves[index];
        if (move.color !== side) {
          continue;
        }
        if (typeof move.clock_remaining === "number" && Number.isFinite(move.clock_remaining)) {
          return move.clock_remaining;
        }
      }
      return null;
    },
    [cursor, moves]
  );

  const sideStrip = (side: SideColor, position: "top" | "bottom") => {
    const player = side === "white" ? players.white : players.black;
    const clockSeconds = clockFor(side);
    const clock = formatClockSeconds(clockSeconds);
    const lowClock = clockSeconds !== null && clockSeconds <= 30;
    return (
      <div
        className={`review-player-strip review-player-${side}`}
        data-position={position}
      >
        <div className="review-player-info">
          <span className={`review-player-avatar is-${side === "white" ? "w" : "b"}`} aria-hidden="true">
            {side === "white" ? "W" : "B"}
          </span>
          <b className="review-player-name">{player.name ?? "—"}</b>
          {typeof player.elo === "number" && Number.isFinite(player.elo) && (
            <span className={`review-player-elo${player.isPlayer ? " is-player" : ""}`}>
              ({player.elo})
            </span>
          )}
        </div>
        {clock && (
          <span className={`review-clock-chip${lowClock ? " is-danger" : ""}`}>
            {clock}
            {lowClock ? " ⚡" : ""}
          </span>
        )}
      </div>
    );
  };

  const badge = current ? qualityLabel(current.quality) : null;
  const badgeTone = current ? qualityTone(current.quality) : "neutral";
  const total = moves.length;
  const cursorPercent = total > 0 ? (cursor / total) * 100 : 0;
  const firstDrillable = (moments ?? []).find((moment) => moment.fen_before);

  if (!replay) {
    return (
      <aside className="review-instrument" aria-label="Game board">
        <div className="review-instrument-empty">
          <span className="review-instrument-kicker">Game replay</span>
          <p>
            {loading
              ? "Loading the move-by-move replay…"
              : "No move replay is stored for this game."}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="review-instrument" aria-label="Game board and replay scrubber">
      {sideStrip(otherSide(playerSide), "top")}

      <div className="review-board-stage">
        <div
          className="review-eval-bar"
          title={evalPawns === null ? "Evaluation unavailable" : `Evaluation ${formatEval(evalPawns)}`}
          aria-hidden={evalPawns === null}
        >
          {evalPawns !== null && (
            <>
              <div
                className="review-eval-fill"
                style={{ height: `${(whiteShare * 100).toFixed(1)}%` }}
              />
              <span className="review-eval-label">{formatEval(evalPawns)}</span>
            </>
          )}
        </div>
        <div
          className="review-board"
          ref={boardRef}
          role="img"
          aria-label="Chess position from this game"
        />
      </div>

      {sideStrip(playerSide, "bottom")}

      <div className="review-scrubber-deck">
        <div
          className="review-scrubber-track"
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Game replay position"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={cursor}
          aria-valuetext={current ? moveReadout(current) : "Starting position"}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              step(1);
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragging(true);
            scrubTo(event.clientX, true);
          }}
          onPointerMove={(event) => {
            if (dragging) {
              scrubTo(event.clientX, false);
            }
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          {curvePath ? (
            <svg
              className="review-eval-curve"
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line x1="0" y1="10" x2="100" y2="10" className="review-eval-zero" />
              <path d={curvePath} className="review-eval-path" />
            </svg>
          ) : (
            <span className="review-scrubber-note">
              {hasEngineReplay
                ? "Move replay — eval curve unavailable"
                : "Replay built from PGN — no eval data stored"}
            </span>
          )}
          <div
            className="review-scrubber-cursor"
            style={{ left: `${cursorPercent.toFixed(2)}%` }}
          />
        </div>

        <div className="review-scrubber-ctl-row">
          <div className="review-ctl-group">
            <button
              type="button"
              className="review-ctl-btn"
              onClick={() => step(-1)}
              aria-label="Previous move"
              disabled={cursor <= 0}
            >
              ◀
            </button>
            <button
              type="button"
              className="review-ctl-btn"
              onClick={() => step(1)}
              aria-label="Next move"
              disabled={cursor >= total}
            >
              ▶
            </button>
            <button
              type="button"
              className="review-ctl-btn"
              onClick={() => {
                playSound("click");
                setFlipped((value) => !value);
              }}
              aria-label="Flip board"
              title="Flip board"
            >
              ⟳
            </button>
          </div>

          <div className="review-ply-readout">
            Ply <b>{cursor}</b> / {total}
            {current && (
              <>
                {" · "}
                <span className={`review-badge review-badge-${badgeTone}`}>
                  {moveReadout(current)}
                  {badge ? ` ${badge}` : ""}
                </span>
              </>
            )}
          </div>

          <button type="button" className="review-btn-outline is-sm" onClick={openCoachDrawer}>
            Ask AI ⌘K
          </button>
        </div>
      </div>

      {firstDrillable && (
        <p className="review-instrument-foot">
          <span className="review-instrument-kicker">
            {timeControl ? `Replay drill arena · ${timeControl}` : "Replay drill arena"}
          </span>
          <a href="#drills">Fix the first flagged mistake on the board ↓</a>
        </p>
      )}
    </aside>
  );
}
