"use client";

import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";

const NAJDORF_FEN =
  "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6";

const SHAPES: DrawShape[] = [
  { orig: "c3" as Key, dest: "d5" as Key, brush: "green" },
];

export default function HeroBoard() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!elementRef.current) {
      return;
    }
    apiRef.current = Chessground(elementRef.current, {
      viewOnly: true,
      coordinates: false,
      fen: NAJDORF_FEN,
      orientation: "white",
      animation: { enabled: false },
      highlight: { lastMove: false, check: false },
      drawable: { enabled: false, visible: true, autoShapes: SHAPES },
    });
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, []);

  return <div className="hero-board" ref={elementRef} />;
}
