from __future__ import annotations

import chess
import requests
from typing import Dict, Optional

TABLEBASE_API = "https://tablebase.lichess.ovh/standard"
USER_AGENT = "AI-Chess-Game-Analyzer/1.0 (chess game coaching tool)"
TIMEOUT_SECONDS = 12
MAX_PIECES = 7
_cache: Dict[str, Optional[Dict[str, object]]] = {}


def tablebase_insight(fen: str) -> Optional[Dict[str, object]]:
    if not fen:
        return None
    try:
        board = chess.Board(fen)
    except ValueError:
        return None
    if sum(1 for _ in board.piece_map()) > MAX_PIECES:
        return None

    cached = _cache.get(fen)
    if cached is not None:
        return cached

    try:
        response = requests.get(
            TABLEBASE_API,
            params={"fen": fen},
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None

    try:
        data = response.json()
    except ValueError:
        return None

    moves = data.get("moves") or []
    best_move = moves[0] if moves else None
    result: Dict[str, object] = {
        "category": data.get("category"),
        "dtm": data.get("dtm"),
        "dtz": data.get("dtz"),
        "pieces": sum(1 for _ in board.piece_map()),
        "best_move": {
            "uci": best_move.get("uci"),
            "san": best_move.get("san"),
            "category": best_move.get("category"),
            "dtm": best_move.get("dtm"),
            "dtz": best_move.get("dtz"),
        }
        if best_move
        else None,
    }
    _cache[fen] = result
    return result