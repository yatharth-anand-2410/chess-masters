"use client";

import { useEffect, useRef, useState } from "react";

export type Platform = "lichess" | "chess.com";
export type PlayerColor = "white" | "black";

export type AnalysisRequest = {
  platform: Platform;
  gameUrl: string;
  username?: string;
  playerColor?: PlayerColor;
};

export type BatchGameInput = {
  gameUrl: string;
  playerColor?: PlayerColor;
};

export type BatchAnalysisRequest = {
  platform: Platform;
  username?: string;
  games: BatchGameInput[];
};

type AnalyzerFormProps = {
  disabled?: boolean;
  maxGames?: number;
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
  onSubmit,
  onSubmitBatch,
}: AnalyzerFormProps) {
  const rowLimit = Math.max(
    1,
    Math.min(maxGames ?? MAX_BATCH_GAMES, MAX_BATCH_GAMES)
  );
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [username, setUsername] = useState("");
  const nextRowId = useRef(2);
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const [rows, setRows] = useState<BatchRow[]>([
    { id: 1, url: "", color: null },
  ]);

  useEffect(() => {
    setRows((current) =>
      current.length > rowLimit ? current.slice(0, rowLimit) : current
    );
  }, [rowLimit]);

  const handlePlatformChange = (next: Platform) => {
    setPlatform(next);
    if (next === "lichess") {
      setRows((current) =>
        current.map((row) => {
          const detected = detectColorFromUrl(row.url);
          return detected ? { ...row, color: detected } : row;
        })
      );
    }
  };

  const updateRowUrl = (id: number, value: string) => {
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
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        updateRowUrl(id, text.trim());
        return;
      }
    } catch {
      // Clipboard permission denied; fall back to manual paste.
    }
    const input = inputRefs.current.get(id);
    input?.focus();
    input?.select();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
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
    if (games.length === 1) {
      onSubmit({
        platform,
        gameUrl: games[0].gameUrl,
        username: platform === "chess.com" ? username.trim() : undefined,
        playerColor: games[0].playerColor,
      });
      return;
    }
    if (!onSubmitBatch) {
      return;
    }
    onSubmitBatch({
      platform,
      username: platform === "chess.com" ? username.trim() : undefined,
      games,
    });
  };

  const validGames = rows.filter((row) => row.url.trim());
  const colorReady =
    platform !== "lichess" || validGames.every((row) => row.color !== null);
  const usernameReady = platform !== "chess.com" || Boolean(username.trim());
  const multiGame = validGames.length > 1;
  const psychologyUnlocked = validGames.length >= PSYCHOLOGY_MIN_GAMES;
  const gamesToPsychology = Math.max(
    PSYCHOLOGY_MIN_GAMES - validGames.length,
    0
  );
  const psychologyHintAvailable = rowLimit >= PSYCHOLOGY_MIN_GAMES;
  const submitDisabled =
    disabled ||
    validGames.length === 0 ||
    !colorReady ||
    !usernameReady ||
    (multiGame && !onSubmitBatch);

  return (
    <form className="analyzer-form" onSubmit={handleSubmit}>
      <div className="platform-toggle" role="group" aria-label="Chess platform">
        <button
          type="button"
          className={platform === "lichess" ? "toggle active" : "toggle"}
          onClick={() => handlePlatformChange("lichess")}
          disabled={disabled}
        >
          Lichess
        </button>
        <button
          type="button"
          className={platform === "chess.com" ? "toggle active" : "toggle"}
          onClick={() => handlePlatformChange("chess.com")}
          disabled={disabled}
        >
          Chess.com
        </button>
      </div>

      {platform === "chess.com" && (
        <label className="field">
          <span>Chess.com Username</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. magnuscarlsen"
            required
            disabled={disabled}
          />
        </label>
      )}

      <div className="field">
        <span>{rows.length > 1 ? "Game links" : "Game URL"}</span>
        <div className="game-rows">
          {rows.map((row, index) => (
            <div className="game-row" key={row.id}>
              <span className="game-row-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="game-row-field">
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
                  className="game-row-color"
                  role="group"
                  aria-label={`Color played in game ${index + 1}`}
                >
                  <button
                    type="button"
                    className={
                      row.color === "white" ? "color-chip active" : "color-chip"
                    }
                    onClick={() => updateRowColor(row.id, "white")}
                    disabled={disabled}
                    title="I played White"
                  >
                    W
                  </button>
                  <button
                    type="button"
                    className={
                      row.color === "black" ? "color-chip active" : "color-chip"
                    }
                    onClick={() => updateRowColor(row.id, "black")}
                    disabled={disabled}
                    title="I played Black"
                  >
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
            </div>
          ))}
        </div>
        <div className="game-rows-footer">
          <button
            type="button"
            className="add-game"
            onClick={addRow}
            disabled={disabled || rows.length >= rowLimit}
          >
            + Add another game
          </button>
          <span className="game-rows-hint">
            {validGames.length} of {rowLimit} games · 1 credit per game
          </span>
        </div>
        {psychologyHintAvailable && (
          <p
            className={`psych-unlock${psychologyUnlocked ? " unlocked" : ""}`}
            aria-live="polite"
          >
            {psychologyUnlocked ? (
              <>
                <span className="psych-unlock-badge">Unlocked</span>
                Psychology profile — your report includes a mental-game
                breakdown.
              </>
            ) : (
              <>
                Add {gamesToPsychology} more{" "}
                {gamesToPsychology === 1 ? "game" : "games"} to unlock the
                Psychology profile.
              </>
            )}
          </p>
        )}
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
