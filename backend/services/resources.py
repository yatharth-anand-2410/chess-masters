"""Centralized exercise/resource catalog.

Every supported theme maps to a human-readable title and a strict Lichess URL.
Engine theme tags that are not explicitly mapped fall back to the generic
mixed-training link (``blunder``).
"""

from __future__ import annotations

from typing import Dict, Optional

EXERCISE_LINKS: Dict[str, Dict[str, str]] = {
    # --- Basic Tactics ---
    "hangingPiece": {"title": "Practice Hanging Pieces", "url": "https://lichess.org/training/hangingPiece"},
    "fork": {"title": "Practice Forks", "url": "https://lichess.org/training/fork"},
    "pin": {"title": "Practice Pins", "url": "https://lichess.org/training/pin"},
    "skewer": {"title": "Practice Skewers", "url": "https://lichess.org/training/skewer"},
    "discoveredAttack": {"title": "Discovered Attacks", "url": "https://lichess.org/training/discoveredAttack"},
    "doubleCheck": {"title": "Double Checks", "url": "https://lichess.org/training/doubleCheck"},
    "captureTheDefender": {"title": "Remove the Defender", "url": "https://lichess.org/training/captureTheDefender"},
    "trappedPiece": {"title": "Trapped Pieces", "url": "https://lichess.org/training/trappedPiece"},
    # --- Advanced Motifs ---
    "attraction": {"title": "Attraction Tactics", "url": "https://lichess.org/training/attraction"},
    "deflection": {"title": "Deflection / Overloading", "url": "https://lichess.org/training/deflection"},
    "clearance": {"title": "Clearance Sacrifices", "url": "https://lichess.org/training/clearance"},
    "interference": {"title": "Interference Tactics", "url": "https://lichess.org/training/interference"},
    "intermezzo": {"title": "Zwischenzug (In-between moves)", "url": "https://lichess.org/training/intermezzo"},
    "xRayAttack": {"title": "X-Ray Attacks", "url": "https://lichess.org/training/xRayAttack"},
    "sacrifice": {"title": "Tactical Sacrifices", "url": "https://lichess.org/training/sacrifice"},
    "quietMove": {"title": "Quiet Moves", "url": "https://lichess.org/training/quietMove"},
    "zugzwang": {"title": "Zugzwang Positions", "url": "https://lichess.org/training/zugzwang"},
    # --- Checkmate Patterns ---
    "mateIn1": {"title": "Checkmate in 1", "url": "https://lichess.org/training/mateIn1"},
    "mateIn2": {"title": "Checkmate in 2", "url": "https://lichess.org/training/mateIn2"},
    "mateIn3": {"title": "Checkmate in 3", "url": "https://lichess.org/training/mateIn3"},
    "mateIn4": {"title": "Checkmate in 4", "url": "https://lichess.org/training/mateIn4"},
    "mateIn5": {"title": "Checkmate in 5 or more", "url": "https://lichess.org/training/mateIn5"},
    "backRankMate": {"title": "Back-Rank Mates", "url": "https://lichess.org/training/backRankMate"},
    "smotheredMate": {"title": "Smothered Mates", "url": "https://lichess.org/training/smotheredMate"},
    "arabianMate": {"title": "Arabian Mates", "url": "https://lichess.org/training/arabianMate"},
    "anastasiaMate": {"title": "Anastasia's Mates", "url": "https://lichess.org/training/anastasiaMate"},
    "bodenMate": {"title": "Boden's Mates", "url": "https://lichess.org/training/bodenMate"},
    "hookMate": {"title": "Hook Mates", "url": "https://lichess.org/training/hookMate"},
    # --- Game Phases & Endgames ---
    "opening": {"title": "Opening Mistakes", "url": "https://lichess.org/training/opening"},
    "middlegame": {"title": "Middlegame Tactics", "url": "https://lichess.org/training/middlegame"},
    "endgame": {"title": "Endgame Tactics", "url": "https://lichess.org/training/endgame"},
    "pawnEndgame": {"title": "Pawn Endgames", "url": "https://lichess.org/training/pawnEndgame"},
    "knightEndgame": {"title": "Knight Endgames", "url": "https://lichess.org/training/knightEndgame"},
    "bishopEndgame": {"title": "Bishop Endgames", "url": "https://lichess.org/training/bishopEndgame"},
    "rookEndgame": {"title": "Rook Endgames", "url": "https://lichess.org/training/rookEndgame"},
    "queenEndgame": {"title": "Queen Endgames", "url": "https://lichess.org/training/queenEndgame"},
    # --- Pawn Specifics & King Safety ---
    "advancedPawn": {"title": "Advanced Pawns", "url": "https://lichess.org/training/advancedPawn"},
    "promotion": {"title": "Pawn Promotion", "url": "https://lichess.org/training/promotion"},
    "underPromotion": {"title": "Underpromotion", "url": "https://lichess.org/training/underPromotion"},
    "enPassant": {"title": "En Passant Tactics", "url": "https://lichess.org/training/enPassant"},
    "exposedKing": {"title": "Exposed King Attacks", "url": "https://lichess.org/training/exposedKing"},
    "kingsideAttack": {"title": "Kingside Attacks", "url": "https://lichess.org/training/kingsideAttack"},
    "queensideAttack": {"title": "Queenside Attacks", "url": "https://lichess.org/training/queensideAttack"},
    "castling": {"title": "Castling Rules & Tactics", "url": "https://lichess.org/training/castling"},
    # --- Fallbacks ---
    "advantage": {"title": "Gain an Advantage", "url": "https://lichess.org/training/advantage"},
    "crushing": {"title": "Crushing Moves", "url": "https://lichess.org/training/crushing"},
    "defensiveMove": {"title": "Defensive Moves", "url": "https://lichess.org/training/defensiveMove"},
    "blunder": {"title": "Tactics Mixed Training", "url": "https://lichess.org/training/mix"},
}

ALIASES: Dict[str, str] = {
    "capturingDefender": "captureTheDefender",
    "vulnerableKing": "exposedKing",
    "backRank": "backRankMate",
}


def resolve_theme(theme: str) -> str:
    if not theme:
        return "blunder"
    resolved = ALIASES.get(theme, theme)
    return resolved if resolved in EXERCISE_LINKS else "blunder"


def exercise_link(theme: str) -> Optional[Dict[str, str]]:
    entry = EXERCISE_LINKS.get(resolve_theme(theme))
    if not entry:
        return None
    return {"title": entry["title"], "url": entry["url"], "theme": resolve_theme(theme)}


def opening_analysis_url(fen: str) -> str:
    return f"https://lichess.org/analysis/standard/{fen.replace(' ', '_')}"