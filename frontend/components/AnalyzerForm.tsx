"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  UserCheck,
  Link2,
  FileCode2,
  Search,
  Plus,
  X,
  Check,
  Loader2,
  Crown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { warmBackend } from "../lib/backend-wake";
import {
  apiGet,
  type LinkedAccount,
  type ProfileGamesResponse,
  type ProfileRecentGame,
} from "../lib/api";
import { cn } from "../lib/utils";
import { Pill } from "./ui/Pill";

export type Platform = "lichess" | "chess.com" | "pgn" | "fen";
export type PlayerColor = "white" | "black";
export type InputMode = "url" | "profile" | "pgn_fen";
export type TimeControlFilter = "all" | "bullet" | "blitz" | "rapid" | "classical";

export type AnalysisRequest = {
  platform: Platform;
  gameUrl: string;
  username?: string;
  playerColor?: PlayerColor;
  pgn?: string;
  fen?: string;
  /** Coach mode: run this analysis for one of the coach's students. */
  studentId?: string;
};

export type BatchGameInput = {
  gameUrl: string;
  playerColor?: PlayerColor;
};

export type BatchAnalysisRequest = {
  platform: "lichess" | "chess.com";
  username?: string;
  games: BatchGameInput[];
  /** Coach mode: run this batch for one of the coach's students. */
  studentId?: string;
};

type AnalyzerFormProps = {
  disabled?: boolean;
  maxGames?: number;
  /** True when user is on a paid plan (unlocks Last 10 / Last 20 batch presets). */
  isPaidPlan?: boolean;
  /** Signed-in credit count; drives the cost label and last-credits confirm. */
  remainingCredits?: number | null;
  /** Prefilled Chess.com username (e.g. the selected student's handle). */
  defaultUsername?: string;
  /** Coach mode: analyses submitted here are tagged to this student. */
  studentId?: string;
  /** Signed-in user token for profile game fetching & auto-binding. */
  token?: string;
  /** Bound Lichess / Chess.com profiles for signed-in user. */
  linkedAccounts?: LinkedAccount[];
  onAddLinkedAccount?: (platform: "lichess" | "chess.com", username: string) => Promise<void>;
  onRemoveLinkedAccount?: (platform: "lichess" | "chess.com", username: string) => Promise<void>;
  onLinkedAccountsUpdated?: (accounts: LinkedAccount[]) => void;
  onSubmit: (request: AnalysisRequest) => void;
  onSubmitBatch?: (request: BatchAnalysisRequest) => void;
};

export const MAX_BATCH_GAMES = 5;
export const MAX_PAID_BATCH_GAMES = 20;
export const PSYCHOLOGY_MIN_GAMES = 3;

type BatchRow = {
  id: number;
  url: string;
  color: PlayerColor | null;
};

type FormError =
  | { kind: "color"; rowId: number; index: number }
  | { kind: "username" }
  | { kind: "custom"; message: string };

