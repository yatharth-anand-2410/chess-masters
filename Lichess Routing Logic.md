# Exhaustive Lichess Puzzle Themes Directory

This document contains the complete taxonomy of Lichess puzzle themes. Feed this list to your LLM system prompt to ensure it generates deterministic, mathematically valid URLs for the `resources_to_improve` array.

**Base URL Pattern:** `https://lichess.org/training/{slug}`

## 1. Tactical Motifs (Foundational)
Immediate tactical operations designed to win material or force a concession.

| Theme Name | Slug | Description |
| :--- | :--- | :--- |
| **Advantage** | `advantage` | Seizing a decisive material or positional advantage. |
| **Capturing Defender** | `capturingDefender` | Removing a piece that is defending another piece or critical square. |
| **Discovered Attack** | `discoveredAttack` | Moving a piece to unveil an attack by a long-range piece behind it. |
| **Double Check** | `doubleCheck` | Checking the king with two pieces at once, forcing a king move. |
| **En Passant** | `enPassant` | A tactic involving the en passant pawn capture rule. |
| **Fork** | `fork` | A single piece simultaneously attacking two or more enemy pieces. |
| **Hanging Piece** | `hangingPiece` | Identifying and capturing a completely undefended piece. |
| **Pin** | `pin` | Attacking a piece that cannot move without exposing a more valuable piece. |
| **Skewer** | `skewer` | Attacking a valuable piece, forcing it to move and exposing a lesser piece. |
| **Trapped Piece** | `trappedPiece` | A piece is cut off from escape and will be captured. |
| **X-Ray Attack** | `xRayAttack` | A piece attacks a square or piece through another piece. |

## 2. Advanced Tactics & Positional Mastery
Complex operations involving sacrifices, positional manipulation, and precise calculation.

| Theme Name | Slug | Description |
| :--- | :--- | :--- |
| **Advanced Pawn** | `advancedPawn` | Tactics revolving around pushing or utilizing a deeply advanced passed pawn. |
| **Attraction** | `attraction` | Sacrificing to force an enemy piece (often the king) onto a fatal square. |
| **Clearance** | `clearance` | Vacating a square, file, or diagonal to open a path for another piece. |
| **Castling** | `castling` | Tactics that involve castling to safety or exploiting the opponent's castling. |
| **Defensive Move** | `defensiveMove` | Finding the only precise sequence to survive or hold a draw. |
| **Deflection** | `deflection` | Forcing an enemy piece to move away from its defensive duties (overloading). |
| **Equality** | `equality` | Finding a critical sequence to equalize a worse position or secure a draw. |
| **Interference** | `interference` | Placing a piece between two enemy pieces to break their coordination/defense. |
| **Intermezzo** | `intermezzo` | A surprising intermediate move (Zwischenzug) that poses an immediate threat. |
| **Kingside Attack** | `kingsideAttack` | A targeted assault against the opponent's castled kingside. |
| **Queenside Attack** | `queensideAttack` | A targeted assault against the opponent's queenside. |
| **Quiet Move** | `quietMove` | A non-forcing move (no check or capture) that creates an unavoidable threat. |
| **Promotion** | `promotion` | Tactics that culminate in promoting a pawn. |
| **Sacrifice** | `sacrifice` | Giving up material for a decisive tactical or positional compensation. |
| **Simplification** | `simplification` | Forcing trades to convert a material advantage into an easily won endgame. |
| **Vulnerable King** | `vulnerableKing` | Exploiting a king that lacks pawn protection or is trapped in the center. |
| **Zugzwang** | `zugzwang` | Reaching a position where any move the opponent makes worsens their position. |

## 3. Checkmate Types & Patterns
Specific mating nets, lengths, and historical configurations.

