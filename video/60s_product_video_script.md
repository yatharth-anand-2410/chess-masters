# 60-Second Flagship Product Video Script: "From Blunder to Grandmaster Insight"

**Target Duration:** Exactly 60.0 Seconds  
**Format:** 16:9 Landscape (1920x1080) & 9:16 Vertical Short cut (1080x1920)  
**Music Bed:** Modern, rhythmic, upbeat lo-fi hip-hop / tech electronic beat with an assertive drop at 0:20.  
**Voiceover Tone:** Confident, knowledgeable, warm, mentor-like (Indian English or Global English).

---

## Storyboard & Script Table

| Time | Scene | Visual / Animation | On-Screen Text (Typography: Fraunces / Inter) | Voice-Over Narration (Word Count: 142 words) | Audio & Sound Design |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0:00 - 0:08** | **Scene 1: The Hook** | Close-up of a chessboard where White plays a natural-looking move (e.g. `14. Qxe4??`). An ominous red Stockfish eval bar drops from `+3.2` down to `-4.5`. | **"Why does raw engine analysis fail chess players?"** | *"Ever stared at a Stockfish evaluation of plus three point two... and had no idea what it actually means?"* | Soft, subtle tension drone. Sharp chess piece click. |
| **0:08 - 0:18** | **Scene 2: The Pain** | Split screen: Confused young player looking at raw engine numbers: `Centipawn loss: 148. Blunder: Nd5`. Quick red flashes on missed pins and forks. | **Stockfish gives numbers. You need coaching.** | *"Engines give cold numbers and computer lines no human would play. They don't teach you *why* you blundered, or how to fix it."* | Synth tick rhythm builds up. Disappointment buzz sound. |
| **0:18 - 0:28** | **Scene 3: The Reveal** | Smooth transition to the sleek dark/gold Chessmasters interface. User pastes a Lichess or Chess.com game link. Status badge streams: `Fetching game... Analyzing centipawn loss... Generating coaching report`. | **Meet Chessmasters. Paste any game link.** | *"Meet Chessmasters. Just paste your Lichess or Chess.com game. In fifteen seconds, our AI Grandmaster breaks down your match in plain English."* | Beat drop kicks in! Smooth whoosh as URL is pasted. Satisfying chime on stream start. |
| **0:28 - 0:40** | **Scene 4: The Core Report** | Fast, dynamic zoom into the 5 core sections: **Strengths** (green badge), **Weaknesses** (amber badge), **Turning Point** with interactive board arrow showing the blunder, and **Psychology** radar showing time trouble. | **• Narrative Strengths & Weaknesses<br>• Critical Turning Point Board<br>• Tilt & Time Trouble Detection** | *"Discover your exact strengths, your critical tactical blind spots, and the psychological moments where time trouble or tilt cost you the win."* | Rhythmic digital UI pulses, crisp card transition swooshes. |
| **0:40 - 0:50** | **Scene 5: Targeted Drills** | The report generates one-click practice links directly to Lichess tactical drills: *Deflection*, *Knight Fork*, *King Safety*. A cursor clicks a drill and the exact puzzle appears ready to solve. | **Instant Targeted Drills: Blunders → Mastery** | *"Best of all, Chessmasters turns your blunders into instant training drills. One click, and you're mastering the exact tactic you missed."* | Positive uplifting chord progression. Puzzle piece snap sound. |
| **0:50 - 1:00** | **Scene 6: The Outro / CTA** | Wide shot of the complete dashboard on desktop and phone. Premium gold typography shines: **Chessmasters**. URL displays clearly with a badge: *First 5 Analyses Free*. | **Stop guessing. Start improving.<br>chessmasters.in** | *"Stop guessing. Start mastering. Paste your first game free right now at chessmasters.in."* | Upbeat musical climax and clean acoustic reverb resolve. |

---

## Technical Scene Parameters for Showtime (`showtime.json`)

```json
{
  "title": "Chessmasters - 60s Launch Explainer",
  "aspect": "16:9",
  "fps": 30,
  "duration": 60.0,
  "theme": "dark",
  "scenes": [
    { "id": "hook", "duration": 8.0, "label": "The Engine Mystery" },
    { "id": "problem", "duration": 10.0, "label": "Cold Numbers vs Human Insight" },
    { "id": "solution", "duration": 10.0, "label": "Chessmasters 15s Stream" },
    { "id": "report_breakdown", "duration": 12.0, "label": "5 Core Coaching Insights" },
    { "id": "drills", "duration": 10.0, "label": "Direct Lichess Drill Generation" },
    { "id": "cta", "duration": 10.0, "label": "Call To Action & Free Trial" }
  ],
  "audio": {
    "voice": {
      "provider": "local",
      "model": "kokoro",
      "voice_id": "am_adam",
      "speed": 1.05
    },
    "music": {
      "bed": "lofi-beat-modern",
      "volume": 0.22,
      "duck_on_voice": true
    }
  }
}
```
