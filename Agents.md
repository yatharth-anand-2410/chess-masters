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

## Lichess Study Library (curated studies & tactics)
*   **Two layers, no database.** `backend/data/study_library.json` is the hand-curated overlay (which motif or coach group each study teaches, order, hidden, titles as a fallback). Lichess itself is the content layer: `GET /api/study/by/{owner}` returns every study the account owns in one request, private and unlisted included, cached in memory. Nothing about the library is ever persisted.
*   **Vocabulary.** `backend/data/lichess_themes.json` is the only vocabulary the app may speak: every slug there exists at `lichess.org/training/<slug>`. Coach-made groups (Weak Squares, Happy Pieces, Mate Patterns, …) are declared in the overlay with no external link. A study that matches neither is *unfiled* — never silently dropped, never given a link on a guess.
*   **Maintenance.** `scripts/sync_study_library.py` refreshes titles and reports new studies to file. It never overwrites a curation decision and never deletes an entry Lichess stops returning.
*   **Access.** `LICHESS_TOKEN` (scope `study:read`) lives server-side only and must never reach the browser bundle. Reading a study through `/api/studies/import/{id}` requires a signed-in account; a free tier opens `LIBRARY_FREE_STUDY_LIMIT` studies (chosen from the caller's own leaks) and gets HTTP 402 with `feature: "studies"` for the rest. Signed-out callers get no library data at all — no titles, no ids.
*   **Chapter honesty.** A chapter is one of: a puzzle (moves stored → drillable), a lesson (position + author's comment), or a bare position (nothing stored → shown as a diagram, never as a drill with an invented answer).

## Coding Conventions
*   Write clean, modular Python with strict type hinting.
*   Keep the FastAPI SSE logic isolated from the external API fetching logic.
*   Use functional React components with Hooks.
*   The backend suite runs offline: `backend/tests/conftest.py` refuses outbound HTTP and hides any local `LICHESS_TOKEN`. Patch the transport a test needs, or run with `LIVE_TESTS=1` for the three deliberate live smoke tests.