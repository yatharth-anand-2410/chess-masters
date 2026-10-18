export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Usage = {
  plan: "free" | "paid";
  /** Subscription tier: "free" | "student" (Pro Student) | "coach" (Master Coach). */
  plan_tier?: "free" | "student" | "coach";
  analyses_used: number;
  free_analysis_limit: number;
  paid_analysis_limit: number;
  analyses_remaining: number;
  qna_enabled: boolean;
  total_games_analyzed: number;
  subscription_status?: string;
  current_period_end?: string | null;
};

export type ApiErrorDetail = {
  code?: string;
  message?: string;
  feature?: string;
};

export class ApiUpgradeError extends Error {
  code: string;
  feature?: string;

  constructor(detail: ApiErrorDetail) {
    super(detail.message ?? "Upgrade required");
    this.name = "ApiUpgradeError";
    this.code = detail.code ?? "upgrade_required";
    this.feature = detail.feature;
  }
}

export function isUpgradeError(err: unknown): err is ApiUpgradeError {
  return err instanceof ApiUpgradeError;
}

async function parseErrorResponse(response: Response): Promise<never> {
  let detail: string | ApiErrorDetail | undefined;
  try {
    const body = await response.json();
    detail = body?.detail;
  } catch {
    // ignore
  }
  if (typeof detail === "object" && detail !== null) {
    throw new ApiUpgradeError(detail as ApiErrorDetail);
  }
  throw new Error(typeof detail === "string" ? detail : `Request failed (${response.status})`);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  return response.json() as Promise<T>;
}

async function apiSend<T>(
  path: string,
  token: string,
  method: "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function apiPut<T>(path: string, token: string, body: unknown): Promise<T> {
  return apiSend<T>(path, token, "PUT", body);
}

export function apiPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  return apiSend<T>(path, token, "PATCH", body);
}

export function apiDelete<T>(path: string, token: string): Promise<T> {
  return apiSend<T>(path, token, "DELETE");
}

export type SpeedBucket =
  | "bullet"
  | "blitz"
  | "rapid"
  | "classical"
  | "correspondence"
  | "unknown";

/** Compact per-game telemetry captured at analysis time (analyses.game_summary). */
export type GameSummary = {
  speed?: SpeedBucket | null;
  time_control?: string | null;
  username?: string | null;
  platform?: string | null;
  player_elo?: number | null;
  opponent_name?: string | null;
  opponent_elo?: number | null;
  accuracy?: number | null;
  phase_accuracies?: {
    opening?: number | null;
    middlegame?: number | null;
    endgame?: number | null;
  } | null;
  quality?: { blunder?: number; mistake?: number; inaccuracy?: number } | null;
  psychology?: Record<string, unknown> | null;
};

export type AnalysisSummary = {
  id: string;
  platform: string;
  game_id: string;
  game_url: string;
  username?: string | null;
  player_color: string;
  player_name?: string | null;
  opening_name?: string | null;
  eco?: string | null;
  result?: string | null;
  status: string;
  error_message?: string | null;
  created_at: string;
  report_markdown?: string | null;
  insights?: unknown;
  /** Per-game telemetry (null for analyses created before the capture rollout). */
  game_summary?: GameSummary | null;
  /** True when GET /api/analyses/{id}/replay can serve a move-by-move replay. */
  replay_available?: boolean;
  batch_id?: string | null;
  /** Present when the analysis was run for a coach's student profile. */
  student?: { display_name?: string | null } | null;
};

/** One move in the replay payload served by GET /api/analyses/{id}/replay. */
export type ReplayMove = {
  ply: number;
  san: string;
  color: "white" | "black";
  /** Position AFTER the move. */
  fen: string;
  /** "brilliant" | "good" | "inaccuracy" | "mistake" | "blunder" | null */
  quality?: string | null;
  eval_after_pawns?: number | null;
  seconds_spent?: number | null;
  clock_remaining?: number | null;
};

