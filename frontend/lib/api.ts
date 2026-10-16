export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Usage = {
  plan: "free" | "paid";
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
  batch_id?: string | null;
  /** Present when the analysis was run for a coach's student profile. */
  student?: { display_name?: string | null } | null;
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

export type LichessStudyImport = {
  study_id: string;
  name: string;
  chapters: Array<{
    id: string;
    name: string;
    fen: string;
    arrows: string[];
    circles: string[];
    coach_commentary: string;
  }>;
};

export type OpponentScoutDossier = {
  username: string;
  platform: string;
  rating_blitz?: number;
  rating_rapid?: number;
  tactical_leak_index: number;
  time_trouble_vulnerability: number;
  opening_repertoire: {
    white: Array<{ name: string; win_rate: number; count: number }>;
    black: Array<{ name: string; win_rate: number; count: number }>;
  };
  key_vulnerabilities: string[];
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

export async function importStudy(studyId: string): Promise<LichessStudyImport> {
  return apiGet<LichessStudyImport>(`/api/studies/import/${encodeURIComponent(studyId)}`);
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
