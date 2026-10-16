/**
 * Pure parsing helpers backing the report micro-components.
 *
 * The coaching report is streamed Markdown written by Gemini, so every helper
 * here has to tolerate three shapes of input: the strict contract emitted by
 * current prompts, the older prose-only reports already stored in the database,
 * and anything in between. Nothing in this module may throw or drop content —
 * callers fall back to rendering the raw Markdown whenever a parse is unsure.
 *
 * This module intentionally imports no chess library: it stays cheap enough to
 * run on every render of the report, and the drill board loads its own engine
 * only when a player opens a drill.
 */

import type { InsightsData, InsightMoment, Resource } from "./insights";

export type Section = { heading: string; body: string };

/** Split a report into its `## ` headed sections, preserving order. */
export function splitSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", body: "" };
  for (const line of content.split("\n")) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (current.heading) {
        sections.push(current);
      }
      current = { heading: match[1].trim(), body: "" };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.heading) {
    sections.push(current);
  }
  return sections;
}

export function headingMatches(section: Section, ...needles: string[]): boolean {
  const heading = section.heading.toLowerCase();
  return needles.some((needle) => heading.includes(needle));
}

const CHART_TAG = /^\s*<(AccuracyChart|EvalChart)\b/i;
const THEME_LINE = /^\s*THEME\s*:/i;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Flatten the inline Markdown the coach emits into plain display text. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collect bullet items, joining soft-wrapped continuation lines. */
export function extractBullets(body: string): string[] {
  const bullets: string[] = [];
  let buffer: string | null = null;

  const flush = () => {
    if (buffer !== null) {
      const value = stripMarkdown(buffer);
      if (value) {
        bullets.push(value);
      }
      buffer = null;
    }
  };

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim() || CHART_TAG.test(line) || THEME_LINE.test(line)) {
      flush();
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      buffer = line.replace(BULLET, "");
      continue;
    }
    if (buffer !== null) {
      buffer += ` ${line.trim()}`;
    }
  }
  flush();

  return bullets;
}

export type FocusPair =
  | { kind: "pair"; dontText: string; doText: string; tier: "A" | "B" }
  | { kind: "labelled"; label: string; detail: string; tier: "C" }
  | { kind: "raw"; raw: string };

