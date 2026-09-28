# Project Overview: AI Chess Game Analyzer
We are building a full-stack web application that allows users to paste a chess game link (Lichess or Chess.com) and receive a real-time, AI-generated coaching report. 

## System Architecture
*   **Backend:** Python 3.11+, FastAPI, `python-chess` (for Stockfish integration), and the modern `google-genai` SDK.
*   **Frontend:** React / Next.js, `react-markdown` (for rendering streamed markdown and custom UI components like `<EvalChart>`).
*   **AI/LLM:** Google Gemini 1.5 Flash via Server-Sent Events (SSE).

## Backend Mechanics
1.  **Game Extraction:**
    *   **Lichess:** Extract the 8-character ID from the URL -> `GET https://lichess.org/game/export/{gameId}?evals=true`
    *   **Chess.com:** Use the provided username -> `GET https://api.chess.com/pub/player/{username}/games/archives` -> iterate backwards through the last 3 months to find the URL match.
2.  **Engine Enrichment:** Parse the PGN with Stockfish to identify centipawn loss and major blunders. 
3.  **Gemini AI Streaming:** Pass the PGN, player color, and engine data into Gemini. Prompt Gemini to return a Markdown-formatted report covering 5 sections: Strength, Weakness, Game Overview, Focus Areas, and Resources.
4.  **Resource URL Constraints:** Gemini must map weaknesses to strict Lichess slugs (e.g., `https://lichess.org/training/fork`, `https://lichess.org/training/pin`, `https://lichess.org/training/deflection`) or generate study search URLs (`https://lichess.org/study/search?q=Concept`).

## Frontend Mechanics
1.  **Form Input:** A toggle for Lichess vs. Chess.com. If Lichess -> ask for URL. If Chess.com -> ask for Username + URL.
2.  **SSE Streaming:** Use `EventSource` to listen to the backend `/api/stream-analysis` endpoint. 
3.  **Real-Time Rendering:** Display `status_update` events as UI loading badges, and pass `content_chunk` events into `react-markdown` to stream the text onto the screen.

## Coding Conventions
*   Write clean, modular Python with strict type hinting.
*   Keep the FastAPI SSE logic isolated from the external API fetching logic.
*   Use functional React components with Hooks.