import { ensureBackendAwake, markBackendAwake } from "./backend-wake";

export type StreamEvent = {
  event: string;
  data: unknown;
};

export type StreamHandlers = {
  onEvent?: (eventName: string, data: unknown) => void;
  onError?: (message: string, code?: string, feature?: string) => void;
};

/** Shown while the free-tier container boots; callers render it as a status. */
const WAKING_MESSAGE = "Waking the analysis engine...";
const UNREACHABLE_MESSAGE =
  "The analysis server is still starting up. Please try again in a moment.";

/** Render's edge answers these when the service is booting or suspended. */
const EDGE_STATUSES = new Set([502, 503, 504]);

/**
 * Retry policy, exported so `npm run check:backend-wake` can exercise the slow
 * paths in milliseconds. Nothing else writes to it — the numbers here decide
 * whether a player can be charged twice, so they are pinned by a check script.
 */
export const STREAM_TIMING = {
  /** A network failure faster than this never reached the app: nothing was charged. */
  fastFailureMs: 5_000,
  /** One automatic retry, and only for failures that never reached the app. */
  maxAttempts: 2,
};

type PostOutcome =
  | { kind: "response"; response: Response }
  | { kind: "aborted" }
  | {
      kind: "failure";
      message: string;
      code?: string;
      feature?: string;
      /** True when the request never reached FastAPI, so retrying is free. */
      unreachable: boolean;
    };

/**
 * Send one POST and read the body of an error response.
 *
 * The distinction that matters: an error our app writes carries a `detail`
 * field, while a 502/503/504 from Render's edge does not. Only the latter is
 * safe to retry, because a request that never arrived cannot have consumed an
 * analysis credit.
 */
async function postOnce(
  url: string,
  token: string,
  body: unknown,
  signal?: AbortSignal
): Promise<PostOutcome> {
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return { kind: "aborted" };
    }
    return {
      kind: "failure",
      message: "Lost connection to the server.",
      unreachable: Date.now() - startedAt < STREAM_TIMING.fastFailureMs,
    };
  }

  // `x-render-origin-server` is set by Render's proxy once the request reaches
  // the container, so it proves the app is up even when it answers with an error.
  if (response.ok || response.headers.get("x-render-origin-server")) {
    markBackendAwake();
  }

  if (response.ok) {
    return { kind: "response", response };
  }

  let message = `Request failed (${response.status})`;
  let code: string | undefined;
  let feature: string | undefined;
  let hasDetail = false;
  try {
    const errorBody = await response.json();
    const detail = errorBody?.detail;
    if (typeof detail === "object" && detail !== null) {
      message = detail?.message ?? message;
      code = detail?.code;
      feature = detail?.feature;
      hasDetail = true;
    } else if (typeof detail === "string") {
      message = detail;
      hasDetail = true;
    } else if (detail !== undefined) {
      hasDetail = true;
    }
  } catch {
    // Edge failures answer with an HTML page, not our JSON error shape.
  }

  return {
    kind: "failure",
    message: String(message),
    code,
    feature,
    unreachable: EDGE_STATUSES.has(response.status) && !hasDetail,
  };
}

async function readStream(
  response: Response,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    handlers.onError?.("Server returned an empty response.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          }
        }
        if (dataLines.length === 0) {
          continue;
        }
        let parsed: unknown = dataLines.join("\n");
        try {
          parsed = JSON.parse(dataLines.join("\n"));
        } catch {
          // keep raw text
        }
        handlers.onEvent?.(eventName, parsed);
      }
    }
  } catch {
    if (signal?.aborted) {
      // Cancelled by the player — the backend refunds and marks the row.
      return;
    }
    // Past this point the request has been received and may have been charged,
    // so a dropped connection is reported rather than retried automatically.
    handlers.onError?.("Lost connection while streaming.");
  }
}

export async function streamPost(
  url: string,
  token: string,
  body: unknown,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const signal = options?.signal;
  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) {
      return;
    }
    // Wait for the container *before* sending a request that spends a credit:
    // the player sees a status instead of a dead tab, and the retry below stays
    // safe because an unanswered request never reached the app.
    const awake = await ensureBackendAwake(() =>
      handlers.onEvent?.("status_update", { message: WAKING_MESSAGE })
    );
    if (signal?.aborted) {
      return;
    }
    if (!awake) {
      handlers.onError?.(UNREACHABLE_MESSAGE, "backend_unreachable");
      return;
    }

    const outcome = await postOnce(url, token, body, signal);
    if (outcome.kind === "aborted") {
      return;
    }
    if (outcome.kind === "response") {
      await readStream(outcome.response, handlers, signal);
      return;
    }

    if (outcome.unreachable && attempt < STREAM_TIMING.maxAttempts) {
      // Nothing was charged: the edge refused it or the connection failed before
      // the container could start work. Try once more, after the boot completes.
      continue;
    }
    if (outcome.unreachable) {
      handlers.onError?.(UNREACHABLE_MESSAGE, "backend_unreachable");
      return;
    }
    handlers.onError?.(outcome.message, outcome.code, outcome.feature);
    return;
  }
}
