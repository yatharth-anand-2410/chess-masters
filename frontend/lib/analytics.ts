/**
 * Dependency-free product telemetry for Chessmasters.
 *
 * The product spec requires measuring four things: report completion, practice
 * attempts, repeat visits, and subsequent training performance. This module is
 * the whole event layer for those metrics — no vendor SDK, no new package.
 *
 * ── Transport (placeholder, deliberate) ─────────────────────────────────────
 * The backend has no ingestion endpoint and this task must not invent one, so
 * the transport is PLUGGABLE and defaults to a no-op sink that only logs in
 * development. `setAnalyticsTransport` swaps it in one line once a real
 * destination exists (e.g. `setAnalyticsTransport(createBeaconTransport("/api/telemetry"))`).
 * There is no endpoint in `lib/api.ts` or the Supabase client that accepts these
 * events today, so nothing is wired to one.
 *
 * ── What is collected ───────────────────────────────────────────────────────
 * Only coarse, non-identifying properties: event name, platform ("lichess" /
 * "chess.com"), booleans/flags, counts, drill index, phase, motif, duration in
 * ms, and a random per-tab session id plus a repeat-visit counter.
 *
 * What is NOT collected: PGN, FEN, game URLs, usernames, email addresses,
 * Supabase user or access-token ids, or any other user identifier. Drill
 * attempts record only the outcome and the engine's verdict, never the move.
 *
 * ── Privacy controls ────────────────────────────────────────────────────────
 * If `navigator.doNotTrack` ("1"/"yes") or `navigator.globalPrivacyControl` is
 * set, tracking is disabled entirely: nothing is queued, sent, or stored.
 *
 * ── Delivery guarantees ─────────────────────────────────────────────────────
 * Events are QUEUED and delivered in batches — never one request per event.
 * A batch flushes when it reaches `FLUSH_THRESHOLD`, after a short idle timer,
 * or immediately on `visibilitychange`/`pagehide`, where a transport that
 * supports it is asked to hand off via `navigator.sendBeacon` so closing the
 * tab does not drop events. Every public entry point is wrapped so telemetry
 * can never throw into the UI.
 */

export type AnalyticsEventName =
  | "app_open"
  | "analysis_complete"
  | "analysis_blocked"
  | "drill_opened"
  | "drill_attempt"
  | "drill_outcome"
  | "training_link_click";

/** Paid-conversion gates already handled by the dashboard. */
export type AnalysisBlockCode =
  | "guest_limit"
  | "upgrade_required"
  | "limit_reached"
  | "insufficient_credits";

export type DrillOutcome = "solved" | "revealed" | "wrong";

/** Event name → allowed properties. Typos and wrong shapes fail at compile time. */
export type AnalyticsEventProps = {
  app_open: {
    /** Persisted count of distinct tab sessions; 1 on the first ever visit. */
    visits: number;
  };
  analysis_complete: {
    platform: string;
    isBatch: boolean;
    gameCount: number;
    success: boolean;
    /** Request start → terminal `done`/`error` event, in milliseconds. */
    durationMs: number;
    signedIn: boolean;
  };
  analysis_blocked: {
    code: AnalysisBlockCode;
    isBatch: boolean;
    signedIn: boolean;
  };
  drill_opened: {
    index: number;
    phase: string;
    motif: string | null;
  };
  drill_attempt: {
    attemptNumber: number;
    phase: string;
    motif: string | null;
    correct: boolean;
    /** True when Stockfish actually graded the move on the backend. */
    engineValidated: boolean;
    /** True when a non-exact move was accepted within the 0.5-pawn tolerance. */
    acceptedAsAlternative: boolean;
  };
  drill_outcome: {
    index: number;
    outcome: DrillOutcome;
    attempts: number;
  };
  /**
   * Proxy metric only: we cannot see Lichess training results, so we measure the
   * outbound "Practise this theme" click and treat it as intent, not performance.
   * The real training-performance signal would have to come from Lichess.
   */
  training_link_click: {
    index: number;
    kind: "theme" | "mixed";
  };
};

export type AnalyticsPrimitive = string | number | boolean | null;

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  properties: Record<string, AnalyticsPrimitive>;
  sessionId: string;
  ts: number;
};

export type AnalyticsTransport = {
  /** In-page delivery for a full batch. Must not throw. */
  send: (batch: AnalyticsEvent[]) => void;
  /**
   * Optional last-chance delivery while the page unloads. Return `true` when the
   * batch was handed off (e.g. `navigator.sendBeacon`); returning `false` makes
   * the caller fall back to `send`.
   */
  beacon?: (batch: AnalyticsEvent[]) => boolean;
};

const VISITS_KEY = "cm_visits";
const SESSION_KEY = "cm_session_id";
const VISIT_COUNTED_KEY = "cm_visit_counted";
const FLUSH_THRESHOLD = 10;
const IDLE_FLUSH_MS = 4000;

const isDev = process.env.NODE_ENV !== "production";

function debugWarn(message: string, error: unknown): void {
  if (isDev) {
    console.warn(`[analytics] ${message}`, error);
  }
}

/**
 * Default sink. It is intentionally inert: a placeholder so the events and their
 * call sites can ship now and the destination can be swapped later with one line.
 */
const placeholderTransport: AnalyticsTransport = {
  send: (batch) => {
    if (isDev) {
      console.debug("[analytics] placeholder sink (no destination configured)", batch);
    }
  },
};

