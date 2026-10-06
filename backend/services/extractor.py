from __future__ import annotations

import io
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import chess.pgn
import requests

from services import http

LICHESS_HOST = "lichess.org"
LICHESS_RESERVED_SEGMENTS = frozenset(
    {
        "analysis",
        "broadcast",
        "coach",
        "features",
        "forum",
        "game",
        "games",
        "learn",
        "patron",
        "player",
        "practice",
        "search",
        "simul",
        "study",
        "swiss",
        "team",
        "tournament",
        "training",
        "tv",
        "video",
    }
)
LICHESS_GAME_ID_PATTERN = re.compile(r"^([a-zA-Z0-9]{8})([a-zA-Z0-9]*)$")
CHESS_COM_GAME_ID_PATTERN = re.compile(r"/(?:live|daily|computer)/(\d{5,})")
CHESS_COM_TRAILING_ID_PATTERN = re.compile(r"/(\d{5,})/?$")
CHESS_COM_ANY_ID_PATTERN = re.compile(r"(\d{5,})")

DEFAULT_USER_AGENT = http.DEFAULT_USER_AGENT
ARCHIVE_MONTHS_TO_SCAN = 4
ARCHIVE_FETCH_WORKERS = 4
REQUEST_TIMEOUT_SECONDS = 30

# Completed months never change, so their game lists are safe to cache. The
# newest archive is always fetched fresh so a game finished seconds ago is
# still found.
_MAX_CACHED_MONTHS = 16
_MONTH_CACHE: Dict[str, List[dict]] = {}
_MONTH_CACHE_LOCKS: Dict[str, threading.Lock] = {}
_MONTH_CACHE_GUARD = threading.Lock()

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
class MoveClock:
    """Time spent and clock remaining for one of the player's moves."""

    move_number: int
    color: str
    seconds_spent: Optional[float]
    clock_remaining: Optional[float]


@dataclass(frozen=True)
class ServerEval:
    """A platform-provided evaluation for the position after one ply.

    ``cp`` and ``mate`` are from White's perspective, matching PGN ``%eval``
    annotations. Exactly one of the two is set.
    """

    ply: int
    cp: Optional[int]
    mate: Optional[int]


@dataclass(frozen=True)
class GameData:
    platform: str
    game_id: str
    pgn: str
    player_color: Optional[str]
    player_name: Optional[str]
    started_at: Optional[str] = None
    time_control: Optional[str] = None
    player_move_times: Tuple[MoveClock, ...] = ()
    server_evals: Tuple[ServerEval, ...] = ()