/** `Don't: <mistake>. Do: <fix>` — the strict contract. */
const EXPLICIT_PAIR =
  /^(?:don'?t|do not|avoid|stop)\s*:?\s*(.+?)\s*[.;—–-]\s*(?:do|instead|try)\s*:?\s*(.+)$/i;

/**
 * `<Concept>: <explanation>` — what the coach actually writes today, for
 * example "Control the Center: In the opening, prioritize moves like ...d5."
 *
 * Matched before the contrast heuristic on purpose: these bullets often contain
 * "rather than", which would otherwise be split into a lopsided pair that keeps
 * the label glued to the front of the "Do" half.
 */
const LABELLED = /^([A-Z][^:.]{2,44}):\s+(\S.*)$/;

/** `A rather than B` / `A instead of B` — the contrastive prose the prompt asks for. */
const CONTRAST = /\s+(?:rather than|instead of|and not|not)\s+/i;

/** Leading `Instead of B, A` phrasing. */
const LEADING_INSTEAD = /^instead of\s+(.+?)\s*,\s*(.+)$/i;

const MODAL =
  /^(?:you|black|white|the player|one)\s+(?:should|must|need to|needs to|want to|ought to|have to)\s+/i;
const LEADING_ARTICLE = /^(?:a|an|the)\s+/i;

const MIN_HALF_LENGTH = 12;
const MAX_HALF_LENGTH = 180;

function cleanHalf(value: string): string {
  return stripMarkdown(value)
    .replace(/^[.,;:—–\-\s]+/, "")
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

function accept(doText: string, dontText: string): { dontText: string; doText: string } | null {
  const do_ = capitalise(cleanHalf(doText).replace(MODAL, ""));
  const dont = capitalise(cleanHalf(dontText).replace(LEADING_ARTICLE, ""));
  if (do_.length < MIN_HALF_LENGTH || dont.length < MIN_HALF_LENGTH) {
    return null;
  }
  if (do_.length > MAX_HALF_LENGTH || dont.length > MAX_HALF_LENGTH) {
    return null;
  }
  return { dontText: dont, doText: do_ };
}

/**
 * Split one bullet into a presentable unit.
 *
 * `tier` records which strategy matched so parse reliability stays measurable:
 * "A" is the strict prompt contract, "C" is the labelled shape the coach
 * already writes today, and "B" is contrastive prose.
 */
function toPair(bullet: string): FocusPair {
  const text = bullet.trim();

  const explicit = text.match(EXPLICIT_PAIR);
  if (explicit) {
    const pair = accept(explicit[2], explicit[1]);
    if (pair) {
      return { kind: "pair", ...pair, tier: "A" };
    }
  }

  const labelled = text.match(LABELLED);
  if (labelled) {
    const label = labelled[1].trim();
    const detail = firstSentence(labelled[2]);
    if (label.length >= 3 && detail.length >= MIN_HALF_LENGTH) {
      return { kind: "labelled", label, detail, tier: "C" };
    }
  }

  const leading = text.match(LEADING_INSTEAD);
  if (leading) {
    const pair = accept(leading[2], leading[1]);
    if (pair) {
      return { kind: "pair", ...pair, tier: "B" };
    }
  }

  const parts = text.split(CONTRAST);
  if (parts.length === 2) {
    const pair = accept(parts[0], parts[1]);
    if (pair) {
      return { kind: "pair", ...pair, tier: "B" };
    }
  }

  return { kind: "raw", raw: text };
}

/**
 * Turn a Focus Areas body into up to `limit` readable units.
 * Falls back to the untouched bullet whenever a clean parse is not possible.
 */
export function parseFocusPairs(body: string, limit = 3): FocusPair[] {
  return extractBullets(body)
    .slice(0, limit)
    .map(toPair)
    .filter((item) => item.kind !== "raw" || item.raw.length > 0);
}

export type RuleSource = "rule-section" | "focus-areas" | "psychology";

export type NextGameRule = {
  rule: string;
  sourceLabel: string;
  source: RuleSource;
};

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function firstSentence(value: string): string {
  const text = stripMarkdown(value);
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : text).trim();
}

/**
 * Resolve the single rule for the hero card.
 *
 * Priority is quality-first: the dedicated section written for this game wins,
 * then the psychology fix protocol, then the opening Focus Areas bullet.
 */
export function resolveNextGameRule(
  sections: Section[],
  insights?: InsightsData | null
): NextGameRule | null {
  const ruleSection = sections.find((section) =>
    headingMatches(section, "next game rule", "next-game rule")
  );
  if (ruleSection) {
    const bullet = extractBullets(ruleSection.body)[0];
    const rule = firstSentence(bullet ?? ruleSection.body);
    if (rule.length >= MIN_HALF_LENGTH) {
      return { rule, sourceLabel: "From this game", source: "rule-section" };
    }
  }

  const leaks = insights?.psychology?.leaks ?? [];
  const ranked = [...leaks].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  );
  const fix = ranked[0]?.fix ? firstSentence(ranked[0].fix) : "";
  if (fix.length >= MIN_HALF_LENGTH) {
    const label = ranked[0]?.label;
    return {
      rule: fix,
      sourceLabel: label ? `Your ${label.toLowerCase()} fix protocol` : "Your fix protocol",
      source: "psychology",
    };
  }

  const focusSection = sections.find((section) =>
    headingMatches(section, "focus areas", "focus")
  );
  if (focusSection) {
    const sourceLabel = "From this game's focus areas";
    const first = parseFocusPairs(focusSection.body, 1)[0];
    if (first?.kind === "pair" && first.doText.length >= MIN_HALF_LENGTH) {
      // The "Do" half is the instruction, which is what a rule should be.
      return { rule: first.doText, sourceLabel, source: "focus-areas" };
    }
    if (first?.kind === "labelled" && first.detail.length >= MIN_HALF_LENGTH) {
      return { rule: first.detail, sourceLabel, source: "focus-areas" };
    }
    const bullet = extractBullets(focusSection.body)[0];
    if (bullet && bullet.length >= MIN_HALF_LENGTH) {
      return { rule: firstSentence(bullet), sourceLabel, source: "focus-areas" };
    }
  }

  return null;
}

export type Stakes = {
  label: string;
  tier: "severe" | "high" | "moderate" | "low";
};

/**
 * Describe what a mistake cost in plain chess terms.
 *
 * This deliberately measures *stakes*, not difficulty: centipawn loss says how
 * much an error cost, not how hard the correct move was to find. Labelling it
 * "difficulty" would invent a signal the engine does not provide.
 */
export function stakesFor(centipawnLoss: number): Stakes {
  const loss = Number.isFinite(centipawnLoss) ? centipawnLoss : 0;
  if (loss >= 600) {
    return { label: "Cost: the game", tier: "severe" };
  }
  if (loss >= 300) {
    return { label: "Cost: the advantage", tier: "high" };
  }
  if (loss >= 150) {
    return { label: "Cost: a pawn", tier: "moderate" };
  }
  return { label: "Cost: a small edge", tier: "low" };
}

export function phaseLabel(phase?: string | null): string {
  switch (phase) {
    case "opening":
      return "Opening";
    case "middlegame":
      return "Middlegame";
    case "endgame":
      return "Endgame";
    default:
      return phase ? capitalise(phase) : "";
  }
}

export function moveLabel(moment: InsightMoment): string {
  const separator = moment.color === "black" ? "..." : ".";
  return `${moment.move_number}${separator}${moment.san}`;
}

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export type Solution = { from: string; to: string; promotion?: string };

