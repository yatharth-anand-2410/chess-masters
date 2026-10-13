import { API_BASE } from "./api";
import { ensureBackendAwake, markBackendAwake } from "./backend-wake";
import { createClient } from "./supabase-client";

/**
 * Backend verdict for one drill attempt.
 *
 * `validated` is the field that matters: when it is false the engine could not
 * check the move, so the caller must fall back to its own exact-match test
 * rather than trusting `reasonable`.
 */
export type AttemptEvaluation = {
  reasonable: boolean;
  validated: boolean;
  played_san: string | null;
  played_eval_pawns: number | null;
  best_san: string | null;
  best_eval_pawns: number | null;
  delta_from_best: number | null;
  delta_from_before: number | null;
  reason: string;
};

export type AttemptRequest = {
  analysisId?: string | null;
  fen: string;
  played: string;
  evalBeforePawns?: number | null;
};

/**
 * Ask the backend to grade a legal move with Stockfish.
 *
 * Returns `null` whenever validation is impossible — no signed-in session, no
 * analysis to authorise against, a network failure or a non-2xx response. The
 * board treats `null` as "unavailable" and keeps its old exact-match behaviour;
 * it never marks the player wrong just because the engine could not answer.
 *
 * The free-tier backend may be asleep when the player makes a move, so the wait
 * for its health endpoint is what the drill already labels "Checking with the
 * engine…": grading a move should look slow, never broken.
 */
export async function evaluateAttempt(
  request: AttemptRequest
): Promise<AttemptEvaluation | null> {
  const { analysisId, fen, played, evalBeforePawns } = request;
  if (!analysisId || !fen || !played) {
    return null;
  }

  let token = "";
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? "";
  } catch {
    return null;
  }
  if (!token) {
    return null;
  }

  if (!(await ensureBackendAwake())) {
    return null;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/analyses/${analysisId}/attempt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fen,
          played,
          eval_before_pawns: evalBeforePawns ?? null,
        }),
      }
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as AttemptEvaluation;
    if (!payload || typeof payload.validated !== "boolean") {
      return null;
    }
    markBackendAwake();
    return payload;
  } catch {
    return null;
  }
}