export type AnalysisReplay = {
  analysis_id: string;
  moves: ReplayMove[];
  eval_curve_pawns: number[];
  players: {
    white?: { name?: string | null; elo?: number | null };
    black?: { name?: string | null; elo?: number | null };
  };
  player_color: "white" | "black";
  time_control?: string | null;
  speed?: SpeedBucket | null;
  result?: string | null;
  opening_name?: string | null;
};

/** One verdict bullet for the report hero (insights.verdict). */
export type ReportVerdict = {
  /** Personalized one-liner, e.g. "You were winning until move 28 — clock panic threw it away." */
  line: string;
  /** Optional concrete detail (move, clock, motif) rendered under the verdict. */
  detail?: string | null;
  source?: "report" | "psychology" | "moments";
};

export type BatchSummary = {
  id: string;
  platform: string;
  username?: string | null;
  game_count: number;
  report_markdown?: string | null;
  insights?: unknown;
  status: string;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type BatchDetail = {
  batch: BatchSummary;
  games: AnalysisSummary[];
};

export type HistoryEntry =
  | ({ kind: "game" } & AnalysisSummary)
  | ({ kind: "batch" } & BatchSummary);

export function mergeHistoryEntries(
  analyses: AnalysisSummary[],
  batches: BatchSummary[],
  limit?: number
): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...analyses.map((analysis) => ({ kind: "game" as const, ...analysis })),
    ...batches.map((batch) => ({ kind: "batch" as const, ...batch })),
  ];
  entries.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return typeof limit === "number" ? entries.slice(0, limit) : entries;
}

export type Review = {
  id: string;
  rating: number;
  comment?: string | null;
  display_name: string;
  created_at: string;
  updated_at?: string | null;
  is_mine?: boolean;
};

export type ReviewSummary = {
  average: number | null;
  count: number;
};

export type ReviewsResponse = {
  summary: ReviewSummary;
  reviews: Review[];
  mine: Review | null;
};

export type ReviewSubmissionResponse = {
  review: Review;
  summary: ReviewSummary;
};

export function externalGameUrl(
  analysis: Pick<AnalysisSummary, "platform" | "game_id" | "game_url">
): string {
  if (analysis.platform === "lichess") {
    return `https://lichess.org/${analysis.game_id}`;
  }
  if (analysis.game_url) {
    return analysis.game_url;
  }
  return `https://www.chess.com/game/live/${analysis.game_id}`;
}

// ---------------------------------------------------------------------------
// Coach mode
// ---------------------------------------------------------------------------

export type UserRole = "player" | "coach";

export type UserProfile = {
  /** Null until the one-time onboarding choice is made. */
  role: UserRole | null;
};

