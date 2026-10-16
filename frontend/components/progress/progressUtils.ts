import type { SpeedBucket, TrackedAccount } from "../../lib/api";

/** Chip order for the game-type filter (showcase: All / Bullet / Blitz / Rapid / Classical). */
export const SPEED_OPTIONS: Array<{ value: SpeedBucket; label: string }> = [
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
  { value: "classical", label: "Classical" },
];

const KNOWN_SPEEDS: SpeedBucket[] = [
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence",
  "unknown",
];

/** Any positive integer day window is accepted from the URL; the selector offers 30/90/All. */
export type WindowDays = number | null;

export function parseSpeedsParam(raw: string | null | undefined): SpeedBucket[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return KNOWN_SPEEDS.filter((speed) => parts.includes(speed));
}

export function serializeSpeeds(speeds: SpeedBucket[]): string {
  return KNOWN_SPEEDS.filter((speed) => speeds.includes(speed)).join(",");
}

export function parseDaysParam(raw: string | null | undefined): WindowDays {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function speedsLabel(speeds: SpeedBucket[]): string {
  if (!speeds.length) return "All game types";
  return SPEED_OPTIONS.filter((option) => speeds.includes(option.value))
    .map((option) => option.label)
    .join(" + ");
}

export function daysLabel(days: WindowDays): string {
  if (!days) return "All time";
  return `Last ${days} days`;
}

/** Query string (including the leading "?") for the progress endpoints. */
export function buildProgressQuery(speeds: SpeedBucket[], days: WindowDays): string {
  const params = new URLSearchParams();
  const serialized = serializeSpeeds(speeds);
  if (serialized) params.set("speeds", serialized);
  if (days) params.set("days", String(days));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Compact numeric formatting for mono numerals: 42, 42.1, 42.15. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(digits)));
}

export function formatSigned(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const body = formatNumber(Math.abs(value), digits);
  return value >= 0 ? `+${body}` : `-${body}`;
}

export function formatMetricValue(value: number, unit: string): string {
  const number = formatNumber(value);
  const trimmed = (unit ?? "").trim();
  if (!trimmed) return number;
  if (trimmed === "%") return `${number}%`;
  return `${number} ${trimmed}`;
}

export function initialsFromName(name: string | null | undefined): string {
  const source = (name ?? "").trim();
  if (!source) return "P";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export type AccountChipModel = {
  key: string;
  platformLabel: string;
  handle: string;
  url: string | null;
  rating: number | null;
  games: number | null;
  tone: "lichess" | "chesscom" | "other";
};

export function accountChipModel(account: TrackedAccount, index: number): AccountChipModel {
  const platform = (account?.platform ?? "").toLowerCase();
  const username = (account?.username ?? "").trim();
  let platformLabel = "Account";
  let tone: AccountChipModel["tone"] = "other";
  let url: string | null = null;

  if (platform === "lichess") {
    platformLabel = "Lichess";
    tone = "lichess";
    if (username) url = `https://lichess.org/@/${encodeURIComponent(username)}`;
  } else if (platform === "chess.com" || platform === "chesscom") {
    platformLabel = "Chess.com";
    tone = "chesscom";
    if (username) url = `https://www.chess.com/member/${encodeURIComponent(username)}`;
  } else if (platform) {
    platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  }

  return {
    key: `${platform}-${username || index}`,
    platformLabel,
    handle: username ? `@${username}` : "unlinked",
    url,
    rating: typeof account?.rating === "number" ? account.rating : null,
    games: typeof account?.games === "number" ? account.games : null,
    tone,
  };
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
