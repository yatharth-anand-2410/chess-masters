import { API_BASE } from "./api";

/**
 * Free-tier cold-start handling for the deployed backend.
 *
 * Render spins a free service down after ~15 minutes without traffic, and the
 * next request pays for the boot. Measured on the deployed API: 21.7s for the
 * first request after idle versus 0.6s warm. Two things keep that invisible:
 *
 *  - `warmBackend()` pings the health endpoint as soon as a visitor looks like
 *    they are about to need the backend (page load, touching the URL field,
 *    pasting), so the boot overlaps their typing.
 *  - `ensureBackendAwake()` waits for the backend *before* a request that costs
 *    a credit is sent, which turns a cold start into a pause instead of a
 *    failure — and makes retrying safe, because a request held this way never
 *    reaches FastAPI (and therefore never consumes a credit) when it fails.
 *
 * `/api/health` is the right probe: unauthenticated, no database access, no
 * engine, no quota.
 */

const HEALTH_URL = `${API_BASE}/api/health`;

/**
 * Timings in one place, exported so `npm run check:backend-wake` can exercise
 * the retry path in milliseconds instead of minutes. Nothing else writes to it.
 */
export const WAKE_TIMING = {
  /** A confirmed-warm backend is trusted this long before probing again. */
  awakeTtlMs: 2 * 60 * 1000,
  /** A background ping is not worth repeating more often than this. */
  warmIntervalMs: 2 * 60 * 1000,
  /** One probe has to be short enough that a retry still fits inside the boot. */
  probeTimeoutMs: 15 * 1000,
  /** Waits before each probe in `ensureBackendAwake`. */
  scheduleMs: [0, 4_000, 10_000, 20_000, 30_000],
  /** Overall budget before we give up and ask the player to try again. */
  budgetMs: 90 * 1000,
  /** A probe that fails faster than this never reached Render: do not wait. */
  fastFailureMs: 2_000,
  /** Instant failures to tolerate before deciding this is not a boot. */
  instantRetries: 2,
  /** Tell the player only once the wait is long enough to notice. */
  hintDelayMs: 1_500,
};

const AWAKE_KEY = "cm_backend_awake_at";
const PING_KEY = "cm_backend_ping_at";

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Safari private mode and blocked storage both throw on access.
    return null;
  }
}

function readTimestamp(key: string): number {
  const store = sessionStore();
  const raw = store?.getItem(key);
  const value = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(value) ? value : 0;
}

function writeTimestamp(key: string, value: number): void {
  try {
    sessionStore()?.setItem(key, String(value));
  } catch {
    // Storage is optional: losing it only costs an extra probe.
  }
}

/** Local development talks to uvicorn on this machine; nothing to wake. */
function isHosted(): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(API_BASE);
}

function isAwakeRecently(): boolean {
  return Date.now() - readTimestamp(AWAKE_KEY) < WAKE_TIMING.awakeTtlMs;
}

/**
 * Record that the container is up. Any response that reached our app proves it,
 * so the request paths call this too rather than paying for another probe.
 */
export function markBackendAwake(): void {
  writeTimestamp(AWAKE_KEY, Date.now());
}

let probeInFlight: Promise<ProbeResult> | null = null;

type ProbeResult = {
  ok: boolean;
  /**
   * A failure that came back instantly never reached Render's edge. A sleeping
   * container instead *holds* the request while it boots, so an instant failure
   * means something else — a blocked origin, no network — and waiting the full
   * budget for it would only stall the player.
   */
  instant: boolean;
};

async function probeOnce(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WAKE_TIMING.probeTimeoutMs);
  try {
    const response = await fetch(HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, instant: Date.now() - startedAt < WAKE_TIMING.fastFailureMs };
    }
    markBackendAwake();
    return { ok: true, instant: false };
  } catch {
    // An aborted probe means the boot did not finish in time. The boot carries
    // on regardless, so the next probe usually succeeds.
    return { ok: false, instant: Date.now() - startedAt < WAKE_TIMING.fastFailureMs };
  } finally {
    window.clearTimeout(timer);
  }
}

/** One probe shared by every caller, so a burst of triggers wakes it once. */
function sharedProbe(): Promise<ProbeResult> {
  if (!probeInFlight) {
    probeInFlight = probeOnce().finally(() => {
      probeInFlight = null;
    });
  }
  return probeInFlight;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Fire-and-forget wake-up. Safe to call from every keystroke: it is throttled,
 * deduplicated, and swallows every failure.
 */
export function warmBackend(): void {
  if (!isHosted() || isAwakeRecently()) {
    return;
  }
  const now = Date.now();
  if (now - readTimestamp(PING_KEY) < WAKE_TIMING.warmIntervalMs) {
    return;
  }
  writeTimestamp(PING_KEY, now);
  void sharedProbe();
}

/**
 * Wait until the backend answers, then return true.
 *
 * `onWaiting` fires only when the wait passes `WAKE_TIMING.hintDelayMs`, so a warm
 * backend never flashes a "waking up" message at the player.
 */
export async function ensureBackendAwake(onWaiting?: () => void): Promise<boolean> {
  if (!isHosted() || isAwakeRecently()) {
    return true;
  }

  const deadline = Date.now() + WAKE_TIMING.budgetMs;
  const hintTimer =
    onWaiting === undefined
      ? null
      : window.setTimeout(onWaiting, WAKE_TIMING.hintDelayMs);

  try {
    let instantFailures = 0;
    for (const delay of WAKE_TIMING.scheduleMs) {
      if (delay > 0) {
        if (Date.now() + delay > deadline) {
          break;
        }
        await sleep(delay);
      }
      const probe = await sharedProbe();
      if (probe.ok) {
        return true;
      }
      if (probe.instant) {
        // A request refused before Render saw it: three of those in a row is a
        // blocked origin or no network, not a container booting, so stop waiting.
        instantFailures += 1;
        if (instantFailures > WAKE_TIMING.instantRetries) {
          break;
        }
      }
      if (Date.now() >= deadline) {
        break;
      }
    }
    return false;
  } finally {
    if (hintTimer !== null) {
      window.clearTimeout(hintTimer);
    }
  }
}
