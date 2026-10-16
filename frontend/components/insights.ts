export type BoardArrow = {
  orig: string;
  dest?: string;
  color?: string;
};

export type Blindspot = {
  type: string;
  theme: string;
  expected_recapture: string;
  actual_move: string;
  is_check: boolean;
  confidence: string;
  explanation: string;
};

export type OpeningMove = {
  san?: string;
  games: number;
  win_rate: number;
  draw_rate: number;
  loss_rate: number;
  popularity: number;
};

export type OpeningInsight = {
  name?: string | null;
  eco?: string | null;
  top_moves: OpeningMove[];
  total_master_games: number;
};

export type TablebaseInsight = {
  category: string;
  dtm?: number | null;
  dtz?: number | null;
  pieces: number;
  best_move?: {
    uci?: string;
    san?: string;
    category?: string;
    dtm?: number | null;
    dtz?: number | null;
  } | null;
  outcome_changed?: {
    from: string;
    to: string;
  } | null;
};

/**
 * The move the player made immediately after one of their own errors.
 *
 * Only present when the source carried clocks, and it is the reply that
 * `post_error_rush` describes.
 */
export type FollowingMove = {
  san: string;
  seconds_spent?: number;
};

export type InsightMoment = {
  move_number: number;
  san: string;
  color: string;
  phase: string;
  quality: string;
  centipawn_loss: number;
  fen_before: string;
  played_move?: string;
  player_color?: "white" | "black";
  /**
   * Clock evidence for this move. The key names mirror
   * `backend/services/analyzer.py::_moment_evidence` verbatim.
   *
   * Each key is omitted entirely when the game carried no clock (most Chess.com
   * games, some Lichess games), so an absent field means "no data" and must
   * render as nothing rather than as a zero or a placeholder.
   */
  player_seconds_spent?: number | null;
  /** The player's remaining clock after this move, in seconds. */
  player_clock_remaining?: number | null;
  next_move?: FollowingMove | null;
  /** True when the reply above was played at or below the rushed-move threshold. */
  post_error_rush?: boolean;
  /**
   * Interchange aliases for the two readings above. `_attach_clock_context` in
   * `backend/services/recommendations.py` projects the same per-move facts onto
   * the stored moments under these names, so both payload shapes are accepted
   * and render identically. The `player_*` keys win when both are present.
   */
  seconds_spent?: number | null;
  clock_remaining?: number | null;
  /** White-perspective evaluation (in pawns) before the mistake. */
  eval_before_pawns?: number | null;
  best_move_san?: string | null;
  motif?: string | null;
  motif_details?: string | null;
  resource_theme?: string | null;
  note?: string | null;
  /**
   * The weakness-only lesson fields. They are no longer concatenated into
   * `note` (the card face is a single sentence), but they are still stored and
   * `mechanism` is rendered inside the "Deeper analysis" disclosure.
   */
  mechanism?: string | null;
  observed?: string | null;
  rule?: string | null;
  better_move_idea?: string | null;
  highlight_squares?: string[];
  arrows?: BoardArrow[];
  blindspot?: Blindspot | null;
  opening?: OpeningInsight | null;
  tablebase?: TablebaseInsight | null;
  game_label?: string | null;
  analysis_id?: string | null;
};

export type PhaseAccuracies = {
  opening?: number | null;
  middlegame?: number | null;
  endgame?: number | null;
};

export type QualityStatistics = {
  blunder?: number;
  mistake?: number;
  inaccuracy?: number;
};

export type Resource = {
  title: string;
  url: string;
  theme: string;
  source_move?: string | null;
};

export type PsychologyTag = "strong" | "develop" | "weak";

export type PsychologyDimension = {
  key?: string;
  label: string;
  short_label?: string;
  score: number;
  tag?: PsychologyTag;
  evidence: string;
};

export type PsychologyLeak = {
  key?: string;
  label: string;
  score: number;
  tag?: string;
  severity: "high" | "medium" | string;
  evidence: string;
  fix: string;
};

export type PsychologyFormPoint = {
  label?: string | null;
  accuracy: number;
  score?: number | null;
  after_loss?: boolean;
};

export type PsychologyPressureBucket = {
  bucket: string;
  moves: number;
  blunders: number;
  rate: number;
};

export type PsychologySpeedBucket = {
  bucket: string;
  moves: number;
};

export type PlayerTypeScores = {
  activist?: number;
  pragmatist?: number;
  theorist?: number;
  reflector?: number;
};

export type PsychologyProfile = {
  sample_size: number;
  headline?: string | null;
  player_type?: string | null;
  player_type_label?: string | null;
  player_type_confidence?: string | null;
  type_scores?: PlayerTypeScores;
  dimension_order?: string[];
  dimensions?: Record<string, PsychologyDimension | null>;
  leaks?: PsychologyLeak[];
  form?: PsychologyFormPoint[];
  time_pressure?: PsychologyPressureBucket[];
  speed_profile?: PsychologySpeedBucket[];
  type_evidence?: string[];
  evidence?: string[];
  caveats?: string[];
};

export function isPsychologyProfile(
  value: unknown
): value is PsychologyProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const profile = value as Partial<PsychologyProfile>;
  if (typeof profile.sample_size !== "number") {
    return false;
  }
  return (
    (profile.dimensions !== undefined && profile.dimensions !== null) ||
    (profile.type_scores !== undefined && profile.type_scores !== null) ||
    typeof profile.headline === "string"
  );
}

/**
 * `insights.verdict` — the personalized one-liner extracted from the report's
 * `## Verdict` section. Absent on every report captured before the rollout, so
 * consumers must treat it as optional and never fabricate a replacement.
 */
export type ReportVerdict = {
  line: string;
  detail?: string | null;
  source?: string | null;
};

export type InsightsData = {
  strength_moments: InsightMoment[];
  weakness_moments: InsightMoment[];
  resources: Resource[];
  player_color?: string;
  player_name?: string;
  opening_name?: string | null;
  eco?: string | null;
  result?: string | null;
  phase_accuracies?: PhaseAccuracies;
  statistics?: QualityStatistics;
  psychology?: PsychologyProfile | null;
  verdict?: ReportVerdict | null;
};