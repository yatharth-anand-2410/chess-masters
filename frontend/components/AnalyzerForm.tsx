"use client";

import { useState } from "react";

export type Platform = "lichess" | "chess.com";
export type PlayerColor = "white" | "black";

export type AnalysisRequest = {
  platform: Platform;
  gameUrl: string;
  username?: string;
  playerColor?: PlayerColor;
};

type AnalyzerFormProps = {
  disabled?: boolean;
  onSubmit: (request: AnalysisRequest) => void;
};

function detectColorFromUrl(url: string): PlayerColor | null {
  const match = url.match(/\/(white|black)(?:[#?]|$)/i);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === "white" ? "white" : "black";
}

export default function AnalyzerForm({ disabled, onSubmit }: AnalyzerFormProps) {
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [gameUrl, setGameUrl] = useState("");
  const [username, setUsername] = useState("");
  const [playerColor, setPlayerColor] = useState<PlayerColor | null>(null);

  const handlePlatformChange = (next: Platform) => {
    setPlatform(next);
    if (next === "lichess") {
      setPlayerColor(detectColorFromUrl(gameUrl));
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({
      platform,
      gameUrl: gameUrl.trim(),
      username: platform === "chess.com" ? username.trim() : undefined,
      playerColor: platform === "lichess" ? playerColor ?? undefined : undefined,
    });
  };

  const submitDisabled =
    disabled ||
    !gameUrl.trim() ||
    (platform === "lichess" && !playerColor);

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

      <button type="submit" className="btn" disabled={submitDisabled}>
        {disabled ? "Analyzing..." : "Analyze Game"}
      </button>
    </form>
  );
}