export type StudentSummary = {
  id: string;
  display_name: string;
  lichess_username?: string | null;
  chesscom_username?: string | null;
  /** Coach-private; never shown to students or on share pages. */
  notes?: string | null;
  analysis_count: number;
  last_analysis_at?: string | null;
  last_result?: string | null;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type ShareStatus = {
  active: boolean;
  token?: string;
  url_path?: string;
  created_at?: string | null;
  view_count?: number;
  last_viewed_at?: string | null;
};

export type StudentDetail = {
  student: StudentSummary;
  analyses: AnalysisSummary[];
  batches: BatchSummary[];
  share: ShareStatus;
};

export type SharedStudent = {
  student: {
    display_name?: string | null;
    lichess_username?: string | null;
    chesscom_username?: string | null;
  };
  analyses: Array<{
    id: string;
    platform: string;
    game_id: string;
    game_url: string;
    player_color: string;
    opening_name?: string | null;
    eco?: string | null;
    result?: string | null;
    created_at: string;
  }>;
  batches: Array<{
    id: string;
    platform: string;
    game_count: number;
    created_at: string;
  }>;
};

export type SharedReport = {
  student: SharedStudent["student"];
  analysis: SharedStudent["analyses"][number] & {
    player_name?: string | null;
    report_markdown?: string | null;
    insights?: unknown;
  };
};

export type SharedBatchReport = {
  student: SharedStudent["student"];
  batch: SharedStudent["batches"][number] & {
    report_markdown?: string | null;
    insights?: unknown;
  };
};

export function shareUrl(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  return `${window.location.origin}${path}`;
}

// ─── NEW EXPANDED CHESSMASTERS API CLIENTS ─────────────────────────────────

export type DrawClassification = {
  draw_type: "missed_win" | "heroic_fortress" | "premature_fear" | "standard_agreement" | "stalemate_swindle";
  verdict: string;
  eval_swings: Array<{ ply: number; eval: number }>;
  psychological_factor?: string;
  recommendation: string;
};

export type ScoutOpeningNode = {
  san: string;
  move_number: number;
  color: string;
  games_count: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  frequency_percent: number;
  eco?: string | null;
  opening_name?: string | null;
  children?: ScoutOpeningNode[];
};

export type ScoutPhaseBlunderRate = {
  phase: string;
  total_moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  blunder_rate_percent: number;
  acpl: number;
};

export type ScoutTimeTrouble = {
  moves_under_30s: number;
  blunders_under_30s: number;
  blunder_rate_under_30s: number;
  moves_normal: number;
  blunders_normal: number;
  blunder_rate_normal: number;
  vulnerability_multiplier: number;
  verdict: string;
  tactical_recommendation: string;
};

export type ScoutTacticalBlindspot = {
  motif: string;
  motif_label: string;
  occurrences: number;
  percentage_of_blunders: number;
  description: string;
};

/** GET /api/scout/{username} — the real scouting dossier payload. */
export type OpponentScoutDossier = {
  username: string;
  platform: string;
  games_analyzed: number;
  white_games_count: number;
  black_games_count: number;
  overall_win_rate: number;
  archetype: string;
  danger_level: string;
  white_repertoire_tree: ScoutOpeningNode[];
  black_repertoire_tree: ScoutOpeningNode[];
  phase_blunders: Record<string, ScoutPhaseBlunderRate>;
  time_trouble: ScoutTimeTrouble;
  tactical_blindspots: ScoutTacticalBlindspot[];
  anti_prep_recommendations: string[];
};

export type CopilotQueryResponse = {
  answer: string;
  turning_point_ply?: number;
  prescribed_practice?: string;
  suggested_action?: string;
};

export async function classifyDraw(pgn: string, color?: string): Promise<DrawClassification> {
  const res = await fetch(`${API_BASE}/api/draws/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pgn, color }),
  });
  if (!res.ok) throw new Error("Draw classification failed");
  return res.json();
}

/**
 * Import a Lichess study for the in-app viewer.
 *
 * The payload is whatever `backend/services/studies.py::StudyImportResponse`
 * returns; callers name the shape they render (see components/studies/
 * studyTypes.ts) rather than this layer duplicating the Pydantic schema.
 *
 * Curated studies are private, so the read needs the session token: the
 * backend answers 401 without one and 402 when the caller's tier has not
 * unlocked that study. Both arrive as typed errors so the page can say what
 * actually happened instead of "study not found".
 */
export async function importStudy<T>(
  studyId: string,
  token?: string,
  options?: { fresh?: boolean }
): Promise<T> {
  const query = options?.fresh ? "?fresh=true" : "";
  return apiGet<T>(
    `/api/studies/import/${encodeURIComponent(studyId)}${query}`,
    token
  );
}

export async function scoutOpponent(username: string, platform: string = "lichess"): Promise<OpponentScoutDossier> {
  return apiGet<OpponentScoutDossier>(`/api/scout/${encodeURIComponent(username)}?platform=${platform}`);
}

export async function queryCopilot(query: string, studentId?: string, gameId?: string): Promise<CopilotQueryResponse> {
  const res = await fetch(`${API_BASE}/api/copilot/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, student_id: studentId, game_id: gameId }),
  });
  if (!res.ok) throw new Error("AI Copilot query failed");
  return res.json();
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CONTRACTS ADDED FOR THE SHOWCASE ALIGNMENT
 * Every workstream (progress, students, subscription, studies/tactics, shares)
 * codes against these shapes. Backend: services/progress.py, billing.py,
 * puzzles.py, studies.py, coach.py + main.py routes.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A tracked account discovered from the analyzed games. */
