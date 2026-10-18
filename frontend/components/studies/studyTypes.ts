/**
 * Study payload shapes and helpers shared by /study/[id] and /s/[token].
 *
 * `GET /api/studies/import/{study_id}` is served by
 * `backend/services/studies.py::StudyImportResponse`. The frontend mirrors only
 * the fields it renders rather than importing the Pydantic schema, so a backend
 * field rename cannot break the page — the shape below is the honest minimum.
 */

import { Chess } from "chess.js";
import type { InsightMoment } from "../insights";

export type StudyMoveNode = {
  san: string;
  uci?: string;
  ply?: number;
  fen?: string;
  comment?: string | null;
  glyphs?: string[];
  engine_eval?: string | null;
  circles?: unknown[];
  arrows?: unknown[];
  variations?: StudyMoveNode[];
};

export type StudyCircle = {
  color: string;
  square: string;
};

export type StudyArrow = {
  color: string;
  from_square: string;
  to_square: string;
};

export type StudyChapter = {
  id: string;
  title: string;
  orientation?: string;
  initial_fen: string;
  moves_tree?: StudyMoveNode[];
  total_moves?: number;
  tags?: Record<string, string>;
  /** The author's lesson written on the chapter's starting position. */
  initial_comment?: string | null;
  /** Board markers the author drew on the starting position. */
  initial_circles?: StudyCircle[];
  initial_arrows?: StudyArrow[];
  /** Deep link to this one chapter on Lichess. */
  chapter_url?: string | null;
};

export type StudyImport = {
  study_id: string;
  study_title: string;
  source_url: string;
  chapter_count: number;
  chapters?: StudyChapter[];
  total_annotations?: number;
  /** The Lichess account the study belongs to. */
  annotator?: string | null;
  /** Chapters that store a position and no moves. */
  position_only_chapters?: number;
  /** "lichess" or "cache" — the backend's own read path. */
  source?: string;
};

/**
 * True for a chapter that is a diagram, not a line.
 *
 * Most of a coach's library is built this way: a position, a chapter name and
 * sometimes a written lesson, with no moves stored at all. There is no solution
 * to check, so these must never be rendered as a drill with a hidden answer.
 */
export function isPositionChapter(
  chapter: StudyChapter | null | undefined
): boolean {
  if (!chapter) {
    return false;
  }
  const plies = chapter.total_moves ?? 0;
  const nodes = chapter.moves_tree?.length ?? 0;
  return plies === 0 && nodes === 0;
}

/** One main-line ply, positioned so it can be drilled on a real board. */
export type StudyPly = {
  /** SAN as written in the study PGN. */
  san: string;
  /** The position the ply is played from — the drill's starting position. */
  fenBefore: string;
  moveNumber: number;
  color: "white" | "black";
  /** The study author's own comment; absent when the move is unannotated. */
  note?: string | null;
  glyphs: string[];
};

const MAX_PLIES = 120;

/**
 * Walk the chapter's main line (first variation at every node) and record the
 * position before each move.
 *
 * Anything chess.js rejects ends the walk rather than throwing: a partially
 * replayable chapter is still worth showing, and the move list carries the SAN
 * the author wrote even when a position cannot be rebuilt.
 */
export function buildMainLine(chapter: StudyChapter | null | undefined): StudyPly[] {
  const plies: StudyPly[] = [];
  if (!chapter) {
    return plies;
  }

  let game: Chess;
  try {
    game = new Chess(chapter.initial_fen || undefined);
  } catch {
    return plies;
  }

  let node: StudyMoveNode | undefined = chapter.moves_tree?.[0];
  while (node && plies.length < MAX_PLIES) {
    const fenBefore = game.fen();
    plies.push({
      san: node.san,
      fenBefore,
      moveNumber: game.moveNumber(),
      color: game.turn() === "b" ? "black" : "white",
      note: typeof node.comment === "string" && node.comment.trim() ? node.comment : null,
      glyphs: Array.isArray(node.glyphs) ? node.glyphs : [],
    });
    try {
      const played = game.move(node.san);
      if (!played) {
        break;
      }
    } catch {
      break;
    }
    node = node.variations?.[0];
  }

  return plies;
}

/** A drillable moment for `DrillBoard`: find the study's move from this position. */
export function plyToMoment(ply: StudyPly, motif?: string | null): InsightMoment {
  return {
    move_number: ply.moveNumber,
    san: ply.san,
    color: ply.color,
    // `phase`/`quality` only travel to analytics from DrillBoard; "study" marks
    // the provenance of the attempt instead of claiming a game phase.
    phase: "study",
    quality: "study",
    centipawn_loss: 0,
    fen_before: ply.fenBefore,
    best_move_san: ply.san,
    motif: motif ?? null,
    highlight_squares: [],
  };
}

/** Number the main line: `1. e4 e5 2. Nf3 …` (Black starts a full move too). */
export function formatMoveLine(plies: StudyPly[]): string {
  const parts: string[] = [];
  plies.forEach((ply, index) => {
    if (ply.color === "white") {
      parts.push(`${ply.moveNumber}.${ply.san}`);
    } else if (index === 0) {
      parts.push(`${ply.moveNumber}...${ply.san}`);
    } else {
      parts.push(ply.san);
    }
  });
  return parts.join(" ");
}

/** `%csl` circles arrive as free-form strings — normalise and cap the display. */
export function circleLabels(circles: string[] | undefined): string[] {
  if (!Array.isArray(circles)) {
    return [];
  }
  return circles
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .slice(0, 12);
}

export function chapterMoveCount(chapter: StudyChapter): number {
  if (typeof chapter.total_moves === "number" && chapter.total_moves > 0) {
    return chapter.total_moves;
  }
  return buildMainLine(chapter).length;
}
