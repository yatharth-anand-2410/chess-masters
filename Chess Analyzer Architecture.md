# Real-Time Analytics Streaming Architecture

To create an engaging user experience, the analyzer should not make the user wait 10-15 seconds staring at a static loading spinner. Instead, we will use **Server-Sent Events (SSE)** to stream backend processing states to the UI in real-time, followed by streaming the actual Gemini AI text generation chunk-by-chunk. 

Because we want the final output to support graphics (like Evaluation charts or board visuals), Gemini will stream **Markdown**, which the frontend will parse and render dynamically.

## 1. The Data Flow (Backend to Frontend)

We will transition the backend endpoint from a standard REST `POST` to an SSE stream endpoint.

### Event Sequence:
1. **`status_update`**: "Extracting Game PGN..."
2. **`status_update`**: "Running Stockfish Engine Evaluation..." (passes engine data to Gemini)
3. **`status_update`**: "AI generating coaching report..."
4. **`content_chunk`**: Streams the generated Markdown tokens from Gemini in real-time.
5. **`done`**: Closes the connection.

## 2. Backend Implementation (Python FastAPI)

Use FastAPI's `StreamingResponse` to push events to the client. We configure the Gemini API call to use `stream=True`.

```python
import os
import asyncio
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from google import genai

app = FastAPI()
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

async def analyze_game_stream(pgn: str, engine_data: dict):
    # 1. Yield Initial Status
    yield "event: status\ndata: Extracting Game Data...\n\n"
    await asyncio.sleep(0.5)
    
    yield "event: status\ndata: Running Engine Evaluation...\n\n"
    await asyncio.sleep(0.5)

    yield "event: status\ndata: AI Generating Coaching Report...\n\n"

    # 2. Setup Gemini Streaming
    system_instruction = """
    You are an expert chess coach. Analyze the PGN. 
    Output your response entirely in Markdown. 
    Use the headings: ## Strength, ## Weakness, ## Game Overview, ## Focus Areas, ## Resources.
    If you want to render an evaluation graph, use this custom markdown component: 
    <EvalChart data="[0.5, -1.0, 3.2, 4.0]"/>
    """

    # 3. Stream the chunks directly to the frontend
    response = client.models.generate_content_stream(
        model='gemini-1.5-flash',
        contents=f"Analyze this game:\n\n{pgn}\n\nEngine Data:\n{engine_data}",
        config={"system_instruction": system_instruction}
    )

    for chunk in response:
        # Sanitize newlines for SSE formatting
        safe_chunk = chunk.text.replace('\\n', '\\\\n') 
        yield f"event: chunk\ndata: {safe_chunk}\n\n"

    yield "event: done\ndata: {}\n\n"

@app.get("/api/stream-analysis")
async def stream_analysis(url: str):
    # Fetch PGN and Engine data here...
    pgn = "1. e4 e5..." 
    engine_data = "{}" 
    return StreamingResponse(analyze_game_stream(pgn, engine_data), media_type="text/event-stream")