| Theme Name | Slug | Description |
| :--- | :--- | :--- |
| **Mate** | `mate` | Any checkmating sequence. |
| **Mate in 1** | `mateIn1` | Deliver checkmate in exactly 1 move. |
| **Mate in 2** | `mateIn2` | Deliver checkmate in exactly 2 moves. |
| **Mate in 3** | `mateIn3` | Deliver checkmate in exactly 3 moves. |
| **Mate in 4** | `mateIn4` | Deliver checkmate in exactly 4 moves. |
| **Mate in 5 or more** | `mateIn5` | Deep calculation mating nets (5+ moves). |
| **Anastasia's Mate** | `anastasiaMate` | Knight and rook trap the king against the side of the board. |
| **Arabian Mate** | `arabianMate` | Knight and rook trap the king in the corner. |
| **Back Rank Mate** | `backRankMate` | Mating the king on the home rank, trapped by its own pawns. |
| **Boden's Mate** | `bodenMate` | Two criss-crossing bishops deliver mate. |
| **Damiano's Mate** | `damianoMate` | A queen delivers mate protected by a pawn or bishop. |
| **Dovetail Mate** | `dovetailMate` | A queen delivers mate directly adjacent to the king, with escape squares blocked. |
| **Hook Mate** | `hookMate` | Rook, knight, and pawn coordinate to mate, using an enemy pawn to block escape. |
| **Smothered Mate** | `smotheredMate` | A knight mates a king completely surrounded/trapped by its own pieces. |

## 4. Endgame Specifics
Tactics and conversions isolated to the final phase of the game based on remaining material.

| Theme Name | Slug | Description |
| :--- | :--- | :--- |
| **Endgame** | `endgame` | General tactics occurring in the endgame phase. |
| **Pawn Endgame** | `pawnEndgame` | Only pawns and kings remain on the board. |
| **Knight Endgame** | `knightEndgame` | Knights, pawns, and kings. |
| **Bishop Endgame** | `bishopEndgame` | Bishops, pawns, and kings. |
| **Rook Endgame** | `rookEndgame` | Rooks, pawns, and kings (the most common endgame). |
| **Queen Endgame** | `queenEndgame` | Queens, pawns, and kings. |
| **Queen & Rook Endgame** | `queenRookEndgame` | Heavy piece endgames. |

## 5. Game Phases & Puzzle Lengths
General categorization tags used by the Lichess puzzle engine.

| Theme Name | Slug | Description |
| :--- | :--- | :--- |
| **Opening** | `opening` | Tactics occurring in the first phase of the game. |
| **Middlegame** | `middlegame` | Tactics occurring in the complex middle phase. |
| **Crushing** | `crushing` | Puzzles where you win a massive amount of material quickly. |
| **One-move puzzle** | `oneMove` | A puzzle lasting only a single ply. |
| **Short puzzle** | `short` | A puzzle lasting 2 plies. |
| **Long puzzle** | `long` | A puzzle lasting 3 plies. |
| **Very long puzzle** | `veryLong` | A puzzle lasting 4 or more plies. |
| **Master games** | `master` | Puzzles derived from games played by titled players. |
| **Master vs Master** | `masterVsMaster` | Puzzles derived from games where both players are titled. |
| **Super GM games** | `superGM` | Puzzles from games involving players rated 2700+. |

## 6. Popular Openings (CamelCase Slugs)
Lichess also supports specific opening tags in its training engine. To route users to puzzles strictly from an opening they struggle with, use the opening name in `camelCase`. 

*Examples:*
*   **Italian Game:** `italianGame` (`https://lichess.org/training/italianGame`)
*   **Sicilian Defense:** `sicilianDefense` (`https://lichess.org/training/sicilianDefense`)
*   **French Defense:** `frenchDefense` (`https://lichess.org/training/frenchDefense`)
*   **Caro-Kann Defense:** `caroKannDefense` (`https://lichess.org/training/caroKannDefense`)
*   **Ruy Lopez:** `ruyLopez` (`https://lichess.org/training/ruyLopez`)
*   **Queen's Gambit:** `queensGambit` (`https://lichess.org/training/queensGambit`)
*   **King's Indian Defense:** `kingsIndianDefense` (`https://lichess.org/training/kingsIndianDefense`)
*   **English Opening:** `englishOpening` (`https://lichess.org/training/englishOpening`)

## Fallback Routing Strategy
If the AI detects a weakness that does *not* map perfectly to any of the slugs above (e.g., "Isolated Queen's Pawn" or "Minority Attack"), instruct the LLM to output a **Lichess Study Search URL** instead of a Training URL.

**Format:** `https://lichess.org/study/search?q={URL_Encoded_Concept}`
**Example:** `https://lichess.org/study/search?q=Isolated+Queen%27s+Pawn`