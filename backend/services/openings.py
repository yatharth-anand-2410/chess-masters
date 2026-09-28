from __future__ import annotations

import os

import requests
from typing import Dict, List, Optional

EXPLORER_API = "https://explorer.lichess.ovh/masters"
USER_AGENT = "AI-Chess-Game-Analyzer/1.0 (chess game coaching tool)"
TIMEOUT_SECONDS = 12
_cache: Dict[str, Optional[Dict[str, object]]] = {}


def _rate_float(numerator: int, denominator: int) -> float:
    if not denominator:
        return 0.0
    return round(numerator / denominator * 100, 1)


def opening_insight(fen: str, opening_name: Optional[str] = None, eco: Optional[str] = None) -> Optional[Dict[str, object]]:
    if not fen:
        return None

    result: Dict[str, object] = {
        "name": opening_name,
        "eco": eco,
        "top_moves": [],
        "total_master_games": 0,
    }

    cached = _cache.get(fen)
    if cached is not None:
        return {**result, **cached}

    token = os.environ.get("LICHESS_TOKEN")
    if not token:
        return result

    headers = {
        "User-Agent": USER_AGENT,
        "Authorization": f"Bearer {token}",
    }
    try:
        response = requests.get(
            EXPLORER_API,
            params={"fen": fen, "moves": 3, "topGames": 0, "recentGames": 0},
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        return result
    if response.status_code != 200:
        return result

    try:
        data = response.json()
    except ValueError:
        return result

    moves = data.get("moves", [])
    total_games = sum(int(move.get("total", 0)) for move in moves)
    top_moves: List[Dict[str, object]] = []
    for move in moves[:3]:
        total = int(move.get("total", 0))
        if total <= 0:
            continue
        white = int(move.get("white", 0))
        draws = int(move.get("draws", 0))
        black = int(move.get("black", 0))
        top_moves.append(
            {
                "san": move.get("san"),
                "uci": move.get("uci"),
                "games": total,
                "win_rate": _rate_float(white + 0.5 * draws, total),
                "draw_rate": _rate_float(draws, total),
                "loss_rate": _rate_float(black, total),
                "popularity": _rate_float(total, total_games),
            }
        )

    opening = data.get("opening") or {}
    result = {
        "name": opening.get("name") or opening_name,
        "eco": opening.get("eco") or eco,
        "top_moves": top_moves,
        "total_master_games": total_games,
    }
    _cache[fen] = result
    return result