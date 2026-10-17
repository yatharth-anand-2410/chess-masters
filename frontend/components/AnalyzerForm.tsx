"use client";

import React, { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Plus, Trash2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { warmBackend } from "../lib/backend-wake";
import { cn } from "../lib/utils";
import { Button } from "./ui/Button";
import { Pill } from "./ui/Pill";

export type Platform = "lichess" | "chess.com";
export type PlayerColor = "white" | "black";

export type AnalysisRequest = {
  platform: Platform;
  gameUrl: string;
  username?: string;
  playerColor?: PlayerColor;
  /** Coach mode: run this analysis for one of the coach's students. */
  studentId?: string;
};

export type BatchGameInput = {
  gameUrl: string;
  playerColor?: PlayerColor;
};

export type BatchAnalysisRequest = {
  platform: Platform;
  username?: string;
  games: BatchGameInput[];
  /** Coach mode: run this batch for one of the coach's students. */
  studentId?: string;
};

type AnalyzerFormProps = {
  disabled?: boolean;
  maxGames?: number;
  /** Prefilled Chess.com username (e.g. the selected student's handle). */
  defaultUsername?: string;
  /** Coach mode: analyses submitted here are tagged to this student. */
  studentId?: string;
  onSubmit: (request: AnalysisRequest) => void;
  onSubmitBatch?: (request: BatchAnalysisRequest) => void;
};

export const MAX_BATCH_GAMES = 5;
export const PSYCHOLOGY_MIN_GAMES = 3;

type BatchRow = {
  id: number;
  url: string;
  color: PlayerColor | null;
};

/**
 * A blocking problem surfaced by submit. We keep the button live and explain
 * what's missing instead of disabling it silently (Lichess links frequently
 * arrive without /white or /black).
 */
type FormError =
  | { kind: "color"; rowId: number; index: number }
  | { kind: "username" };

function detectColorFromUrl(url: string): PlayerColor | null {
  const match = url.match(/\/(white|black)(?:[#?]|$)/i);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === "white" ? "white" : "black";
}

export default function AnalyzerForm({
  disabled,
  maxGames,
  defaultUsername,
  studentId,
  onSubmit,
  onSubmitBatch,
}: AnalyzerFormProps) {
  const rowLimit = Math.max(
    1,
    Math.min(maxGames ?? MAX_BATCH_GAMES, MAX_BATCH_GAMES)
  );
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [username, setUsername] = useState(defaultUsername ?? "");
  const [formError, setFormError] = useState<FormError | null>(null);
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
    }
  }, [defaultUsername]);

  useEffect(() => {
    setRows((current) =>
      current.length > rowLimit ? current.slice(0, rowLimit) : current
    );
  }, [rowLimit]);

  // The AI Coach drawer's "Open analyzer" action asks us to focus the URL field.
  useEffect(() => {
    const focusUrl = () => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Game 1 URL"]')
        ?.focus();
    };
    window.addEventListener("cm_focus_analyzer_url", focusUrl);
    return () => window.removeEventListener("cm_focus_analyzer_url", focusUrl);
  }, []);

  // Once the blocking problem is fixed, retire the message that called it out.
  useEffect(() => {
    if (!formError) {
      return;
    }
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

  const handlePlatformChange = (next: Platform) => {
    setPlatform(next);
    setFormError(null);
    if (next === "lichess") {
      setRows((current) =>
        current.map((row) => {
          const detected = detectColorFromUrl(row.url);
          return detected ? { ...row, color: detected } : row;
        })
      );
    }
  };

  /** Tabs move with the arrow keys, as a tablist should. */
  const handlePlatformKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next: Platform = platform === "lichess" ? "chess.com" : "lichess";
    handlePlatformChange(next);
    (next === "lichess" ? lichessTabRef : chesscomTabRef).current?.focus();
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
  };

  const updateRowColor = (id: number, color: PlayerColor) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, color } : row))
    );
  };

  /** Arrow keys move between the two chips, as a radiogroup should. */
  const handleColorKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    rowId: number,
    current: PlayerColor | null
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next: PlayerColor = current === "white" ? "black" : "white";
    updateRowColor(rowId, next);
    colorGroupRefs.current
      .get(rowId)
      ?.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)
      ?.focus();
  };

  const addRow = () => {
    setRows((current) => {
      if (current.length >= rowLimit) {
        return current;
      }
      const id = nextRowId.current;
      nextRowId.current += 1;
      return [...current, { id, url: "", color: null }];
    });
  };

  const removeRow = (id: number) => {
    setRows((current) => {
      if (current.length <= 1) {
        return current;
      }
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
    handlePlatformChange("lichess");
    warmBackend();
    setRows([{ id: 1, url: "https://lichess.org/zR8HRccT/white", color: "white" }]);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    const games: BatchGameInput[] = rows
      .map((row) => ({
        gameUrl: row.url.trim(),
        playerColor:
          platform === "lichess" ? row.color ?? undefined : undefined,
      }))
      .filter((game) => game.gameUrl);
    if (games.length === 0) {
      return;
    }

    // Never fail silently: name the missing side and move focus to the control
    // that fixes it, instead of leaving a dead button with no explanation.
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

  const validGames = rows.filter((row) => row.url.trim());
  const multiGame = validGames.length > 1;
  const psychologyUnlocked = validGames.length >= PSYCHOLOGY_MIN_GAMES;
  const gamesToPsychology = Math.max(
    PSYCHOLOGY_MIN_GAMES - validGames.length,
    0
  );
  const psychologyHintAvailable = rowLimit >= PSYCHOLOGY_MIN_GAMES;
  // The missing side / username is surfaced on submit (handleSubmit) rather
  // than disabling the button without a reason.
  const submitDisabled =
    disabled ||
    validGames.length === 0 ||
    (multiGame && !onSubmitBatch);

  return (
    <form className="analyzer-form" onSubmit={handleSubmit}>
      {/* Platform Switch with spring sliding indicator */}
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
            "tap-hit-y relative z-10 flex-1 py-1.5 px-4 text-xs sm:text-sm font-medium rounded-full transition-colors cursor-pointer text-center",
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
            "tap-hit-y relative z-10 flex-1 py-1.5 px-4 text-xs sm:text-sm font-medium rounded-full transition-colors cursor-pointer text-center",
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

      <div
        role="tabpanel"
        id="platform-panel"
        aria-labelledby={
          platform === "lichess" ? "platform-tab-lichess" : "platform-tab-chesscom"
        }
      >

      {platform === "chess.com" && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="field"
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
          {/* Pilot 1-Click Sample Game Pill */}
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
                <span className="game-row-index text-xs font-mono text-[var(--text-muted)] shrink-0 w-4 text-center" aria-hidden="true">
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
                    placeholder={
                      platform === "lichess"
                        ? "https://lichess.org/abc12345"
                        : "https://www.chess.com/game/live/123456789"
                    }
                    disabled={disabled}
                    aria-label={`Game ${index + 1} URL`}
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
            {validGames.length === 0
              ? `Up to ${rowLimit} games per run · 1 analysis each`
              : `${validGames.length} of ${rowLimit} games · 1 analysis each`}
          </span>
        </div>

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
      </div>

      <button type="submit" className="btn" disabled={submitDisabled}>
        {disabled
          ? "Analyzing..."
          : multiGame
            ? `Analyze ${validGames.length} games`
            : "Analyze game"}
      </button>
    </form>
  );
}