function detectColorFromUrl(url: string): PlayerColor | null {
  const match = url.match(/\/(white|black)(?:[#?]|$)/i);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === "white" ? "white" : "black";
}

function validateUrlFormat(url: string, platform: "lichess" | "chess.com"): string | null {
  const value = url.trim();
  if (!value) {
    return null;
  }
  if (platform === "lichess") {
    if (!/lichess\.org\/[A-Za-z0-9]{8}/i.test(value)) {
      return "That doesn't look like a Lichess game link — it should start with lichess.org/ followed by 8 characters.";
    }
    return null;
  }
  if (!/chess\.com\/(game|analysis\/game|live)\//i.test(value)) {
    return "That doesn't look like a Chess.com game link — it should start with chess.com/game/ or chess.com/analysis/game/.";
  }
  return null;
}

function looksLikeFen(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || parts.length > 6) return false;
  const ranks = parts[0].split("/");
  return ranks.length === 8 && (parts[1] === "w" || parts[1] === "b");
}

const SAMPLE_PGN = `[Event "Rated Blitz game"]
[White "Player"]
[Black "Opponent"]
[Result "1-0"]
[TimeControl "180+2"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 Bf6 10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 O-O 14. Nxh7 Kxh7 15. Qh5+ Kg8 16. Rh4 f5 17. Qh7+ Kf7 18. Rh6 1-0`;

const SAMPLE_FEN =
  "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

export default function AnalyzerForm({
  disabled,
  maxGames,
  isPaidPlan = false,
  remainingCredits,
  defaultUsername,
  studentId,
  token,
  linkedAccounts = [],
  onAddLinkedAccount,
  onRemoveLinkedAccount,
  onLinkedAccountsUpdated,
  onSubmit,
  onSubmitBatch,
}: AnalyzerFormProps) {
  const tierMaxCap = isPaidPlan ? MAX_PAID_BATCH_GAMES : MAX_BATCH_GAMES;
  const rowLimit = Math.max(
    1,
    Math.min(maxGames ?? tierMaxCap, tierMaxCap)
  );

  // Input Mode: "profile" (Pick from Lichess/Chess.com - Default), "url" (Paste Game URL), "pgn_fen" (Paste PGN / FEN)
  const [inputMode, setInputMode] = useState<InputMode>("profile");
  const [platform, setPlatform] = useState<"lichess" | "chess.com">("lichess");
  const [username, setUsername] = useState(defaultUsername ?? "");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [urlHint, setUrlHint] = useState<{ rowId: number; message: string } | null>(null);
  const [lastCreditsConfirm, setLastCreditsConfirm] = useState<number | null>(null);

  // Linked accounts inline add state
  const [addingProfileOpen, setAddingProfileOpen] = useState(false);
  const [newProfilePlatform, setNewProfilePlatform] = useState<"lichess" | "chess.com">("lichess");
  const [newProfileUsername, setNewProfileUsername] = useState("");
  const [profileActionBusy, setProfileActionBusy] = useState(false);

  // Profile mode state
  const [profileUsername, setProfileUsername] = useState(defaultUsername ?? "");
  const [timeControlFilter, setTimeControlFilter] = useState<TimeControlFilter>("all");
  const [fetchedGames, setFetchedGames] = useState<ProfileRecentGame[]>([]);
  const [selectedGameUrls, setSelectedGameUrls] = useState<string[]>([]);
  const [fetchingProfileGames, setFetchingProfileGames] = useState(false);
  const [profileFetchError, setProfileFetchError] = useState<string | null>(null);
  const [presetUpgradeNotice, setPresetUpgradeNotice] = useState<string | null>(null);

  // PGN / FEN mode state
  const [rawKind, setRawKind] = useState<"pgn" | "fen">("pgn");
  const [rawText, setRawText] = useState("");
  const [rawColor, setRawColor] = useState<PlayerColor>("white");

  const nextRowId = useRef(2);
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const usernameRef = useRef<HTMLInputElement>(null);
  const colorGroupRefs = useRef(new Map<number, HTMLDivElement>());
  const lichessTabRef = useRef<HTMLButtonElement>(null);
  const chesscomTabRef = useRef<HTMLButtonElement>(null);
  const [rows, setRows] = useState<BatchRow[]>([
    { id: 1, url: "", color: null },
  ]);

  useEffect(() => {
    if (defaultUsername !== undefined) {
      setUsername(defaultUsername);
      setProfileUsername(defaultUsername);
    }
  }, [defaultUsername]);

  useEffect(() => {
    setRows((current) =>
      current.length > rowLimit ? current.slice(0, rowLimit) : current
    );
  }, [rowLimit]);

  useEffect(() => {
    const focusUrl = () => {
      setInputMode("url");
      setTimeout(() => {
        document
          .querySelector<HTMLInputElement>('input[aria-label="Game 1 URL"]')
          ?.focus();
      }, 20);
    };
    window.addEventListener("cm_focus_analyzer_url", focusUrl);
    return () => window.removeEventListener("cm_focus_analyzer_url", focusUrl);
  }, []);

  useEffect(() => {
    if (!formError) return;
    if (formError.kind === "username" && username.trim()) {
      setFormError(null);
      return;
    }
    if (
      formError.kind === "color" &&
      rows.every((row) => !row.url.trim() || row.color)
    ) {
      setFormError(null);
    }
  }, [formError, rows, username]);

  const handlePlatformChange = (next: "lichess" | "chess.com") => {
    setPlatform(next);
    setFormError(null);
    setUrlHint(null);
    setLastCreditsConfirm(null);
    setProfileFetchError(null);
    if (next === "lichess") {
      setRows((current) =>
        current.map((row) => {
          const detected = detectColorFromUrl(row.url);
          return detected ? { ...row, color: detected } : row;
        })
      );
    }
  };

  const handlePlatformKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = platform === "lichess" ? "chess.com" : "lichess";
    handlePlatformChange(next);
    (next === "lichess" ? lichessTabRef : chesscomTabRef).current?.focus();
  };

  const fetchGamesForProfile = useCallback(
    async (
      targetPlatform: "lichess" | "chess.com",
      targetUser: string,
      tcFilter: TimeControlFilter
    ) => {
      const clean = targetUser.trim().replace(/^@+/, "");
      if (!clean) {
        setProfileFetchError(`Enter a ${targetPlatform === "lichess" ? "Lichess" : "Chess.com"} username to load recent games.`);
        return;
      }
      warmBackend();
      setFetchingProfileGames(true);
      setProfileFetchError(null);
      setPresetUpgradeNotice(null);
      try {
        const params = new URLSearchParams({
          platform: targetPlatform,
          username: clean,
          max_games: "30",
          time_control: tcFilter,
          bind: "true",
        });
        const response = await apiGet<ProfileGamesResponse>(
          `/api/profile/games?${params.toString()}`,
          token || undefined
        );
        const list = response.games || [];
        setFetchedGames(list);
        if (response.linked_accounts && onLinkedAccountsUpdated) {
          onLinkedAccountsUpdated(response.linked_accounts);
        }
        // Auto-select the most recent game by default if available
        if (list.length > 0) {
          setSelectedGameUrls([list[0].game_url]);
        } else {
          setSelectedGameUrls([]);
          setProfileFetchError(
            `No recent ${tcFilter === "all" ? "" : `${tcFilter} `}games found for @${clean} on ${
              targetPlatform === "lichess" ? "Lichess" : "Chess.com"
            }.`
          );
        }
      } catch (err) {
        setFetchedGames([]);
        setSelectedGameUrls([]);
        setProfileFetchError(
          err instanceof Error ? err.message : "Could not load games for that profile."
        );
      } finally {
        setFetchingProfileGames(false);
      }
    },
    [token, onLinkedAccountsUpdated]
  );

  const handleSelectLinkedProfile = (account: LinkedAccount) => {
    setInputMode("profile");
    setPlatform(account.platform);
    setProfileUsername(account.username);
    setUsername(account.username);
    void fetchGamesForProfile(account.platform, account.username, timeControlFilter);
  };

  const handleSaveNewLinkedProfile = async () => {
    const clean = newProfileUsername.trim().replace(/^@+/, "");
    if (!clean || !onAddLinkedAccount) return;
    setProfileActionBusy(true);
    try {
      await onAddLinkedAccount(newProfilePlatform, clean);
      setNewProfileUsername("");
      setAddingProfileOpen(false);
    } finally {
      setProfileActionBusy(false);
    }
  };

  const handleTimeControlFilterChange = (nextFilter: TimeControlFilter) => {
    setTimeControlFilter(nextFilter);
    if (profileUsername.trim()) {
      void fetchGamesForProfile(platform, profileUsername, nextFilter);
    }
  };

  const toggleSelectProfileGame = (gameUrl: string) => {
    setPresetUpgradeNotice(null);
    setLastCreditsConfirm(null);
    setSelectedGameUrls((current) => {
      if (current.includes(gameUrl)) {
        return current.filter((u) => u !== gameUrl);
      }
      if (current.length >= rowLimit) {
        setPresetUpgradeNotice(
          !token
            ? "Sign in with a free account to select up to 5 games at once."
            : !isPaidPlan
              ? `Your free plan allows up to ${rowLimit} ${rowLimit === 1 ? "game" : "games"} per run. Upgrade to Pro to batch up to 20 games.`
              : `You can select up to ${rowLimit} games per run.`
        );
        return current;
      }
      return [...current, gameUrl];
    });
  };

  const handleSelectLastPreset = (count: 5 | 10 | 20) => {
    setLastCreditsConfirm(null);
    if (fetchedGames.length === 0) return;
    const allowed = Math.min(count, rowLimit, fetchedGames.length);
    const urls = fetchedGames.slice(0, allowed).map((g) => g.game_url);
    setSelectedGameUrls(urls);

    if (count > rowLimit) {
      if (!token) {
        setPresetUpgradeNotice(
          `Selected 1 game (guest limit). Sign in free to analyze up to 5 games, or upgrade to Pro for Last ${count}.`
        );
      } else if (!isPaidPlan) {
        setPresetUpgradeNotice(
          `Selected ${allowed} of ${count} games — free accounts have ${rowLimit} free analyses remaining. Upgrade to Pro to unlock Last 10 & Last 20 batch analysis.`
        );
      } else {
        setPresetUpgradeNotice(
          `Selected ${allowed} games based on your remaining credits (${rowLimit}).`
        );
      }
    } else {
      setPresetUpgradeNotice(null);
    }
  };

  const updateRowUrl = (id: number, value: string) => {
    warmBackend();
    const detected = platform === "lichess" ? detectColorFromUrl(value) : null;
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, url: value, color: detected ?? row.color }
          : row
      )
    );
    setUrlHint((current) => (current?.rowId === id ? null : current));
    setLastCreditsConfirm(null);
  };

  const checkUrlOnBlur = (id: number, value: string) => {
    const message = validateUrlFormat(value, platform);
    setUrlHint(message ? { rowId: id, message } : null);
  };

  const updateRowColor = (id: number, color: PlayerColor) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, color } : row))
    );
  };

  const handleColorKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    rowId: number,
    current: PlayerColor | null
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: PlayerColor = current === "white" ? "black" : "white";
    updateRowColor(rowId, next);
    colorGroupRefs.current
      .get(rowId)
      ?.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)
      ?.focus();
  };

  const addRow = () => {
    setLastCreditsConfirm(null);
    setRows((current) => {
      if (current.length >= rowLimit) return current;
      const id = nextRowId.current;
      nextRowId.current += 1;
      return [...current, { id, url: "", color: null }];
    });
  };

  const removeRow = (id: number) => {
    setLastCreditsConfirm(null);
    setRows((current) => {
      if (current.length <= 1) return current;
      return current.filter((row) => row.id !== id);
    });
  };

  const pasteFromClipboard = async (id: number) => {
    warmBackend();
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        updateRowUrl(id, text.trim());
        return;
      }
    } catch {
      // Clipboard denied; focus input
    }
    const input = inputRefs.current.get(id);
    input?.focus();
    input?.select();
  };

  const loadSampleGame = () => {
    setInputMode("url");
    handlePlatformChange("lichess");
    warmBackend();
    setRows([{ id: 1, url: "https://lichess.org/zR8HRccT/white", color: "white" }]);
  };

  const handleRawTextChange = (value: string) => {
    warmBackend();
    setRawText(value);
    setFormError(null);
    if (looksLikeFen(value)) {
      setRawKind("fen");
      const parts = value.trim().split(/\s+/);
      if (parts[1] === "b") setRawColor("black");
      else if (parts[1] === "w") setRawColor("white");
    } else if (value.trim().startsWith("[") || /1\.\s*[a-hNBRQK]/i.test(value)) {
      setRawKind("pgn");
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;

    // MODE 3: Direct PGN or FEN
    if (inputMode === "pgn_fen") {
      const cleaned = rawText.trim();
      if (!cleaned) {
        setFormError({
          kind: "custom",
          message: `Paste a valid ${rawKind.toUpperCase()} before analyzing.`,
        });
        return;
      }
      if (
        remainingCredits !== null &&
        remainingCredits !== undefined &&
        1 >= remainingCredits
      ) {
        if (lastCreditsConfirm !== 1) {
          setLastCreditsConfirm(1);
          return;
        }
        setLastCreditsConfirm(null);
      }
      if (rawKind === "fen" || looksLikeFen(cleaned)) {
        onSubmit({
          platform: "fen",
          gameUrl: cleaned,
          fen: cleaned,
          playerColor: rawColor,
          studentId,
        });
      } else {
        onSubmit({
          platform: "pgn",
          gameUrl: "",
          pgn: cleaned,
          playerColor: rawColor,
          username: username.trim() || undefined,
          studentId,
        });
      }
      return;
    }

    // MODE 1: Profile Game Picker
    if (inputMode === "profile") {
      const selectedGames = fetchedGames.filter((g) =>
        selectedGameUrls.includes(g.game_url)
      );
      if (selectedGames.length === 0) {
        setFormError({
          kind: "custom",
          message: "Select at least one game from your profile list to analyze.",
        });
        return;
      }
      if (
        remainingCredits !== null &&
        remainingCredits !== undefined &&
        selectedGames.length >= remainingCredits
      ) {
        if (lastCreditsConfirm !== selectedGames.length) {
          setLastCreditsConfirm(selectedGames.length);
          return;
        }
        setLastCreditsConfirm(null);
      }
      if (selectedGames.length === 1) {
        const g = selectedGames[0];
        onSubmit({
          platform: g.platform,
          gameUrl: g.game_url,
          username: profileUsername.trim(),
          playerColor: g.player_color,
          studentId,
        });
        return;
      }
      if (onSubmitBatch) {
        onSubmitBatch({
          platform,
          username: profileUsername.trim(),
          games: selectedGames.map((g) => ({
            gameUrl: g.game_url,
            playerColor: g.player_color,
          })),
          studentId,
        });
      }
      return;
    }

    // MODE 2: Game URL Paste
    const games: BatchGameInput[] = rows
      .map((row) => ({
        gameUrl: row.url.trim(),
        playerColor:
          platform === "lichess" ? row.color ?? undefined : undefined,
      }))
      .filter((game) => game.gameUrl);
    if (games.length === 0) return;

    if (platform === "lichess") {
      const missingIndex = rows.findIndex(
        (row) => row.url.trim() && !row.color
      );
      if (missingIndex !== -1) {
        const missing = rows[missingIndex];
        setFormError({
          kind: "color",
          rowId: missing.id,
          index: missingIndex,
        });
        colorGroupRefs.current
          .get(missing.id)
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus();
        return;
      }
    }
    if (platform === "chess.com" && !username.trim()) {
      setFormError({ kind: "username" });
      usernameRef.current?.focus();
      return;
    }

    if (
      remainingCredits !== null &&
      remainingCredits !== undefined &&
      games.length >= remainingCredits
    ) {
      if (lastCreditsConfirm !== games.length) {
        setLastCreditsConfirm(games.length);
        return;
      }
      setLastCreditsConfirm(null);
    }

    if (games.length === 1) {
      onSubmit({
        platform,
        gameUrl: games[0].gameUrl,
        username: platform === "chess.com" ? username.trim() : undefined,
        playerColor: games[0].playerColor,
        studentId,
      });
      return;
    }
    if (onSubmitBatch) {
      onSubmitBatch({
        platform,
        username: platform === "chess.com" ? username.trim() : undefined,
        games,
        studentId,
      });
    }
  };

  const activeGameCount = useMemo(() => {
    if (inputMode === "pgn_fen") {
      return rawText.trim() ? 1 : 0;
    }
    if (inputMode === "profile") {
      return selectedGameUrls.length;
    }
    return rows.filter((row) => row.url.trim()).length;
  }, [inputMode, rawText, selectedGameUrls.length, rows]);

  const multiGame = activeGameCount > 1;
  const psychologyUnlocked = activeGameCount >= PSYCHOLOGY_MIN_GAMES;
  const gamesToPsychology = Math.max(PSYCHOLOGY_MIN_GAMES - activeGameCount, 0);
  const psychologyHintAvailable = rowLimit >= PSYCHOLOGY_MIN_GAMES && inputMode !== "pgn_fen";

  const submitDisabled =
    disabled ||
    activeGameCount === 0 ||
    (multiGame && !onSubmitBatch);

  return (
    <form className="analyzer-form" onSubmit={handleSubmit}>
      {/* =====================================================================
          SIGNED-IN LINKED PROFILES BAR (Bind / Switch / Remove Lichess & Chess.com handles)
         ===================================================================== */}
      {token && (
        <div className="rounded-xl bg-[var(--ink-3)]/80 border border-[var(--line)] p-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]">
              <UserCheck size={14} className="text-[var(--gold-bright)]" />
              <span>Linked Chess Profiles</span>
              <span className="text-[11px] font-normal text-[var(--text-muted)]">
                (Click a profile to fetch recent games)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAddingProfileOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--gold-bright)] hover:underline cursor-pointer"
            >
              <Plus size={13} />
              <span>{addingProfileOpen ? "Close" : "Bind Profile"}</span>
            </button>
          </div>

          {linkedAccounts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {linkedAccounts.map((acc) => {
                const isSelected =
                  inputMode === "profile" &&
                  platform === acc.platform &&
                  profileUsername.toLowerCase() === acc.username.toLowerCase();
                return (
                  <div
                    key={`${acc.platform}:${acc.username}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs border transition-all",
                      isSelected
                        ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold-bright)] font-semibold"
                        : "bg-[var(--ink-2)] border-[var(--line)] text-[var(--text)] hover:border-[var(--gold)]/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectLinkedProfile(acc)}
                      className="inline-flex items-center gap-1.5 cursor-pointer"
                      title={`Load recent games from ${acc.platform} (@${acc.username})`}
                    >
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-[var(--ink-3)] text-[var(--text-muted)]">
                        {acc.platform === "lichess" ? "Lichess" : "Chess.com"}
                      </span>
                      <span>@{acc.username}</span>
                    </button>
                    {onRemoveLinkedAccount && (
                      <button
                        type="button"
                        onClick={() => void onRemoveLinkedAccount(acc.platform, acc.username)}
                        className="p-0.5 rounded-full text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--ink-3)] cursor-pointer"
                        title={`Remove @${acc.username}`}
                        aria-label={`Remove ${acc.platform} profile ${acc.username}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              No profiles bound yet. Bind your Lichess or Chess.com username for 1-click game loading.
            </p>
          )}

          <AnimatePresence>
            {addingProfileOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--line-soft)] overflow-hidden"
              >
                <select
                  value={newProfilePlatform}
                  onChange={(e) =>
                    setNewProfilePlatform(e.target.value as "lichess" | "chess.com")
                  }
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-[var(--ink-2)] border border-[var(--line)] text-[var(--text)]"
                  aria-label="Select platform to bind"
                >
                  <option value="lichess">Lichess</option>
                  <option value="chess.com">Chess.com</option>
                </select>
                <input
                  type="text"
                  value={newProfileUsername}
                  onChange={(e) => setNewProfileUsername(e.target.value)}
                  placeholder="Username (e.g. magnuscarlsen)"
                  className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs rounded-lg bg-[var(--ink-2)] border border-[var(--line)] text-[var(--text)]"
                />
                <button
                  type="button"
                  disabled={profileActionBusy || !newProfileUsername.trim()}
                  onClick={() => void handleSaveNewLinkedProfile()}
                  className="px-3 py-1.5 rounded-lg bg-[var(--gold)] text-[#141712] text-xs font-bold hover:bg-[var(--gold-bright)] disabled:opacity-50 cursor-pointer"
                >
                  {profileActionBusy ? "Saving..." : "Save Profile"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* =====================================================================
          3-MODE INPUT SWITCHER: Pick from Lichess/Chess.com | Paste Game URL | PGN / FEN
         ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex flex-wrap p-1 rounded-xl bg-[var(--ink-3)] border border-[var(--line)] gap-1"
          role="group"
          aria-label="Analysis input method"
        >
          <button
            type="button"
            onClick={() => {
              setInputMode("profile");
              setFormError(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              inputMode === "profile"
                ? "bg-[var(--ink-1)] text-[var(--gold-bright)] border border-[var(--gold)]/35 shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            <UserCheck size={13} />
            <span>Pick from Lichess / Chess.com</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setInputMode("url");
              setFormError(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              inputMode === "url"
                ? "bg-[var(--ink-1)] text-[var(--gold-bright)] border border-[var(--gold)]/35 shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            <Link2 size={13} />
            <span>Paste Game URL</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setInputMode("pgn_fen");
              setFormError(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              inputMode === "pgn_fen"
                ? "bg-[var(--ink-1)] text-[var(--gold-bright)] border border-[var(--gold)]/35 shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            <FileCode2 size={13} />
            <span>Paste PGN / FEN</span>
          </button>
        </div>

        {/* Platform Switch (Shown for Profile & Paste Link modes) */}
        {inputMode !== "pgn_fen" && (
          <div
            className="platform-toggle relative flex p-1 rounded-full bg-[var(--ink-3)] border border-[var(--line-soft)]"
            role="tablist"
            aria-label="Chess platform"
            onKeyDown={handlePlatformKeyDown}
          >
            <button
              ref={lichessTabRef}
              type="button"
              role="tab"
              id="platform-tab-lichess"
              aria-selected={platform === "lichess"}
              aria-controls="platform-panel"
              tabIndex={platform === "lichess" ? 0 : -1}
              className={cn(
                "tap-hit-y relative z-10 flex-1 py-1 px-3.5 text-xs font-medium rounded-full transition-colors cursor-pointer text-center",
                platform === "lichess"
                  ? "text-[#0c1214] font-semibold"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              )}
              onClick={() => handlePlatformChange("lichess")}
              disabled={disabled}
            >
              {platform === "lichess" && (
                <motion.div
                  layoutId="platform-active-pill"
                  className="absolute inset-0 bg-[var(--gold)] rounded-full -z-10 shadow-sm"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              Lichess
            </button>

            <button
              ref={chesscomTabRef}
              type="button"
              role="tab"
              id="platform-tab-chesscom"
              aria-selected={platform === "chess.com"}
              aria-controls="platform-panel"
              tabIndex={platform === "chess.com" ? 0 : -1}
              className={cn(
                "tap-hit-y relative z-10 flex-1 py-1 px-3.5 text-xs font-medium rounded-full transition-colors cursor-pointer text-center",
                platform === "chess.com"
                  ? "text-[#0c1214] font-semibold"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              )}
              onClick={() => handlePlatformChange("chess.com")}
              disabled={disabled}
            >
              {platform === "chess.com" && (
                <motion.div
                  layoutId="platform-active-pill"
                  className="absolute inset-0 bg-[var(--gold)] rounded-full -z-10 shadow-sm"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              Chess.com
            </button>
          </div>
        )}
      </div>

      {/* =====================================================================
          PANEL CONTENT BY INPUT MODE
         ===================================================================== */}
      <div
        role="tabpanel"
        id="platform-panel"
        aria-labelledby={
          platform === "lichess" ? "platform-tab-lichess" : "platform-tab-chesscom"
        }
      >
        {/* -------------------------------------------------------------------
            MODE 1: PROFILE GAMES (Fetch by Username + Soft Filters + Presets)
           ------------------------------------------------------------------- */}
        {inputMode === "profile" && (
          <div className="flex flex-col gap-3">
            <div className="field">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label htmlFor="profile-username-input" className="text-xs font-semibold text-[var(--text-muted)]">
                  Enter your {platform === "lichess" ? "Lichess" : "Chess.com"} username to pick recent games
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const sampleUser = platform === "lichess" ? "MentalCarlsen" : "botevenik";
                      setProfileUsername(sampleUser);
                      setUsername(sampleUser);
                      void fetchGamesForProfile(platform, sampleUser, timeControlFilter);
                    }}
                    disabled={disabled || fetchingProfileGames}
                    className="tap-hit text-xs text-[var(--gold)] hover:text-[var(--gold-bright)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Sparkles size={13} />
                    <span>
                      Sample profile (@{platform === "lichess" ? "MentalCarlsen" : "botevenik"})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={loadSampleGame}
                    disabled={disabled}
                    className="tap-hit text-xs text-[var(--text-muted)] hover:text-[var(--gold-bright)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Try sample game</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="profile-username-input"
                  type="text"
                  value={profileUsername}
                  onChange={(e) => {
                    setProfileUsername(e.target.value);
                    if (profileFetchError) setProfileFetchError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void fetchGamesForProfile(platform, profileUsername, timeControlFilter);
                    }
                  }}
                  placeholder={
                    platform === "lichess"
                      ? "Type Lichess username (e.g. MentalCarlsen)"
                      : "Type Chess.com username (e.g. botevenik)"
                  }
                  disabled={disabled || fetchingProfileGames}
                  className="flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() =>
                    void fetchGamesForProfile(platform, profileUsername, timeControlFilter)
                  }
                  disabled={disabled || fetchingProfileGames}
                  className="px-4 py-2.5 rounded-[var(--radius-control)] bg-[var(--ink-3)] border border-[var(--gold)]/40 text-[var(--gold-bright)] hover:bg-[var(--gold)]/15 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {fetchingProfileGames ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  <span>{fetchingProfileGames ? "Loading..." : "Fetch Games"}</span>
                </button>
              </div>
            </div>

            {/* Soft Time Control Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Time control filter">
                {(
                  [
                    { id: "all", label: "All Controls" },
                    { id: "bullet", label: "⚡ Bullet" },
                    { id: "blitz", label: "🔥 Blitz" },
                    { id: "rapid", label: "⏱ Rapid" },
                    { id: "classical", label: "🏛 Classical" },
                  ] as const
                ).map((tc) => (
                  <button
                    key={tc.id}
                    type="button"
                    onClick={() => handleTimeControlFilterChange(tc.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                      timeControlFilter === tc.id
                        ? "bg-[var(--gold)] text-[#141712] border-[var(--gold)] font-semibold"
                        : "bg-[var(--ink-3)] text-[var(--text-muted)] border-[var(--line)] hover:text-[var(--text)]"
                    )}
                  >
                    {tc.label}
                  </button>
                ))}
              </div>

              {/* Quick Batch Selection Presets: Last 5 / Last 10 / Last 20 */}
              {fetchedGames.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-[var(--text-muted)] text-[11px] mr-0.5">Quick select:</span>
                  {([5, 10, 20] as const).map((preset) => {
                    const lockedForFree = preset > MAX_BATCH_GAMES && !isPaidPlan;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectLastPreset(preset)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-mono font-semibold border transition-all inline-flex items-center gap-1 cursor-pointer",
                          selectedGameUrls.length === preset
                            ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold-bright)]"
                            : "bg-[var(--ink-3)] border-[var(--line)] text-[var(--text)] hover:border-[var(--gold)]/50"
                        )}
                        title={
                          lockedForFree
                            ? `Pro feature: Select last ${preset} games`
                            : `Select last ${preset} games`
                        }
                      >
                        {lockedForFree && <Crown size={11} className="text-[var(--gold-bright)]" />}
                        <span>Last {preset}</span>
                      </button>
                    );
                  })}
                  {selectedGameUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGameUrls([]);
                        setPresetUpgradeNotice(null);
                      }}
                      className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] underline ml-1 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {presetUpgradeNotice && (
              <div className="p-2.5 rounded-lg bg-[var(--gold)]/10 border border-[var(--gold)]/35 text-xs text-[var(--text)] flex flex-wrap items-center justify-between gap-2">
                <span>{presetUpgradeNotice}</span>
                {!isPaidPlan && (
                  <Link
                    href="/subscription"
                    className="px-2.5 py-1 rounded bg-[var(--gold)] text-[#141712] font-bold text-xs hover:bg-[var(--gold-bright)] shrink-0"
                  >
                    Upgrade to Pro
                  </Link>
                )}
              </div>
            )}

            {profileFetchError && (
              <p className="analyzer-error" role="alert">
                {profileFetchError}
              </p>
            )}

            {/* Fetched Games List */}
            {fetchedGames.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--ink-1)]/70 divide-y divide-[var(--line-soft)]">
                {fetchedGames.map((g) => {
                  const checked = selectedGameUrls.includes(g.game_url);
                  const resColor =
                    g.result === "win"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                      : g.result === "loss"
                        ? "text-rose-400 bg-rose-500/10 border-rose-500/25"
                        : "text-amber-300 bg-amber-500/10 border-amber-500/25";
                  return (
                    <label
                      key={g.game_url}
                      className={cn(
                        "flex items-center justify-between gap-3 px-3 py-2.5 text-xs cursor-pointer transition-colors",
                        checked ? "bg-[var(--gold)]/10" : "hover:bg-[var(--ink-2)]"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectProfileGame(g.game_url)}
                          className="accent-[var(--gold)] w-4 h-4 rounded cursor-pointer shrink-0"
                        />
                        <span
                          className={cn(
                            "w-5 h-5 rounded-full text-[10px] font-mono font-bold flex items-center justify-center shrink-0",
                            g.player_color === "white"
                              ? "bg-[#f3ecdc] text-[#0c1214]"
                              : "bg-[#29373b] text-white border border-[var(--line)]"
                          )}
                          title={`Played as ${g.player_color}`}
                        >
                          {g.player_color === "white" ? "W" : "B"}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--text)] truncate">
                            vs. {g.opponent_username}
                            {g.opponent_rating ? ` (${g.opponent_rating})` : ""}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {g.opening_name || g.eco || "Standard Chess"} ·{" "}
                            <span className="capitalize">{g.time_class}</span> ({g.time_control_label})
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border",
                            resColor
                          )}
                        >
                          {g.result}
                        </span>
                        {g.started_at && (
                          <span className="text-[10px] font-mono text-[var(--text-muted)] hidden sm:inline">
                            {g.started_at.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------------
            MODE 2: PASTE GAME LINK (Existing URL Input Rows)
           ------------------------------------------------------------------- */}
        {inputMode === "url" && (
          <>
            {platform === "chess.com" && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="field mb-3"
              >
                <label htmlFor="chesscom-username">Chess.com Username</label>
                <input
                  id="chesscom-username"
                  ref={usernameRef}
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. magnuscarlsen"
                  disabled={disabled}
                  aria-invalid={formError?.kind === "username" || undefined}
                />
                {formError?.kind === "username" && (
                  <p className="analyzer-error" role="alert">
                    Add your Chess.com username so we can find your side of the game.
                  </p>
                )}
              </motion.div>
            )}

            <div className="field">
              <div className="flex items-center justify-between mb-1">
                <span>{rows.length > 1 ? "Game links" : "Game URL"}</span>
                <button
                  type="button"
                  onClick={loadSampleGame}
                  disabled={disabled}
                  className="tap-hit text-xs text-[var(--gold)] hover:text-[var(--gold-bright)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Sparkles size={13} />
                  <span>Try sample game</span>
                </button>
              </div>

              <div className="game-rows flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {rows.map((row, index) => (
                    <motion.div
                      key={row.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="game-row flex items-center gap-2"
                    >
                      <span
                        className="game-row-index text-xs font-mono text-[var(--text-muted)] shrink-0 w-4 text-center"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>

                      <div className="game-row-field flex-1 relative flex items-center">
                        <input
                          type="url"
                          ref={(element) => {
                            if (element) {
                              inputRefs.current.set(row.id, element);
                            } else {
                              inputRefs.current.delete(row.id);
                            }
                          }}
                          value={row.url}
                          onChange={(event) => updateRowUrl(row.id, event.target.value)}
                          onFocus={() => warmBackend()}
                          onPaste={() => warmBackend()}
                          onBlur={(event) => checkUrlOnBlur(row.id, event.target.value)}
                          placeholder={
                            platform === "lichess"
                              ? "https://lichess.org/abc12345"
                              : "https://www.chess.com/game/live/123456789"
                          }
                          disabled={disabled}
                          aria-label={`Game ${index + 1} URL`}
                          aria-describedby={
                            urlHint?.rowId === row.id
                              ? `game-${row.id}-url-hint`
                              : undefined
                          }
                          autoComplete="off"
                          spellCheck={false}
                          inputMode="url"
                        />
                        <button
                          type="button"
                          className="paste-button"
                          onClick={() => pasteFromClipboard(row.id)}
                          disabled={disabled}
                          title="Paste game link from clipboard"
                        >
                          Paste
                        </button>
                      </div>

                      {platform === "lichess" && (
                        <div
                          ref={(element) => {
                            if (element) {
                              colorGroupRefs.current.set(row.id, element);
                            } else {
                              colorGroupRefs.current.delete(row.id);
                            }
                          }}
                          className={cn(
                            "game-row-color relative flex p-1 rounded-full bg-[var(--ink-3)] border border-[var(--line-soft)] shrink-0",
                            formError?.kind === "color" &&
                              formError.rowId === row.id &&
                              "is-error"
                          )}
                          role="radiogroup"
                          aria-label={`Side you played in game ${index + 1}`}
                          aria-describedby={
                            formError?.kind === "color" && formError.rowId === row.id
                              ? `game-${row.id}-color-error`
                              : undefined
                          }
                          onKeyDown={(event) =>
                            handleColorKeyDown(event, row.id, row.color)
                          }
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={row.color === "white"}
                            tabIndex={row.color === "black" ? -1 : 0}
                            data-color="white"
                            className={cn(
                              "tap-hit-y relative z-10 w-7 h-7 rounded-full text-xs font-mono font-bold flex items-center justify-center transition-colors cursor-pointer",
                              row.color === "white"
                                ? "text-[#0c1214]"
                                : "text-[var(--text-muted)] hover:text-white"
                            )}
                            onClick={() => updateRowColor(row.id, "white")}
                            disabled={disabled}
                            title="I played White"
                          >
                            {row.color === "white" && (
                              <motion.div
                                layoutId={`color-chip-${row.id}`}
                                className="absolute inset-0 bg-[#f3ecdc] rounded-full -z-10 shadow-sm"
                                transition={{ type: "spring", stiffness: 450, damping: 35 }}
                              />
                            )}
                            W
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={row.color === "black"}
                            tabIndex={row.color === "black" ? 0 : -1}
                            data-color="black"
                            className={cn(
                              "tap-hit-y relative z-10 w-7 h-7 rounded-full text-xs font-mono font-bold flex items-center justify-center transition-colors cursor-pointer",
                              row.color === "black"
                                ? "text-white"
                                : "text-[var(--text-muted)] hover:text-white"
                            )}
                            onClick={() => updateRowColor(row.id, "black")}
                            disabled={disabled}
                            title="I played Black"
                          >
                            {row.color === "black" && (
                              <motion.div
                                layoutId={`color-chip-${row.id}`}
                                className="absolute inset-0 bg-[#29373b] rounded-full -z-10 shadow-sm border border-[var(--line)]"
                                transition={{ type: "spring", stiffness: 450, damping: 35 }}
                              />
                            )}
                            B
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        className="game-row-remove"
                        onClick={() => removeRow(row.id)}
                        disabled={disabled || rows.length <= 1}
                        aria-label={`Remove game ${index + 1}`}
                      >
                        ×
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {formError?.kind === "color" && (
                <p
                  id={`game-${formError.rowId}-color-error`}
                  className="analyzer-error"
                  role="alert"
                >
                  Tell us which side you played — this link doesn&apos;t say. Pick W or
                  B on game {formError.index + 1}.
                </p>
              )}

              <div className="game-rows-footer flex items-center justify-between mt-2 text-xs">
                <button
                  type="button"
                  className="add-game text-[var(--gold)] hover:text-[var(--gold-bright)] transition-colors cursor-pointer disabled:opacity-50"
                  onClick={addRow}
                  disabled={disabled || rows.length >= rowLimit}
                >
                  + Add another game
                </button>
                <span className="game-rows-hint text-[var(--text-muted)] font-mono">
                  {activeGameCount === 0
                    ? `Up to ${rowLimit} ${rowLimit === 1 ? "game" : "games"} per run · 1 analysis each`
                    : `${activeGameCount} of ${rowLimit} ${rowLimit === 1 ? "game" : "games"} · 1 analysis each`}
                </span>
              </div>

              {urlHint && (
                <p
                  id={`game-${urlHint.rowId}-url-hint`}
                  className="analyzer-error"
                  role="status"
                >
                  {urlHint.message}
                </p>
              )}
            </div>
          </>
        )}

        {/* -------------------------------------------------------------------
            MODE 3: DIRECT PGN OR FEN INPUT
           ------------------------------------------------------------------- */}
        {inputMode === "pgn_fen" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex p-0.5 rounded-lg bg-[var(--ink-3)] border border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => setRawKind("pgn")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                    rawKind === "pgn"
                      ? "bg-[var(--gold)] text-[#141712]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  )}
                >
                  PGN (Full Game)
                </button>
                <button
                  type="button"
                  onClick={() => setRawKind("fen")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                    rawKind === "fen"
                      ? "bg-[var(--gold)] text-[#141712]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  )}
                >
                  FEN (Single Position)
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (rawKind === "fen") {
                      handleRawTextChange(SAMPLE_FEN);
                    } else {
                      handleRawTextChange(SAMPLE_PGN);
                    }
                  }}
                  className="text-xs text-[var(--gold)] hover:text-[var(--gold-bright)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles size={12} />
                  <span>Load sample {rawKind.toUpperCase()}</span>
                </button>
              </div>
            </div>

            <div className="field">
              <textarea
                rows={rawKind === "fen" ? 2 : 5}
                value={rawText}
                onChange={(e) => handleRawTextChange(e.target.value)}
                placeholder={
                  rawKind === "fen"
                    ? "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
                    : '[Event "Live Chess"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...'
                }
                disabled={disabled}
                aria-label={rawKind === "fen" ? "FEN string input" : "PGN text input"}
                className="w-full p-3 rounded-[var(--radius-control)] bg-[var(--input-bg)] border border-[var(--input-line)] text-[var(--text)] font-mono text-xs focus:outline-hidden focus:border-[var(--gold)]"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--text-muted)] font-medium">
                Coach perspective (Side you played):
              </span>
              <div className="inline-flex p-1 rounded-full bg-[var(--ink-3)] border border-[var(--line)] gap-1">
                <button
                  type="button"
                  onClick={() => setRawColor("white")}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors",
                    rawColor === "white"
                      ? "bg-[#f3ecdc] text-[#0c1214]"
                      : "text-[var(--text-muted)] hover:text-white"
                  )}
                >
                  White
                </button>
                <button
                  type="button"
                  onClick={() => setRawColor("black")}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors",
                    rawColor === "black"
                      ? "bg-[#29373b] text-white border border-[var(--line)]"
                      : "text-[var(--text-muted)] hover:text-white"
                  )}
                >
                  Black
                </button>
              </div>
            </div>
          </div>
        )}

        {formError?.kind === "custom" && (
          <p className="analyzer-error mt-2" role="alert">
            {formError.message}
          </p>
        )}

        {psychologyHintAvailable && (
          <p
            className={cn(
              "psych-unlock mt-2 text-xs text-[var(--text-muted)] flex items-center gap-1.5",
              psychologyUnlocked && "text-[var(--green)] font-medium"
            )}
            aria-live="polite"
          >
            {psychologyUnlocked ? (
              <>
                <Pill tone="positive" size="sm">Unlocked</Pill>
                <span>Psychology profile included in report.</span>
              </>
            ) : (
              <span>
                Add {gamesToPsychology} more {gamesToPsychology === 1 ? "game" : "games"} to unlock Psychology profile.
              </span>
            )}
          </p>
        )}
      </div>

      <button type="submit" className="btn" disabled={submitDisabled}>
        {disabled
          ? "Analyzing..."
          : activeGameCount === 0
            ? inputMode === "profile"
              ? "Pick a game to analyze"
              : inputMode === "url"
                ? "Paste a game link to analyze"
                : "Paste a PGN or FEN to analyze"
            : lastCreditsConfirm === activeGameCount
            ? `Use my last ${activeGameCount} ${
                activeGameCount === 1 ? "credit" : "credits"
              }`
            : inputMode === "pgn_fen" && rawKind === "fen"
              ? remainingCredits !== null && remainingCredits !== undefined
                ? `Analyze FEN position · uses 1 of ${remainingCredits} credits`
                : "Analyze FEN position"
              : multiGame
                ? remainingCredits !== null && remainingCredits !== undefined
                  ? `Analyze ${activeGameCount} games · uses ${activeGameCount} of ${remainingCredits} credits`
                  : `Analyze ${activeGameCount} games`
                : remainingCredits !== null && remainingCredits !== undefined
                  ? `Analyze game · uses 1 of ${remainingCredits} credits`
                  : "Analyze game"}
      </button>
      {lastCreditsConfirm === activeGameCount &&
        activeGameCount > 0 &&
        (remainingCredits !== null && remainingCredits !== undefined) && (
          <p className="analyzer-error" role="status">
            This uses every remaining credit in your plan — there&apos;s no undo.
            Click again to confirm.
          </p>
        )}
    </form>
  );
}