let transport: AnalyticsTransport = placeholderTransport;
let queue: AnalyticsEvent[] = [];
let idleTimer: number | null = null;
let initialized = false;
let listenersBound = false;
let sessionId = "";
let visits = 0;

/** Replace the destination (the one-line swap when a real endpoint exists). */
export function setAnalyticsTransport(next: AnalyticsTransport): void {
  transport = next;
}

/**
 * A transport that POSTs batches and hands off with `navigator.sendBeacon` on
 * page unload. Not wired to anything yet — no ingestion endpoint exists.
 */
export function createBeaconTransport(endpoint: string): AnalyticsTransport {
  return {
    send: (batch) => {
      try {
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
          keepalive: true,
        }).catch(() => undefined);
      } catch (error) {
        debugWarn("transport send failed", error);
      }
    },
    beacon: (batch) => {
      try {
        const blob = new Blob([JSON.stringify(batch)], {
          type: "application/json",
        });
        return navigator.sendBeacon(endpoint, blob);
      } catch (error) {
        debugWarn("sendBeacon failed", error);
        return false;
      }
    },
  };
}

/**
 * Do Not Track / Global Privacy Control. When either is set we collect nothing:
 * no queueing, no storage, no network.
 */
function trackingDisabled(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  const doNotTrack = navigator.doNotTrack;
  if (doNotTrack === "1" || doNotTrack === "yes") {
    return true;
  }
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true;
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the Math.random fallback
  }
  return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sanitize(
  properties: object | undefined
): Record<string, AnalyticsPrimitive> {
  const flat: Record<string, AnalyticsPrimitive> = {};
  if (!properties) {
    return flat;
  }
  for (const [key, value] of Object.entries(
    properties as Record<string, unknown>
  )) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      flat[key] = value;
    }
  }
  return flat;
}

/** Resolve the per-tab session id and bump the persisted visit count once. */
function readSession(): void {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      sessionId = existing;
    }
  } catch {
    // sessionStorage can throw (Safari private mode); fall back to memory.
  }
  if (!sessionId) {
    sessionId = randomId();
    try {
      window.sessionStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      // ignore storage errors
    }
  }

  let counted = false;
  try {
    counted = window.sessionStorage.getItem(VISIT_COUNTED_KEY) === "1";
  } catch {
    counted = false;
  }

  try {
    const stored = Number.parseInt(
      window.localStorage.getItem(VISITS_KEY) ?? "0",
      10
    );
    visits = Number.isFinite(stored) && stored > 0 ? stored : 0;
    if (!counted) {
      visits += 1;
      window.localStorage.setItem(VISITS_KEY, String(visits));
    }
  } catch {
    // localStorage unavailable: count this page view in memory only.
    if (!counted) {
      visits += 1;
    }
  }

  if (!counted) {
    try {
      window.sessionStorage.setItem(VISIT_COUNTED_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }
}

function bindLifecycleListeners(): void {
  if (listenersBound || typeof window === "undefined") {
    return;
  }
  listenersBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushAnalytics({ unloading: true });
    }
  });
  window.addEventListener("pagehide", () => {
    flushAnalytics({ unloading: true });
  });
}

function deliver(batch: AnalyticsEvent[], unloading: boolean): void {
  try {
    if (unloading && transport.beacon) {
      if (transport.beacon(batch)) {
        return;
      }
    }
    transport.send(batch);
  } catch (error) {
    debugWarn("delivery failed", error);
  }
}

/**
 * Idempotent: safe to call from every mount (and React StrictMode's double
 * effect). The second call is a no-op, so `app_open` and the visit counter only
 * fire once per tab session.
 */
export function initAnalytics(): void {
  try {
    if (initialized) {
      return;
    }
    initialized = true;
    if (trackingDisabled() || typeof window === "undefined") {
      return;
    }
    readSession();
    bindLifecycleListeners();
    trackEvent("app_open", { visits });
  } catch (error) {
    debugWarn("initAnalytics failed", error);
  }
}

function scheduleIdleFlush(): void {
  if (idleTimer !== null || typeof window === "undefined") {
    return;
  }
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    flushAnalytics();
  }, IDLE_FLUSH_MS);
}

/** Send whatever is queued right now. `unloading` enables the beacon path. */
export function flushAnalytics(options?: { unloading?: boolean }): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (queue.length === 0) {
      return;
    }
    const batch = queue;
    queue = [];
    deliver(batch, options?.unloading === true);
  } catch (error) {
    debugWarn("flush failed", error);
  }
}

/**
 * Record one event. Never throws: on any failure it logs in development and
 * returns, so a telemetry bug cannot break the UI.
 */
export function trackEvent<N extends AnalyticsEventName>(
  name: N,
  properties?: AnalyticsEventProps[N]
): void {
  try {
    if (trackingDisabled() || typeof window === "undefined") {
      return;
    }
    if (!initialized) {
      initAnalytics();
    }
    queue.push({
      name,
      properties: sanitize(properties),
      sessionId,
      ts: Date.now(),
    });
    if (queue.length >= FLUSH_THRESHOLD) {
      flushAnalytics();
    } else {
      scheduleIdleFlush();
    }
  } catch (error) {
    debugWarn("trackEvent failed", error);
  }
}
