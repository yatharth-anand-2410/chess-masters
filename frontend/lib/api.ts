export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Usage = {
  plan: "free" | "paid";
  analyses_used: number;
  free_analysis_limit: number;
  analyses_remaining: number | null;
  qna_enabled: boolean;
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

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
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
};
