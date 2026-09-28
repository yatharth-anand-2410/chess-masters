"use client";

import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import type { BoardArrow } from "./insights";

type CriticalPositionBoardProps = {
  fen: string;
  orientation: "white" | "black";
  highlightSquares?: string[];
  arrows?: BoardArrow[];
  lastMove?: [string, string];
};

function toKey(square: string): Key {
  return square as Key;
}

export default function CriticalPositionBoard({
  fen,
  orientation,
  highlightSquares = [],
  arrows = [],
  lastMove,
}: CriticalPositionBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!elementRef.current) {
      return;
    }
    apiRef.current = Chessground(elementRef.current, {
      viewOnly: true,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      fen,
      orientation,
      lastMove: lastMove
        ? [toKey(lastMove[0]), toKey(lastMove[1])]
        : undefined,
      highlight: { lastMove: true, check: false },
      drawable: { enabled: false, visible: true },
    });
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const shapes: DrawShape[] = arrows
      .filter((arrow) => arrow.orig)
      .map((arrow) => ({
        orig: toKey(arrow.orig),
        dest: arrow.dest ? toKey(arrow.dest) : undefined,
        brush: arrow.color ?? "green",
      }));
    const custom = new Map<Key, string>(
      highlightSquares.map((square) => [toKey(square), "cg-custom-highlight"])
    );
    api.set({
      fen,
      orientation,
      lastMove: lastMove
        ? [toKey(lastMove[0]), toKey(lastMove[1])]
        : undefined,
      highlight: { lastMove: true, check: false, custom },
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    });
  }, [fen, orientation, highlightSquares, arrows, lastMove]);

  return <div className="critical-board" ref={elementRef} />;
}