export type TrackedAccount = {
  platform: "lichess" | "chess.com" | string;
  username: string;
  games: number;
  rating?: number | null;
};

export type ProgressFilter = {
  /** Empty/undefined = all speeds. */
  speeds?: SpeedBucket[];
  /** Window in days (empty/undefined = all time). */
  days?: number | null;
};

export type ProgressSeriesPoint = {
  date: string;
  game_id?: string | null;
  result?: "win" | "loss" | "draw" | null;
  speed?: SpeedBucket | null;
  rating?: number | null;
  accuracy?: number | null;
  acpl?: number | null;
  opening?: number | null;
  middlegame?: number | null;
  endgame?: number | null;
};

export type ProgressMovementItem = {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  unit: string;
  direction: "up" | "down";
  /** Higher is better for this metric (renders the delta chip green/red). */
  higher_is_better: boolean;
  /** True when there were not enough games to compute honestly. */
  insufficient?: boolean;
};

export type ProgressPillarItem = {
  title: string;
  metric: string;
  detail: string;
  status: "mastered" | "improving" | "needs_work";
};

export type ProgressRootCause = {
  category: string;
  count: number;
  percentage: number;
  primary_motif: string;
  description: string;
};

export type ProgressRadarMetric = {
  dimension: string;
  baseline_score: number;
  current_score: number;
  delta: number;
};

export type ProgressPanicBucket = {
  bucket: string;
  label: string;
  blunders: number;
  games: number;
  percentage: number;
  worst?: boolean;
};

export type ProgressReport = {
  student_id: string;
  student_name: string;
  identity: {
    accounts: TrackedAccount[];
    total_games: number;
    filtered_games: number;
    speeds: SpeedBucket[];
    days: number | null;
  };
  elo: {
    starting: number;
    current: number;
    peak: number;
    net_gain: number;
    status: string;
    series: ProgressSeriesPoint[];
  };
  acpl: {
    baseline: number | null;
    recent: number | null;
    net_drift: number | null;
    direction: "sharpening" | "stable" | "decaying";
    series: ProgressSeriesPoint[];
  };
  accuracy: {
    baseline: number | null;
    current: number | null;
    series: ProgressSeriesPoint[];
  };
  phases: {
    opening: { baseline: number | null; current: number | null };
    middlegame: { baseline: number | null; current: number | null };
    endgame: { baseline: number | null; current: number | null };
    best_phase: string | null;
    lagging_phase: string | null;
    series: ProgressSeriesPoint[];
  };
  movement: ProgressMovementItem[];
  pillars: {
    improved: ProgressPillarItem[];
    improving: ProgressPillarItem[];
    needs_work: ProgressPillarItem[];
  };
  root_causes: ProgressRootCause[];
  radar: ProgressRadarMetric[];
  panic: ProgressPanicBucket[];
  persona: {
    archetype: string;
    summary_verdict: string;
    strength_badge: string;
    vulnerability_badge: string;
    next_milestone: string;
  };
  focus_rules: string[];
  /** Your recurring leaks, each answered by the coach's own study where one exists. */
  practice_plan?: PracticePlanItem[];
  games_used: number;
  /** True when fewer than 4 games match the filter — panels must show an honest empty state. */
  insufficient: boolean;
};

/** GET /api/billing/config */
export type BillingConfig = {
  key_id: string | null;
  currency: string;
  plans: {
    student: {
      id: "student";
      label: string;
      amount: number;
      plan_id: string | null;
      configured: boolean;
    };
    coach: {
      id: "coach";
      label: string;
      amount: number;
      plan_id: string | null;
      configured: boolean;
    };
  };
};

/** GET /api/tactics — the full training catalog (backend/data/puzzle_catalog.json). */
export type TacticLink = {
  theme: string;
  url: string;
};

export type TacticTheme = {
  key: string;
  label: string;
  description: string;
  motif_aliases: string[];
  links: TacticLink[];
  /** Present when the user's own games reference this motif. */
  observed_count?: number;
  /** The coach's own study for this motif, when the library teaches it. */
  study?: {
    id: string;
    title: string;
    source_url: string;
    locked: boolean;
  };
};