def _get(url: str, params: Optional[dict[str, str]] = None) -> requests.Response:
    try:
        response = http.get(
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


def _url_host_and_segments(url: str) -> tuple[str, list[str]]:
    raw = url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    return parsed.netloc.lower(), [segment for segment in parsed.path.split("/") if segment]


def extract_lichess_game_meta(url: str) -> tuple[str, Optional[str], bool]:
    host, segments = _url_host_and_segments(url)
    if host != LICHESS_HOST and not host.endswith(f".{LICHESS_HOST}"):
        raise InvalidGameUrlError(
            "Could not find an 8-character Lichess game ID in the provided URL."
        )
    if len(segments) >= 3 and segments[0] == "game" and segments[1] == "export":
        candidate, remaining = segments[2], segments[3:]
    elif len(segments) >= 2 and segments[0] == "game":
        candidate, remaining = segments[1], segments[2:]
    elif segments:
        candidate, remaining = segments[0], segments[1:]
    else:
        raise InvalidGameUrlError(
            "Could not find an 8-character Lichess game ID in the provided URL."
        )

    match = LICHESS_GAME_ID_PATTERN.match(candidate)
    if not match or candidate.lower() in LICHESS_RESERVED_SEGMENTS:
        raise InvalidGameUrlError(
            "Could not find an 8-character Lichess game ID in the provided URL."
        )
    game_id, trailing = match.group(1), match.group(2)
    color = next(
        (segment.lower() for segment in remaining if segment.lower() in ("white", "black")),
        None,
    )
    needs_resolve = bool(trailing) and color is None
    return game_id, color, needs_resolve


def resolve_lichess_color(url: str) -> Optional[str]:
    try:
        response = http.head(
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
    raw = url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    path = urlsplit(raw).path
    for pattern in (CHESS_COM_GAME_ID_PATTERN, CHESS_COM_TRAILING_ID_PATTERN):
        match = pattern.search(path)
        if match:
            return match.group(1)
    match = CHESS_COM_ANY_ID_PATTERN.search(path or raw)
    if match:
        return match.group(1)
    raise InvalidGameUrlError(
        "Could not find a numeric Chess.com game ID in the provided URL."
    )


def clean_pgn(pgn: str) -> str:
    header_block, separator, moves = pgn.partition("\n\n")
    moves = re.sub(r"\{[^}]*\}", "", moves)
    moves = re.sub(r"\s+", " ", moves).strip()
    if not moves:
        return pgn
    return f"{header_block}{separator}{moves}".strip()


def _read_pgn(pgn: str) -> Optional[chess.pgn.Game]:
    try:
        return chess.pgn.read_game(io.StringIO(pgn))
    except (ValueError, IndexError):
        return None


def _time_control_parts(time_control: Optional[str]) -> Tuple[Optional[float], float]:
    """Return (base seconds, increment seconds) from a PGN TimeControl header."""
    if not time_control:
        return None, 0.0
    raw = time_control.strip()
    if raw in ("-", "?", ""):
        return None, 0.0
    base_part, _, increment_part = raw.partition("+")
    if "/" in base_part:
        base_part = base_part.rsplit("/", 1)[-1]
    try:
        base = float(base_part)
    except ValueError:
        base = None
    try:
        increment = float(increment_part) if increment_part else 0.0
    except ValueError:
        increment = 0.0
    return base, max(0.0, increment)


def parse_game_metadata(pgn: str) -> Dict[str, Optional[str]]:
    """Extract the game's timestamp and time control from PGN headers."""
    game = _read_pgn(pgn)
    if game is None:
        return {"started_at": None, "time_control": None}
    headers = game.headers
    date = (headers.get("UTCDate") or headers.get("Date") or "").strip()
    clock_time = (headers.get("UTCTime") or headers.get("Time") or "").strip()
    started_at: Optional[str] = None
    if date and "?" not in date:
        normalized_date = date.replace(".", "-")
        if clock_time and "?" not in clock_time:
            started_at = f"{normalized_date}T{clock_time}"
        else:
            started_at = normalized_date
    return {"started_at": started_at, "time_control": headers.get("TimeControl")}


def parse_player_move_times(pgn: str, player_color: Optional[str]) -> Tuple[MoveClock, ...]:
    """Read ``%clk`` annotations from the raw PGN for the player's own moves.

    Returns an empty tuple when the PGN has no clock comments (common for some
    Chess.com archives), so callers can degrade gracefully.
    """
    if player_color not in ("white", "black"):
        return ()
    game = _read_pgn(pgn)
    if game is None:
        return ()

    base, increment = _time_control_parts(game.headers.get("TimeControl"))
    last_seen: Dict[str, Optional[float]] = {"white": None, "black": None}
    times: List[MoveClock] = []

    for node in game.mainline():
        ply = node.ply()
        color = "white" if ply % 2 == 1 else "black"
        try:
            remaining = node.clock()
        except (ValueError, KeyError):
            remaining = None
        previous = last_seen[color] if last_seen[color] is not None else base
        seconds_spent: Optional[float] = None
        if remaining is not None and previous is not None:
            seconds_spent = previous - remaining + increment
            if seconds_spent < 0:
                seconds_spent = max(0.0, previous - remaining)
            seconds_spent = min(seconds_spent, 6 * 60 * 60)
        if remaining is not None:
            last_seen[color] = remaining
        if color != player_color:
            continue
        times.append(
            MoveClock(
                move_number=(ply + 1) // 2,
                color=color,
                seconds_spent=round(seconds_spent, 1) if seconds_spent is not None else None,
                clock_remaining=round(remaining, 1) if remaining is not None else None,
            )
        )
    return tuple(times)


def parse_server_evals(pgn: str) -> Tuple[ServerEval, ...]:
    """Read ``%eval`` annotations from the raw PGN.

    Lichess includes these when a game has server-side analysis, which lets the
    analyzer reuse them instead of re-running Stockfish. Values are normalized
    to White's perspective; mate evaluations keep their signed distance.
    """
    game = _read_pgn(pgn)
    if game is None:
        return ()

    evals: List[ServerEval] = []
    for node in game.mainline():
        try:
            pov = node.eval()
        except (ValueError, KeyError):
            pov = None
        if pov is None:
            continue
        white = pov.white()
        if white.is_mate():
            mate = white.mate()
            if mate is not None:
                evals.append(ServerEval(ply=node.ply(), cp=None, mate=int(mate)))
            continue
        cp = white.score()
        if cp is not None:
            evals.append(ServerEval(ply=node.ply(), cp=int(cp), mate=None))
    return tuple(evals)


def fetch_lichess_pgn(game_id: str) -> str:
    """Fetch the raw PGN (clock and eval comments included) for a game."""
    response = _get(
        LICHESS_EXPORT_URL.format(game_id=game_id),
        params={"evals": "true"},
    )
    pgn = response.text
    if not pgn.strip():
        raise GameNotFoundError("Lichess returned an empty PGN for this game.")
    return pgn


def _fetch_chesscom_month(month_url: str) -> Tuple[List[dict], Optional[ExtractionError]]:
    """Fetch one monthly archive, returning games plus a rate-limit error if any."""
    try:
        response = _get(month_url)
        games = response.json().get("games", [])
        return (games if isinstance(games, list) else []), None
    except RateLimitError as exc:
        return [], exc
    except (GameNotFoundError, UpstreamRequestError):
        return [], None
    except ValueError:
        return [], None


def _month_lock(month_url: str) -> threading.Lock:
    with _MONTH_CACHE_GUARD:
        lock = _MONTH_CACHE_LOCKS.get(month_url)
        if lock is None:
            lock = threading.Lock()
            _MONTH_CACHE_LOCKS[month_url] = lock
        return lock


def _get_chesscom_month(
    month_url: str,
    immutable: bool,
) -> Tuple[List[dict], Optional[ExtractionError]]:
    """Fetch a month, memoizing completed (immutable) months.

    Concurrent callers requesting the same month share one network fetch.
    """
    if not immutable:
        return _fetch_chesscom_month(month_url)

    with _MONTH_CACHE_GUARD:
        cached = _MONTH_CACHE.get(month_url)
    if cached is not None:
        return cached, None

    with _month_lock(month_url):
        with _MONTH_CACHE_GUARD:
            cached = _MONTH_CACHE.get(month_url)
        if cached is not None:
            return cached, None
        games, error = _fetch_chesscom_month(month_url)
        if error is None:
            with _MONTH_CACHE_GUARD:
                _MONTH_CACHE[month_url] = games
                while len(_MONTH_CACHE) > _MAX_CACHED_MONTHS:
                    _MONTH_CACHE.pop(next(iter(_MONTH_CACHE)))
        return games, error


def fetch_chesscom_game(username: str, game_id: str) -> tuple[str, str, str]:
    """Return (raw PGN, player color, username) for a Chess.com game."""
    response = _get(CHESS_COM_ARCHIVES_URL.format(username=username))
    archives: list[str] = response.json().get("archives", [])
    if not archives:
        raise GameNotFoundError(f"No monthly archives found for Chess.com user {username}.")

    month_urls = list(reversed(archives[-ARCHIVE_MONTHS_TO_SCAN:]))
    newest_month = archives[-1]

    def fetch(month_url: str) -> Tuple[List[dict], Optional[ExtractionError]]:
        return _get_chesscom_month(month_url, immutable=month_url != newest_month)

    if len(month_urls) > 1:
        workers = min(ARCHIVE_FETCH_WORKERS, len(month_urls))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            month_results = list(executor.map(fetch, month_urls))
    else:
        month_results = [fetch(url) for url in month_urls]

    rate_limit_error: Optional[ExtractionError] = None
    for games, error in month_results:
        if error is not None and rate_limit_error is None:
            rate_limit_error = error
        for game in games:
            if game.get("url", "").rstrip("/").endswith(game_id):
                pgn = game.get("pgn", "")
                if not pgn:
                    raise GameNotFoundError("The matched Chess.com game has no PGN.")
                color = _player_color_for_game(game, username)
                return pgn, color, username

    if rate_limit_error is not None:
        raise rate_limit_error
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


def _fetch_game_uncached(
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
        raw_pgn = fetch_lichess_pgn(game_id)
        metadata = parse_game_metadata(raw_pgn)
        return GameData(
            platform="lichess",
            game_id=game_id,
            pgn=clean_pgn(raw_pgn),
            player_color=color,
            player_name=None,
            started_at=metadata["started_at"],
            time_control=metadata["time_control"],
            player_move_times=parse_player_move_times(raw_pgn, color),
            server_evals=parse_server_evals(raw_pgn),
        )

    if normalized in ("chess.com", "chesscom", "chess"):
        if not username or not username.strip():
            raise InvalidGameUrlError("A Chess.com username is required.")
        game_id = extract_chesscom_game_id(game_url)
        raw_pgn, color, player_name = fetch_chesscom_game(username.strip(), game_id)
        if color == "unknown":
            raise GameNotFoundError(
                f"Username {username} was not found as White or Black in this game. "
                "Check the username and try again."
            )
        metadata = parse_game_metadata(raw_pgn)
        return GameData(
            platform="chess.com",
            game_id=game_id,
            pgn=clean_pgn(raw_pgn),
            player_color=color,
            player_name=player_name,
            started_at=metadata["started_at"],
            time_control=metadata["time_control"],
            player_move_times=parse_player_move_times(raw_pgn, color),
        )

    raise InvalidGameUrlError(f"Unsupported platform: {platform}")


@lru_cache(maxsize=64)
def fetch_game(
    platform: str,
    game_url: str,
    username: Optional[str] = None,
    player_color: Optional[str] = None,
) -> GameData:
    """Fetch and normalize a game, memoizing successful lookups.

    Repeat analyses of the same URL (retries, re-runs) skip the upstream calls
    entirely. Failures are not cached.
    """
    return _fetch_game_uncached(platform, game_url, username, player_color)