export function parseUci(value?: string | null): Solution | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(UCI_PATTERN);
  if (!match) {
    return null;
  }
  return {
    from: match[1].toLowerCase(),
    to: match[2].toLowerCase(),
    promotion: match[3]?.toLowerCase(),
  };
}

/**
 * The move the backend already resolved as UCI, stored on the green arrow.
 *
 * This module deliberately avoids importing a chess library so it stays pure
 * and cheap: the arrow is a plain string, and converting `best_move_san` is
 * left to the drill board, which loads its engine only when a drill is opened.
 */
export function arrowSolution(moment: InsightMoment): Solution | null {
  const green = (moment.arrows ?? []).find(
    (arrow) => arrow.color === "green" && arrow.orig && arrow.dest
  );
  if (!green?.dest) {
    return null;
  }
  return { from: green.orig.toLowerCase(), to: green.dest.toLowerCase() };
}

/** Whether the report holds enough to build a replayable drill for this move. */
export function isDrillable(moment: InsightMoment): boolean {
  if (!moment.fen_before) {
    return false;
  }
  return Boolean(moment.best_move_san) || arrowSolution(moment) !== null;
}

/** Match a drill back to the pre-built practice link for the same move. */
export function findResourceForMoment(
  resources: Resource[] | undefined,
  moment: InsightMoment
): Resource | undefined {
  if (!resources || resources.length === 0) {
    return undefined;
  }
  const san = moment.san.replace(/[^a-z0-9]/gi, "");
  const target = `${moment.move_number}${san}`.toLowerCase();
  return resources.find((resource) => {
    if (!resource.source_move) {
      return false;
    }
    const candidate = resource.source_move.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return candidate === target || (san.length >= 2 && candidate.endsWith(san));
  });
}

/* -------------------------------------------------------------------------- */
/* Verdict + hero evidence                                                     */
/* -------------------------------------------------------------------------- */

export type ResolvedVerdict = {
  line: string;
  detail: string | null;
  /** `insights` means the structured payload won; `report` means the section. */
  source: "insights" | "report";
};

/**
 * The personalized verdict line.
 *
 * New reports carry `insights.verdict`; older Markdown-only reports may still
 * have a `## Verdict` section. When neither exists this returns null so the
 * report renders nothing extra rather than an invented sentence.
 */
export function resolveVerdict(
  sections: Section[],
  insights?: InsightsData | null
): ResolvedVerdict | null {
  const raw = insights?.verdict ?? null;
  if (raw && typeof raw.line === "string") {
    const line = stripMarkdown(raw.line);
    if (line.length >= MIN_HALF_LENGTH) {
      return {
        line,
        detail: raw.detail ? stripMarkdown(raw.detail) : null,
        source: "insights",
      };
    }
  }

  const section = sections.find((candidate) => headingMatches(candidate, "verdict"));
  if (!section) {
    return null;
  }
  const bullet = extractBullets(section.body)[0];
  const line = firstSentence(bullet ?? section.body);
  if (line.length < MIN_HALF_LENGTH) {
    return null;
  }
  return { line, detail: null, source: "report" };
}

/** The conventional annotation suffix for a played move. */
export function qualitySuffix(quality?: string | null): string {
  switch (quality) {
    case "blunder":
      return "??";
    case "mistake":
      return "?";
    case "inaccuracy":
      return "?!";
    case "brilliant":
      return "!!";
    case "strong":
      return "!";
    default:
      return "";
  }
}

/** `28...Re8??` — move number, side separator, SAN and the quality mark. */
export function signedMoveLabel(moment: InsightMoment): string {
  return `${moveLabel(moment)}${qualitySuffix(moment.quality)}`;
}

/** `3:42`-style clock from a seconds value, or null when the value is unusable. */
export function formatClockSeconds(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * The concrete "why" paragraph behind the next-game rule.
 *
 * Assembled only from evidence the moment actually carried — move number,
 * clock remaining, the move played and the engine's stronger idea. Returns null
 * when there is nothing beyond the move itself, so the hero card omits the
 * paragraph instead of padding it out.
 */
export function heroWhy(moment?: InsightMoment | null): string | null {
  if (!moment) {
    return null;
  }
  const clock = formatClockSeconds(
    moment.player_clock_remaining ?? moment.clock_remaining
  );
  const best = moment.best_move_san?.trim() || null;
  const idea = moment.better_move_idea?.trim() || null;

  if (!clock && !best && !idea) {
    return null;
  }

  const played = signedMoveLabel(moment);
  const first = `You played ${played} on move ${moment.move_number}${
    clock ? `, with ${clock} left on your clock` : ""
  }.`;

  const parts = [first];
  if (best) {
    parts.push(
      `The engine's stronger idea was ${best}${idea ? ` — ${stripMarkdown(idea)}` : "."}`
    );
  } else if (idea) {
    parts.push(stripMarkdown(idea));
  }
  return parts.join(" ");
}