export type TacticsCatalog = {
  themes: TacticTheme[];
  total_links: number;
  /** Present for a signed-in caller: the coach's curated study library. */
  library?: StudyLibrary;
};

/** GET /api/studies/library — the coach's curated Lichess study library. */
export type StudyGroupKind = "lichess" | "coach" | "unfiled";

export type StudyGroup = {
  key: string;
  label: string;
  description: string;
  kind: StudyGroupKind;
  /** A real lichess.org/training/<slug> link; null for a coach-made group. */
  training_url: string | null;
  count: number;
  order?: number;
  /** How often this motif appeared in the caller's own analysed games. */
  observed_count?: number;
};

export type LibraryStudy = {
  id: string;
  title: string;
  group: string;
  group_label: string;
  group_kind: StudyGroupKind;
  source_url: string;
  updated_at: number | null;
  order: number;
  /** False when the live Lichess index did not return this study. */
  indexed: boolean;
  /** True when the caller's tier has not unlocked it. */
  locked: boolean;
};

export type StudyLibrary = {
  /** False when this deployment has no Lichess token: nothing private is readable. */
  configured: boolean;
  signed_in?: boolean;
  /**
   * True for the signed-out teaser on the public tactics page: the catalogue is
   * visible, every study is locked, and nothing here opens without a session.
   */
  preview?: boolean;
  owner: string | null;
  tier: string;
  free_limit: number;
  latest_study_update: number | null;
  total_studies: number;
  locked_count: number;
  unlocked_ids: string[];
  hidden_count: number;
  missing_from_index: string[];
  groups: StudyGroup[];
  studies: LibraryStudy[];
};

/** GET /api/studies/curated — personalized from the user's (or student's) leaks. */
export type CuratedStudy = {
  id: string;
  title: string;
  reason: string;
  source_url: string;
  chapters: number | null;
  motif?: string | null;
  /** e.g. "Fixes your move 28 blunder in Game vs Hikaru" */
  fixes?: string | null;
  game_id?: string | null;
  move_number?: number | null;
  /** The theme's own words and drill link, from the library vocabulary. */
  theme_label?: string | null;
  theme_description?: string | null;
  training_url?: string | null;
  /** How many studies in the coach's library teach this motif. */
  study_count?: number | null;
  locked_count?: number | null;
  /** Set when the coach's own library teaches this motif. */
  study_id?: string | null;
  study_title?: string | null;
  /** True when this caller's tier has not unlocked the study. */
  locked?: boolean | null;
};

/**
 * A recurring leak joined with the work that answers it (`/api/progress`).
 *
 * Derived at read time from the coach's library, so `studies` is empty for a
 * theme the library does not cover yet — the Lichess drill link still says what
 * to practise, and the gap says what to write next.
 */
export type PracticePlanItem = {
  theme: string;
  label: string;
  description: string;
  kind: "lichess" | "coach" | "unfiled" | string;
  training_url: string | null;
  observed_count: number;
  study_count: number;
  locked_count: number;
  studies: Array<{
    id: string;
    title: string;
    source_url: string;
    locked: boolean;
  }>;
};

/** Shared (no sign-in) study / tactic links created by a coach. */
export type SharedItem = {
  token: string;
  kind: "study" | "tactic";
  item_key: string;
  title: string;
  subtitle?: string | null;
  url?: string | null;
  student_id?: string | null;
  student_name?: string | null;
  view_count: number;
  created_at: string;
  revoked_at?: string | null;
};

export type ShareItemStatus = {
  token: string;
  url_path: string;
  view_count: number;
};

/** Item payload rendered by /s/{token} for kind=study|tactic shares. */
export type SharedItemPayload = {
  kind: "study" | "tactic" | "student";
  title?: string;
  subtitle?: string | null;
  url?: string | null;
  chapters?: Array<{ title: string; moves?: string; coach_note?: string }>;
  lines?: Array<{ moves: string; coach_commentary: string }>;
  circles?: string[];
  student?: SharedStudent["student"] | null;
  view_count?: number;
};
