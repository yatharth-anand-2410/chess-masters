from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import requests

LICHESS_GAME_URL_PATTERN = re.compile(
    r"lichess\.org/(?:game/)?([a-zA-Z0-9]{8})([a-zA-Z0-9]*)(?:/(white|black))?"
)
CHESS_COM_GAME_ID_PATTERN = re.compile(r"(\d{5,})\s*$")

DEFAULT_USER_AGENT = "AI-Chess-Game-Analyzer/1.0 (chess game coaching tool)"
ARCHIVE_MONTHS_TO_SCAN = 4
REQUEST_TIMEOUT_SECONDS = 30

LICHESS_EXPORT_URL = "https://lichess.org/game/export/{game_id}"
CHESS_COM_ARCHIVES_URL = "https://api.chess.com/pub/player/{username}/games/archives"


class ExtractionError(Exception):
    """Base error for all game extraction failures."""


class InvalidGameUrlError(ExtractionError):
    """The provided game URL could not be parsed for a game ID."""


class GameNotFoundError(ExtractionError):
    """The game could not be found via the platform API."""


class RateLimitError(ExtractionError):
    """The platform API rate-limited the request."""


class UpstreamRequestError(ExtractionError):
    """An upstream API request failed."""


@dataclass(frozen=True)
class GameData:
    platform: str
    game_id: str
    pgn: str
    player_color: Optional[str]
    player_name: Optional[str]


def _get(url: str, params: Optional[dict[str, str]] = None) -> requests.Response:
    try:
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": DEFAULT_USER_AGENT},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise UpstreamRequestError(f"Request to {url} failed: {exc}") from exc

    if response.status_code == 404:
        raise GameNotFoundError(f"The requested game was not found at {url}.")
    if response.status_code == 429:
        raise RateLimitError("The platform rate-limited the request. Try again later.")
    if response.status_code >= 400:
        raise UpstreamRequestError(
            f"Upstream request to {url} failed with status {response.status_code}."
        )
    return response


def extract_lichess_game_meta(url: str) -> tuple[str, Optional[str], bool]:
    match = LICHESS_GAME_URL_PATTERN.search(url.strip())
    if not match:
        raise InvalidGameUrlError(
            "Could not find an 8-character Lichess game ID in the provided URL."
        )
    game_id, trailing, color = match.group(1), match.group(2), match.group(3)
    needs_resolve = bool(trailing) and color is None
    return game_id, color, needs_resolve


def resolve_lichess_color(url: str) -> Optional[str]:
    try:
        response = requests.head(
            url,
            headers={"User-Agent": DEFAULT_USER_AGENT},
            timeout=REQUEST_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException:
        return None
    location = response.headers.get("Location", "")
    color_match = re.search(r"/(white|black)(?:[#?]|$)", location)
    return color_match.group(1) if color_match else None


def extract_chesscom_game_id(url: str) -> str:
    match = CHESS_COM_GAME_ID_PATTERN.search(url.strip())
    if not match:
        raise InvalidGameUrlError(
            "Could not find a numeric Chess.com game ID in the provided URL."
        )
    return match.group(1)


def clean_pgn(pgn: str) -> str:
    header_block, separator, moves = pgn.partition("\n\n")
    moves = re.sub(r"\{[^}]*\}", "", moves)
    moves = re.sub(r"\s+", " ", moves).strip()
    if not moves:
        return pgn
    return f"{header_block}{separator}{moves}".strip()


def fetch_lichess_pgn(game_id: str) -> str:
    response = _get(
        LICHESS_EXPORT_URL.format(game_id=game_id),
        params={"evals": "true"},
    )
    pgn = response.text
    if not pgn.strip():
        raise GameNotFoundError("Lichess returned an empty PGN for this game.")
    return clean_pgn(pgn)


def fetch_chesscom_game(username: str, game_id: str) -> tuple[str, str, str]:
    response = _get(CHESS_COM_ARCHIVES_URL.format(username=username))
    archives: list[str] = response.json().get("archives", [])
    if not archives:
        raise GameNotFoundError(f"No monthly archives found for Chess.com user {username}.")

    for month_url in reversed(archives[-ARCHIVE_MONTHS_TO_SCAN:]):
        month_response = _get(month_url)
        for game in month_response.json().get("games", []):
            if game.get("url", "").rstrip("/").endswith(game_id):
                pgn = game.get("pgn", "")
                if not pgn:
                    raise GameNotFoundError("The matched Chess.com game has no PGN.")
                color = _player_color_for_game(game, username)
                return clean_pgn(pgn), color, username

    raise GameNotFoundError(
        f"Could not find game {game_id} in the last {ARCHIVE_MONTHS_TO_SCAN} months "
        f"of archives for {username}. Older games are not supported."
    )


def _player_color_for_game(game: dict, username: str) -> str:
    target = username.strip().lower()
    white = (game.get("white") or {}).get("username", "").lower()
    black = (game.get("black") or {}).get("username", "").lower()
    if target and white == target:
        return "white"
    if target and black == target:
        return "black"
    return "unknown"


def fetch_game(
    platform: str,
    game_url: str,
    username: Optional[str] = None,
    player_color: Optional[str] = None,
) -> GameData:
    normalized = platform.lower().strip()
    explicit_color = player_color.lower().strip() if player_color else None

    if normalized == "lichess":
        game_id, url_color, needs_resolve = extract_lichess_game_meta(game_url)
        resolved_color = None
        if needs_resolve and not url_color:
            resolved_color = resolve_lichess_color(game_url)
        color = explicit_color or url_color or resolved_color
        if color not in ("white", "black"):
            raise InvalidGameUrlError(
                "Could not determine which color you played. Please select White or Black."
            )
        pgn = fetch_lichess_pgn(game_id)
        return GameData(
            platform="lichess",
            game_id=game_id,
            pgn=pgn,
            player_color=color,
            player_name=None,
        )

    if normalized in ("chess.com", "chesscom", "chess"):
        if not username or not username.strip():
            raise InvalidGameUrlError("A Chess.com username is required.")
        game_id = extract_chesscom_game_id(game_url)
        pgn, color, player_name = fetch_chesscom_game(username.strip(), game_id)
        if color == "unknown":
            raise GameNotFoundError(
                f"Username {username} was not found as White or Black in this game. "
                "Check the username and try again."
            )
        return GameData(
            platform="chess.com",
            game_id=game_id,
            pgn=pgn,
            player_color=color,
            player_name=player_name,
        )

    raise InvalidGameUrlError(f"Unsupported platform: {platform}")