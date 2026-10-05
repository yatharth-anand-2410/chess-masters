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
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [gameUrl, setGameUrl] = useState("");
  const [username, setUsername] = useState("");
  const [playerColor, setPlayerColor] = useState<PlayerColor | null>(null);
  const nextRowId = useRef(2);
  const [rows, setRows] = useState<BatchRow[]>([
    { id: 1, url: "", color: null },
  ]);

  useEffect(() => {
    if (rowLimit < 2 && mode === "multiple") {
      setMode("single");
    }
  }, [rowLimit, mode]);

  useEffect(() => {
    setRows((current) =>
      current.length > rowLimit ? current.slice(0, rowLimit) : current
    );
  }, [rowLimit]);

  const handlePlatformChange = (next: Platform) => {
    setPlatform(next);
    if (next === "lichess") {
      setPlayerColor(detectColorFromUrl(gameUrl));
      setRows((current) =>
        current.map((row) => {
          const detected = detectColorFromUrl(row.url);
          return detected ? { ...row, color: detected } : row;
        })
      );
    }
  };

  const handleGameUrlChange = (value: string) => {
    setGameUrl(value);
    if (platform === "lichess") {
      const detected = detectColorFromUrl(value);
      if (detected) {
        setPlayerColor(detected);
      }
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "multiple") {
      const games: BatchGameInput[] = rows
        .map((row) => ({
          gameUrl: row.url.trim(),
          playerColor:
            platform === "lichess" ? row.color ?? undefined : undefined,
        }))
        .filter((game) => game.gameUrl);
      if (games.length < 2 || !onSubmitBatch) {
        return;
      }
      onSubmitBatch({
        platform,
        username: platform === "chess.com" ? username.trim() : undefined,
        games,
      });
      return;
    }
    onSubmit({
      platform,
      gameUrl: gameUrl.trim(),
      username: platform === "chess.com" ? username.trim() : undefined,
      playerColor: platform === "lichess" ? playerColor ?? undefined : undefined,
    });
  };

  const validBatchGames = rows.filter((row) => row.url.trim());
  const batchColorReady =
    platform !== "lichess" ||
    validBatchGames.every((row) => row.color !== null);
  const batchUsernameReady =
    platform !== "chess.com" || Boolean(username.trim());
  const batchDisabled =
    disabled ||
    validBatchGames.length < 2 ||
    !batchColorReady ||
    !batchUsernameReady ||
    !onSubmitBatch;

  const singleDisabled =
    disabled || !gameUrl.trim() || (platform === "lichess" && !playerColor);

  const submitDisabled = mode === "multiple" ? batchDisabled : singleDisabled;

  return (
    <form className="analyzer-form" onSubmit={handleSubmit}>
      <div className="platform-toggle" role="group" aria-label="Analysis mode">
        <button
          type="button"
          className={mode === "single" ? "toggle active" : "toggle"}
          onClick={() => setMode("single")}
          disabled={disabled}
        >
          Single game
        </button>
        <button
          type="button"
          className={mode === "multiple" ? "toggle active" : "toggle"}
          onClick={() => setMode("multiple")}
          disabled={disabled || rowLimit < 2}
          title={
            rowLimit < 2
              ? "You need at least 2 analysis credits for a multi-game report."
              : undefined
          }
        >
          Multiple games
        </button>
      </div>

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

      {mode === "single" ? (
        <>
          {platform === "lichess" && (
            <div className="field">
              <span>I played</span>
              <div className="platform-toggle" role="group" aria-label="Your color">
                <button
                  type="button"
                  className={playerColor === "white" ? "toggle active" : "toggle"}
                  onClick={() => setPlayerColor("white")}
                  disabled={disabled}
                >
                  White
                </button>
                <button
                  type="button"
                  className={playerColor === "black" ? "toggle active" : "toggle"}
                  onClick={() => setPlayerColor("black")}
                  disabled={disabled}
                >
                  Black
                </button>
              </div>
            </div>
          )}

          <label className="field">
            <span>Game URL</span>
            <input
              type="url"
              value={gameUrl}
              onChange={(event) => handleGameUrlChange(event.target.value)}
              placeholder={
                platform === "lichess"
                  ? "https://lichess.org/abc12345"
                  : "https://www.chess.com/game/live/123456789"
              }
              required
              disabled={disabled}
            />
          </label>
        </>
      ) : (
        <div className="field">
          <span>Game links</span>
          <div className="game-rows">
            {rows.map((row, index) => (
              <div className="game-row" key={row.id}>
                <span className="game-row-index" aria-hidden="true">
                  {index + 1}
                </span>
                <input
                  type="url"
                  value={row.url}
                  onChange={(event) => updateRowUrl(row.id, event.target.value)}
                  placeholder={
                    platform === "lichess"
                      ? "https://lichess.org/abc12345"
                      : "https://www.chess.com/game/live/123456789"
                  }
                  disabled={disabled}
                  aria-label={`Game ${index + 1} URL`}
                />
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
              {validBatchGames.length} of {rowLimit} games · 1 credit per game
            </span>
          </div>
        </div>
      )}

      <button type="submit" className="btn" disabled={submitDisabled}>
        {disabled
          ? "Analyzing..."
          : mode === "multiple"
            ? `Analyze ${validBatchGames.length} games`
            : "Analyze game"}
      </button>
    </form>
  );
}
