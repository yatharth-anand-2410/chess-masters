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

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  return response.json() as Promise<T>;
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
