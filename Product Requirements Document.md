# Product Requirements Document (PRD): AI Chess Game Analyzer

## 1. Product Overview
The AI Chess Game Analyzer is a web-based application that allows users to paste a link to a chess game from Lichess or Chess.com and receive a comprehensive, AI-generated coaching report. The application utilizes the Gemini API to analyze the game's PGN (Portable Game Notation) and provides targeted feedback, including strengths, weaknesses, Lichess study resources, and specific chapter recommendations from Jeremy Silman's *How to Reassess Your Chess*.

## 2. Target Audience
*   Beginner to intermediate chess players (Elo 800–1800) looking to improve their positional understanding.
*   Players seeking immediate, narrative feedback on their games rather than relying solely on abstract engine evaluation numbers.

## 3. Core Features & Deliverables
Upon successful analysis, the user will be presented with a dashboard containing:
1.  **Strength:** Identification of what the player did well (e.g., solid opening principles, good space advantage).
2.  **Weakness:** The primary positional or tactical flaw that cost the player the game or an advantage.
3.  **Game Evaluation Overview:** A narrative summary of the game's momentum shifts and critical turning points.
4.  **Specific Focus Areas:** Actionable concepts the player consistently missed.
5.  **Resources to Improve:** Direct links to `lichess.org/practice` or `lichess.org/study` relevant to the identified weaknesses.
6.  **Book Recommendation:** An exact chapter/section mapping from Jeremy Silman's *How to Reassess Your Chess* addressing the user's core weakness.

---

## 4. System Architecture & Flow

<GenerateWidget type="inline_visualization" height="600px">
<skills>diagram</skills>

**Idea:** Visualize the architecture and data flow of the AI Chess Game Analyzer.
**Visual type:** Flowchart diagram.
**Data specification:**
- **Data structure:** nodes and directed edges.
- **Initial values:** 
  Nodes: User Interface (Frontend), API Gateway / Backend, Platform Router, Lichess Extractor, Chess.com Extractor, PGN Data, Gemini AI Service, Output JSON.
  Edges:
  - User Interface -> API Gateway / Backend : Submits Platform, URL, (Username)
  - API Gateway / Backend -> Platform Router : Routes Request
  - Platform Router -> Lichess Extractor : If Platform = Lichess
  - Platform Router -> Chess.com Extractor : If Platform = Chess.com
  - Lichess Extractor -> PGN Data : Returns PGN
  - Chess.com Extractor -> PGN Data : Returns PGN
  - PGN Data -> Gemini AI Service : Sends PGN + System Prompt
  - Gemini AI Service -> Output JSON : Generates structured coaching report
  - Output JSON -> User Interface (Frontend) : Renders Dashboard
- **Mapping:** Draw nodes and connect them with directed edges based on the flow above. Group Extractors under a "Game Fetching Service" boundary.
**User controls:** None.
**Interactivity:** Hovering over a node highlights its incoming and outgoing connections.
**Animation:** None.
</GenerateWidget>

### 4.1. User Flow (Frontend)
1.  **Landing Page:** User selects the platform via a toggle button (`Lichess` | `Chess.com`).
2.  **Input Form:**
    *   **If Lichess:** User inputs `Game URL`.
    *   **If Chess.com:** User inputs `Username` AND `Game URL`.
3.  **Submission:** User clicks "Analyze Game". The frontend displays a loading state.
4.  **Results:** The backend returns the structured JSON report, which the frontend renders into easy-to-read dashboard cards.

---

## 5. API & Backend Mechanics (Game Fetching)

The backend acts as an intermediary, handling URL parsing, platform routing, data fetching, and Gemini API communication.

### 5.1 API Endpoints (Internal Backend)

`POST /api/analyze`
*   **Description:** Initiates the game fetch and analysis process.
*   **Request Payload:**
    ```json
    {
      "platform": "lichess" | "chess.com",
      "gameUrl": "string",
      "username": "string" // Optional, required only for chess.com
    }
    ```
*   **Response Payload (Success - 200 OK):**
    ```json
    {
      "strength": "string",
      "weakness": "string",
      "evaluation_overview": "string",
      "specific_focus_areas": "string",
      "resources_to_improve": "string (URL)",
      "book_recommendation": "string"
    }
    ```

### 5.2. Game Fetching Mechanic (Logic & Flow)

The backend implements a `Platform Router` that directs the extraction logic based on the requested platform.

#### Flow A: Lichess Extraction
1.  **Regex Parsing:** Extract the 8-character `gameId` from the provided URL.
    *   *Regex:* `lichess\.org\/([a-zA-Z0-9]{8})`
2.  **API Call:** Execute a `GET` request to Lichess's public export API.
    *   *Endpoint:* `https://lichess.org/game/export/{gameId}?evals=true`
    *   *Headers:* Include a descriptive `User-Agent`.
3.  **Validation:** Ensure HTTP 200 response and extract the returned PGN text.

#### Flow B: Chess.com Extraction (The "Archive Scan" Method)
*Constraint: Chess.com does not offer a public API endpoint to fetch a single game by ID. To avoid Cloudflare scraping blocks, we utilize the public Archives API.*

1.  **Regex Parsing:** Extract the numeric `gameId` from the end of the provided URL.
    *   *Regex:* `(\d+)$`
2.  **Fetch Archives List:** Execute a `GET` request to retrieve the list of the user's monthly archive URLs.
    *   *Endpoint:* `https://api.chess.com/pub/player/{username}/games/archives`
    *   *Headers:* Include a descriptive `User-Agent`.
3.  **Reverse Iteration (Recent First):** Reverse the list of archive URLs (to start with the current month). Limit the search to the last 3–4 months to optimize performance and prevent rate limiting.
4.  **Scan Month Data:** For each month URL:
    *   Execute a `GET` request.
    *   Iterate through the returned `games` array.
    *   Compare each `game["url"]` against the target `gameId`.
5.  **Extraction:** If a match is found, extract the `pgn` string from that game object and terminate the loop. If no match is found after scanning the recent months, return an error.

### 5.3. PGN Pre-Processing
Before sending the PGN to the Gemini API, the backend should perform lightweight cleanup to reduce token count and potential hallucinations:
*   Use regex (`re.sub(r'\{.*?\}', '', pgn)`) to strip clock times (e.g., `[%clk 0:15:00]`) if engine evaluations are not required for the specific prompt.

## 6. Error Handling
*   **Invalid URL/Username:** Return HTTP 400 with a specific message.
*   **Game Not Found:** Return HTTP 404 (common if a Chess.com game is older than the scanned archive months).
*   **External API Rate Limit (Chess.com/Lichess):** Return HTTP 429.
*   **Gemini API Failure:** Return HTTP 500 with a fallback message.