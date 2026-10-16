# Web App Explainer Videos: 3 Short Videos for Product Understanding

These 3 bite-sized videos (15–30 seconds each) are designed specifically for embedding directly inside the Chessmasters web application. They guide new users, eliminate friction, increase analysis completion rates, and drive paid conversions.

---

## Video 1: "Quick Start: Analyze in 15 Seconds"
* **Duration:** 18 seconds  
* **Format:** 16:9 Landscape (or 4:3 compact) with optional mute + autoloop.  
* **UI Placement:** Inside `AnalyzerForm.tsx` (next to the input box as a small "See How It Works" button) or as a lightweight hero preview modal on the Landing Page.

### Storyboard & Voiceover
| Timestamp | Visual Action | On-Screen Badge | Voiceover (43 words) |
| :--- | :--- | :--- | :--- |
| **0:00 - 0:05** | Browser tab showing a completed game on Lichess or Chess.com. Mouse copies the game link (`Ctrl+C`). | **Step 1: Copy Game Link** | *"Finished a game on Chess.com or Lichess? Just copy your game URL."* |
| **0:05 - 0:11** | User toggles the platform button on Chessmasters, pastes the link (`Ctrl+V`), and clicks **"Analyze Game"**. | **Step 2: Paste & Stream** | *"Paste it into Chessmasters. Select your player color and hit Analyze."* |
| **0:11 - 0:18** | SSE stream lights up: `status_update` badges flash, Stockfish calculates, and Gemini streams the full Grandmaster report in real time. | **Step 3: Instant Grandmaster Coaching** | *"In fifteen seconds, your personalized Grandmaster coaching report streams live onto your screen. No waiting. No confusion."* |

---

## Video 2: "Decoding Your AI Coaching Report"
* **Duration:** 28 seconds  
* **Format:** 16:9 Landscape with close-up UI crops.  
* **UI Placement:** In the top header bar of `CoachingReport.tsx` as a "💡 How to read this report" tooltip/modal for first-time users.

### Storyboard & Voiceover
| Timestamp | Visual Action | On-Screen Badge | Voiceover (66 words) |
| :--- | :--- | :--- | :--- |
| **0:00 - 0:07** | Smooth vertical scroll revealing the 5 sections of the streamed report. | **Coaching in Plain English** | *"Your Chessmasters report is designed like a private one-on-one lesson with a Grandmaster, not a spreadsheet of numbers."* |
| **0:07 - 0:14** | Zoom in on **Strengths** (green pill) and **Weaknesses** (amber pill) showing specific tactical motifs. | **Named Tactical Motifs** | *"First, see what you executed brilliantly, and uncover the exact positional mistakes that held you back."* |
| **0:14 - 0:21** | The **Critical Position Board** appears: an interactive chessboard with a glowing red arrow on move 22. | **Interactive Turning Point** | *"Next, the Turning Point board highlights the single move that flipped the game, complete with tactical arrows."* |
| **0:21 - 0:28** | The **Psychology Radar** animates: displaying time management, tilt factor, and rushing speed. | **Psychology & Tilt Radar** | *"Finally, check your Psychology Radar to see if time trouble or overconfidence caused the slip."* |

---

## Video 3: "Closing Your Blind Spots: Instant Drills"
* **Duration:** 22 seconds  
* **Format:** 16:9 Landscape / Responsive.  
* **UI Placement:** Directly above `DrillSection.tsx` or `DrillBoard.tsx`.

### Storyboard & Voiceover
| Timestamp | Visual Action | On-Screen Badge | Voiceover (52 words) |
| :--- | :--- | :--- | :--- |
| **0:00 - 0:06** | Close-up of a blunder card in the report: `Blunder on move 18: Missed royal pin on d4`. | **Identify The Mistake** | *"Most players make the same tactical mistakes game after game because they never train them."* |
| **0:06 - 0:14** | Below the weakness, the **Targeted Drills** card generates: *Lichess Training Slug: Pin & Skewer*. Cursor clicks the button. | **Direct Lichess Drill Integration** | *"Chessmasters automatically turns your blunders into targeted training. Click the drill button..."* |
| **0:14 - 0:22** | Screen transitions smoothly to the live puzzle on Lichess solving the exact motif. | **Practice & Never Blunder It Again** | *"...and you're instantly solving real puzzles with that exact motif on Lichess. Turn your worst blunders into your strongest weapons."* |

---

## Frontend Integration Code (Next.js / React)

Here is a lightweight, accessible component pattern to drop these explainer video players into your Next.js application without slowing down initial page loads:

```tsx
// frontend/components/ui/ExplainerVideoModal.tsx
'use client';

import React, { useState } from 'react';
import { Play, X } from 'lucide-react';

interface ExplainerVideoModalProps {
  title: string;
  videoSrc: string; // e.g. "/videos/quick-start-demo.mp4"
  posterSrc?: string;
  buttonLabel?: string;
}

export function ExplainerVideoModal({
  title,
  videoSrc,
  posterSrc,
  buttonLabel = "Watch 20s Demo"
}: ExplainerVideoModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg hover:bg-amber-900/40 transition-colors"
      >
        <Play className="w-3.5 h-3.5 fill-amber-300" />
        <span>{buttonLabel}</span>
      </button>

      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="aspect-video w-full bg-black">
              <video
                src={videoSrc}
                poster={posterSrc}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```
