"""Longitudinal progress telemetry for the student progress surface.

Every number in the returned report comes from the student's own analyses:

* ``analyses.game_summary`` (captured from the telemetry rollout onwards)
  supplies the game speed, time control, player rating, accuracy, phase
  accuracies, quality counts and the compact per-game psychology primitives.
* ``analyses.insights.weakness_moments`` supplies the real centipawn losses,
  motifs and remaining clock of the key errors, so the ACPL- and clock-based
  signals also work for rows that predate the rollout.
* The PGN headers (``WhiteElo`` / ``BlackElo`` / ``TimeControl``) fill the gaps
  for the oldest rows.
* ``analyses.created_at`` orders the games and drives the ``days`` window.

Nothing is invented: metrics that cannot be computed are left out (or ``None``)
and ``insufficient`` is true whenever fewer than :data:`MIN_GAMES` completed
games match the active filter. The synthetic showcase profile is only ever used
for the ``demo*`` roster ids or when Supabase is not configured at all.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

from services import db, motifs, psychology

# ---------------------------------------------------------------------------
# Contract constants
# ---------------------------------------------------------------------------

#: Fewer matching games than this makes the whole report ``insufficient``.
MIN_GAMES = 4
MAX_ROOT_CAUSES = 5
MAX_PILLAR_ITEMS = 4
THIRD_DIVISOR = 3

SpeedBucket = Literal[
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
    "unknown",
]

SPEED_ORDER: Tuple[str, ...] = (
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
    "unknown",
)

# Lichess speed bands, applied to ``base seconds + 40 * increment``.
BULLET_MAX_SECONDS = 180.0
BLITZ_MAX_SECONDS = 480.0
RAPID_MAX_SECONDS = 1500.0
CORRESPONDENCE_MIN_SECONDS = 86400.0
ESTIMATED_GAME_MOVES = 40.0

#: A weakness moment counts as a blunder when the engine flagged it or when the
#: measured loss is at least this many centipawns (legacy rows without quality).
BLUNDER_CPL_THRESHOLD = 200

PANIC_BUCKETS: Tuple[Tuple[str, str, float, float], ...] = (
    ("< 30s", "Under 30 seconds", 0.0, 30.0),
    ("30s - 1m", "30 seconds - 1 minute", 30.0, 60.0),
    ("1 - 3 min", "1 - 3 minutes", 60.0, 180.0),
    ("> 3 min", "Over 3 minutes", 180.0, math.inf),
)
UNDER_30S_BUCKET = "< 30s"

#: Share thresholds that promote a leak into the "needs work" pillar column.
ROOT_CAUSE_TAG_SHARE = 25.0
PANIC_TAG_SHARE = 40.0

_TIME_CONTROL_RE = re.compile(r"^(\d+(?:\.\d+)?)$")
_MOVES_TIME_CONTROL_RE = re.compile(r"^\d+/(\d+(?:\.\d+)?)$")


def _pgn_header_pattern(name: str) -> re.Pattern[str]:
    return re.compile(r'\[%s\s+"([^"]*)"\]' % re.escape(name))


# ---------------------------------------------------------------------------
# Pydantic models -- mirror frontend/lib/api.ts::ProgressReport exactly
# ---------------------------------------------------------------------------


class TrackedAccount(BaseModel):
    platform: str = Field(..., description="Platform the account was played on")
    username: str = Field(..., description="Player handle as seen on the platform")
    games: int = Field(..., description="Matching games played on this account")
    rating: Optional[int] = Field(None, description="Latest rating seen for the account")


class ProgressIdentity(BaseModel):
    accounts: List[TrackedAccount] = Field(default_factory=list)
    total_games: int = Field(..., description="Completed analyses found, before filters")
    filtered_games: int = Field(..., description="Analyses matching the active filter")
    speeds: List[SpeedBucket] = Field(default_factory=list, description="Applied speed filter")
    days: Optional[int] = Field(None, description="Applied recency window in days")


class ProgressSeriesPoint(BaseModel):
    date: str = Field(..., description="Analysis timestamp of the game")
    game_id: Optional[str] = None
    result: Optional[str] = Field(None, description="'win', 'loss' or 'draw'")
    speed: Optional[SpeedBucket] = None
    rating: Optional[float] = None
    accuracy: Optional[float] = None
    acpl: Optional[float] = None
    opening: Optional[float] = None
    middlegame: Optional[float] = None
    endgame: Optional[float] = None


class EloProgress(BaseModel):
    starting: float = Field(0, description="First rated game in the window")
    current: float = Field(0, description="Latest rated game in the window")
    peak: float = Field(0, description="Highest rating in the window")
    net_gain: float = Field(0, description="current - starting")
    status: str = Field("", description="Trajectory shape, '' when not classifiable")
    series: List[ProgressSeriesPoint] = Field(default_factory=list)


class AcplProgress(BaseModel):
    baseline: Optional[float] = Field(None, description="Mean ACPL of the first third")
    recent: Optional[float] = Field(None, description="Mean ACPL of the latest third")
    net_drift: Optional[float] = Field(None, description="recent - baseline")
    direction: Literal["sharpening", "stable", "decaying"] = "stable"
    series: List[ProgressSeriesPoint] = Field(default_factory=list)


class AccuracyProgress(BaseModel):
    baseline: Optional[float] = Field(None, description="Mean accuracy of the first third")
    current: Optional[float] = Field(None, description="Mean accuracy of the latest third")
    series: List[ProgressSeriesPoint] = Field(default_factory=list)


class PhaseSpan(BaseModel):
    baseline: Optional[float] = None
    current: Optional[float] = None


class PhaseProgress(BaseModel):
    opening: PhaseSpan = Field(default_factory=PhaseSpan)
    middlegame: PhaseSpan = Field(default_factory=PhaseSpan)
    endgame: PhaseSpan = Field(default_factory=PhaseSpan)
    best_phase: Optional[str] = Field(None, description="Highest current phase accuracy")
    lagging_phase: Optional[str] = Field(None, description="Lowest current phase accuracy")
    series: List[ProgressSeriesPoint] = Field(default_factory=list)


class MovementItem(BaseModel):
    key: str
    label: str
    before: float
    after: float
    delta: float
    unit: str
    direction: Literal["up", "down"]
    higher_is_better: bool
    insufficient: Optional[bool] = None


class PillarItem(BaseModel):
    title: str
    metric: str = Field(..., description="Carries the real numbers behind the claim")
    detail: str
    status: Literal["mastered", "improving", "needs_work"]


class PillarGroups(BaseModel):
    improved: List[PillarItem] = Field(default_factory=list)
    improving: List[PillarItem] = Field(default_factory=list)
    needs_work: List[PillarItem] = Field(default_factory=list)


class RootCause(BaseModel):
    category: str
    count: int
    percentage: float
    primary_motif: str = Field(..., description="Dominant motif key, e.g. 'pin'")
    description: str


class RadarMetric(BaseModel):
    dimension: str
    baseline_score: float
    current_score: float
    delta: float


class PanicBucket(BaseModel):
    bucket: str
    label: str
    blunders: int
    games: int
    percentage: float
    worst: Optional[bool] = None


class PersonaProfile(BaseModel):
    archetype: str
    summary_verdict: str
    strength_badge: str
    vulnerability_badge: str
    next_milestone: str


class StudentProgressReport(BaseModel):
    """Exactly the shape of ``ProgressReport`` in ``frontend/lib/api.ts``."""

    student_id: str
    student_name: str
    identity: ProgressIdentity
    elo: EloProgress
    acpl: AcplProgress
    accuracy: AccuracyProgress
    phases: PhaseProgress
    movement: List[MovementItem] = Field(default_factory=list)
    pillars: PillarGroups = Field(default_factory=PillarGroups)
    root_causes: List[RootCause] = Field(default_factory=list)
    radar: List[RadarMetric] = Field(default_factory=list)
    panic: List[PanicBucket] = Field(default_factory=list)
    persona: PersonaProfile
    focus_rules: List[str] = Field(default_factory=list)
    games_used: int = 0
    insufficient: bool = True

    # -- Legacy read-only shims ------------------------------------------
    # ``services/copilot.py`` and the pre-rollout regression tests still read
    # the old attribute names. The properties below keep them working without
    # polluting the JSON payload (properties are not pydantic fields, so the
    # API shape stays contract-exact).

    @property
    def blunder_root_causes(self) -> List[RootCause]:
        return self.root_causes

    @property
    def actionable_focus_rules(self) -> List[str]:
        return self.focus_rules

    @property
    def elo_trajectory(self) -> SimpleNamespace:
        return SimpleNamespace(
            current_rating=self.elo.current,
            peak_rating=self.elo.peak,
            starting_rating=self.elo.starting,
            net_gain=self.elo.net_gain,
            trajectory_status=self.elo.status,
            series=self.elo.series,
        )

    @property
    def persona_profile(self) -> SimpleNamespace:
        return SimpleNamespace(
            archetype=self.persona.archetype,
            summary_verdict=self.persona.summary_verdict,
            strength_badge=self.persona.strength_badge,
            vulnerability_badge=self.persona.vulnerability_badge,
            next_milestone=self.persona.next_milestone,
        )

    @property
    def three_pillar_mastery(self) -> SimpleNamespace:
        return SimpleNamespace(
            what_has_improved=self.pillars.improved,
            what_is_improving=self.pillars.improving,
            what_needs_work=self.pillars.needs_work,
        )


# ---------------------------------------------------------------------------
# Internal single-pass game record
# ---------------------------------------------------------------------------


@dataclass
class _Game:
    """Everything the report needs from one completed analysis row."""

    analysis_id: str
    date: str
    played_at: Optional[datetime]
    result: Optional[str]
    speed: str
    platform: str
    username: str
    rating: Optional[float]
    accuracy: Optional[float]
    acpl: Optional[float]
    opening: Optional[float]
    middlegame: Optional[float]
    endgame: Optional[float]
    blunders: Optional[int]
    moments: List[Dict[str, Any]]
    psychology_primitives: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class _Signal:
    """One real before/after movement signal, shared by movement and pillars."""

    key: str
    label: str
    unit: str
    higher_is_better: bool
    before: float
    after: float
    material: float
    notable: float
    metric: str
    detail: str
    in_movement: bool = False

    @property
    def delta(self) -> float:
        return self.after - self.before

    @property
    def progress(self) -> float:
        """Signed improvement magnitude (positive always means "better")."""
        return self.delta if self.higher_is_better else -self.delta


# ---------------------------------------------------------------------------
# Small numeric / parsing helpers
# ---------------------------------------------------------------------------


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _round(value: float, digits: int = 1) -> float:
    return round(float(value), digits)


def _mean(values: Iterable[Optional[float]]) -> Optional[float]:
    clean = [float(value) for value in values if _is_number(value)]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _percent(part: float, whole: float) -> float:
    if not whole:
        return 0.0
    return _round(part / whole * 100.0, 1)


def _fmt(value: float, unit: str = "", *, signed: bool = False) -> str:
    text = f"{float(value):.1f}".rstrip("0").rstrip(".")
    if not text or text == "-0":
        text = "0"
    if signed and float(value) > 0:
        text = f"+{text}"
    if unit == "%":
        return f"{text}%"
    return f"{text} {unit}".strip()


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _pgn_header(pgn: str, name: str) -> Optional[str]:
    if not pgn:
        return None
    match = _pgn_header_pattern(name).search(pgn)
    if not match:
        return None
    value = (match.group(1) or "").strip()
    return value or None


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_speed(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    return text if text in SPEED_ORDER else None


def _speed_from_time_control(value: Any) -> Optional[str]:
    """Map a PGN/Chess.com time control onto a :data:`SpeedBucket`."""
    if not isinstance(value, str):
        return None
    text = value.strip().split(",", 1)[0].strip()
    if not text or text in {"-", "*", "?"}:
        return None

    head, _, tail = text.partition("+")
    increment = 0.0
    try:
        increment = max(0.0, float(tail)) if tail else 0.0
    except ValueError:
        increment = 0.0

    base_head = head.strip()
    if ":" in base_head:
        base_head = base_head.rsplit(":", 1)[-1].strip()

    moves_based = _MOVES_TIME_CONTROL_RE.match(base_head)
    if moves_based:
        seconds = float(moves_based.group(1))
        if seconds >= CORRESPONDENCE_MIN_SECONDS:
            return "correspondence"
        base = seconds
    else:
        plain = _TIME_CONTROL_RE.match(base_head)
        if not plain:
            return None
        base = float(plain.group(1))
        if base >= CORRESPONDENCE_MIN_SECONDS:
            return "correspondence"

    total = base + increment * ESTIMATED_GAME_MOVES
    if total < BULLET_MAX_SECONDS:
        return "bullet"
    if total < BLITZ_MAX_SECONDS:
        return "blitz"
    if total < RAPID_MAX_SECONDS:
        return "rapid"
    return "classical"


def _normalize_speeds(values: Optional[Sequence[Any]]) -> List[str]:
    if not values:
        return []
    tokens: List[str] = []
    for item in values:
        if item is None:
            continue
        tokens.extend(str(item).split(","))
    wanted = {token.strip().lower() for token in tokens if token.strip()}
    return [speed for speed in SPEED_ORDER if speed in wanted]


def _normalize_days(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        days = int(value)
    except (TypeError, ValueError):
        return None
    return days if days > 0 else None


def _player_result(raw: Any, player_color: str) -> Optional[str]:
    """Player-perspective result ('win'/'loss'/'draw') from a stored result."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("1-0"):
        return "win" if player_color == "white" else "loss"
    if text.startswith("0-1"):
        return "win" if player_color == "black" else "loss"
    if text.startswith("1/2") or text.startswith("½"):
        return "draw"
    lowered = text.lower()
    if "win" in lowered:
        return "win"
    if "loss" in lowered or "lose" in lowered:
        return "loss"
    if "draw" in lowered:
        return "draw"
    return None


def _moment_clock(moment: Dict[str, Any]) -> Optional[float]:
    value = moment.get("clock_remaining")
    if _is_number(value):
        return float(value)
    return None


def _moment_cpl(moment: Dict[str, Any]) -> Optional[float]:
    value = moment.get("centipawn_loss")
    if _is_number(value):
        return float(value)
    return None


def _moment_is_blunder(moment: Dict[str, Any]) -> bool:
    quality = str(moment.get("quality") or "").strip().lower()
    if quality:
        return quality == "blunder"
    cpl = _moment_cpl(moment)
    return cpl is not None and cpl >= BLUNDER_CPL_THRESHOLD


def _moment_theme(moment: Dict[str, Any]) -> str:
    theme = str(moment.get("resource_theme") or "").strip().lower()
    if theme:
        return theme
    label = str(moment.get("motif") or "").strip().lower()
    return label or "blunder"


def _moment_category(moment: Dict[str, Any]) -> Tuple[str, str]:
    """Return ``(display category, motif key)`` for one weakness moment.

    Moments tagged by the motif detector carry the human label; older or
    undetected ones only carry the resource theme, so the same
    ``motifs.MOTIF_LABELS`` table is used to keep both in one category.
    """
    theme = _moment_theme(moment)
    label = str(moment.get("motif") or "").strip()
    if label:
        return label, theme
    known_label = motifs.MOTIF_LABELS.get(theme)
    if known_label:
        return known_label, theme
    if theme == "intermezzo":
        return "Missed in-between move", theme
    if theme in ("opening", "middlegame", "endgame"):
        return f"{theme.title()} mistakes", theme
    return "Unclassified errors", theme


# ---------------------------------------------------------------------------
# Row -> _Game extraction (single pass over the analyses)
# ---------------------------------------------------------------------------


def _extract_game(row: Dict[str, Any]) -> Optional[_Game]:
    if str(row.get("status") or "").strip().lower() != "completed":
        return None

    summary = _as_dict(row.get("game_summary"))
    insights = _as_dict(row.get("insights"))
    pgn = row.get("pgn") if isinstance(row.get("pgn"), str) else ""
    color = str(row.get("player_color") or "").strip().lower()
    moments = [
        moment
        for moment in (insights.get("weakness_moments") or [])
        if isinstance(moment, dict)
    ]

    speed = _normalize_speed(summary.get("speed"))
    if speed is None:
        speed = _speed_from_time_control(
            summary.get("time_control") or _pgn_header(pgn, "TimeControl")
        )
    if speed is None:
        speed = "unknown"

    rating: Optional[float] = None
    summary_elo = summary.get("player_elo")
    if _is_number(summary_elo):
        rating = float(summary_elo)
    if rating is None and pgn:
        white = _pgn_header(pgn, "WhiteElo")
        black = _pgn_header(pgn, "BlackElo")
        raw_elo = white if color == "white" else black if color == "black" else None
        if raw_elo and raw_elo.isdigit():
            rating = float(int(raw_elo))

    accuracy: Optional[float] = None
    if _is_number(summary.get("accuracy")):
        accuracy = _round(float(summary["accuracy"]))

    cpl_values = [_moment_cpl(moment) for moment in moments]
    acpl = _mean(cpl_values)
    acpl = _round(acpl) if acpl is not None else None

    phases = _as_dict(summary.get("phase_accuracies"))
    psychology_primitives = summary.get("psychology")
    primitives = (
        psychology_primitives if isinstance(psychology_primitives, dict) else None
    )
    if not phases and primitives:
        phases = _as_dict(primitives.get("phase_accuracies"))

    def phase_value(name: str) -> Optional[float]:
        value = phases.get(name)
        return _round(float(value)) if _is_number(value) else None

    quality = _as_dict(summary.get("quality"))
    blunders = None
    if _is_number(quality.get("blunder")):
        blunders = int(quality["blunder"])

    username = str(
        summary.get("username") or row.get("username") or ""
    ).strip()
    platform = str(summary.get("platform") or row.get("platform") or "").strip().lower()

    created_at = row.get("created_at")
    date = created_at if isinstance(created_at, str) and created_at else ""

    game = _Game(
        analysis_id=str(row.get("id") or ""),
        date=date,
        played_at=_parse_timestamp(created_at),
        result=_player_result(row.get("result"), color),
        speed=speed,
        platform=platform,
        username=username,
        rating=rating,
        accuracy=accuracy,
        acpl=acpl,
        opening=phase_value("opening"),
        middlegame=phase_value("middlegame"),
        endgame=phase_value("endgame"),
        blunders=blunders,
        moments=moments,
        psychology_primitives=primitives,
    )
    return game


# ---------------------------------------------------------------------------
# Window maths
# ---------------------------------------------------------------------------


def _split_thirds(games: Sequence[_Game]) -> Tuple[List[_Game], List[_Game]]:
    """First third (baseline) and last third (recent) of the filtered games."""
    if not games:
        return [], []
    size = max(1, len(games) // THIRD_DIVISOR)
    return list(games[:size]), list(games[-size:])


def _window_mean(
    games: Sequence[_Game], getter
) -> Optional[float]:
    return _mean(getter(game) for game in games)


def _tilt_of(games: Sequence[_Game]) -> Optional[float]:
    """Accuracy after a loss minus accuracy after a win (negative = tilt)."""
    after_loss: List[float] = []
    after_win: List[float] = []
    for previous, current in zip(games, games[1:]):
        if current.accuracy is None:
            continue
        if previous.result == "loss":
            after_loss.append(current.accuracy)
        elif previous.result == "win":
            after_win.append(current.accuracy)
    if not after_loss or not after_win:
        return None
    return _mean(after_loss) - _mean(after_win)  # type: ignore[operator]


def _clock_blunder_counts(games: Sequence[_Game]) -> Tuple[int, int]:
    """Return ``(under-30s blunders, blunders with clock data)`` for a window."""
    under_30 = 0
    clocked = 0
    for game in games:
        for moment in game.moments:
            clock = _moment_clock(moment)
            if clock is None or not _moment_is_blunder(moment):
                continue
            clocked += 1
            if clock < 30.0:
                under_30 += 1
    return under_30, clocked


def _phase_window_mean(games: Sequence[_Game]) -> Optional[float]:
    values: List[float] = []
    for game in games:
        phases = [game.opening, game.middlegame, game.endgame]
        available = [value for value in phases if value is not None]
        if available:
            values.append(sum(available) / len(available))
    return _mean(values)


def _blunder_window_mean(games: Sequence[_Game]) -> Optional[float]:
    return _mean(game.blunders for game in games)


# ---------------------------------------------------------------------------
# Movement signals (shared by the movement matrix and the pillar columns)
# ---------------------------------------------------------------------------


def _build_signals(
    baseline: Sequence[_Game], recent: Sequence[_Game]
) -> List[_Signal]:
    signals: List[_Signal] = []

    rating_before = _window_mean(baseline, lambda game: game.rating)
    rating_after = _window_mean(recent, lambda game: game.rating)
    if rating_before is not None and rating_after is not None:
        before, after = _round(rating_before), _round(rating_after)
        signals.append(
            _Signal(
                key="rating",
                label="Rating drift (window average)",
                unit="Elo",
                higher_is_better=True,
                before=before,
                after=after,
                material=25,
                notable=8,
                metric=f"Rating: {_fmt(before)} → {_fmt(after)} Elo",
                detail=(
                    "Mean player rating across the first third of the filtered "
                    "games versus the latest third."
                ),
                in_movement=True,
            )
        )

    acpl_before = _window_mean(baseline, lambda game: game.acpl)
    acpl_after = _window_mean(recent, lambda game: game.acpl)
    if acpl_before is not None and acpl_after is not None:
        before, after = _round(acpl_before), _round(acpl_after)
        signals.append(
            _Signal(
                key="acpl",
                label="Avg centipawn loss",
                unit="cp",
                higher_is_better=False,
                before=before,
                after=after,
                material=4,
                notable=1.5,
                metric=f"Key-move centipawn loss: {_fmt(before)} → {_fmt(after)} cp",
                detail=(
                    "Mean centipawn loss of the blunders and mistakes the engine "
                    "flagged in each game."
                ),
                in_movement=True,
            )
        )

    under_before, clocked_before = _clock_blunder_counts(baseline)
    under_after, clocked_after = _clock_blunder_counts(recent)
    if clocked_before and clocked_after:
        before = _round(under_before / clocked_before * 100.0)
        after = _round(under_after / clocked_after * 100.0)
        signals.append(
            _Signal(
                key="time_trouble",
                label="Sub-30s blunder rate",
                unit="%",
                higher_is_better=False,
                before=before,
                after=after,
                material=10,
                notable=3,
                metric=(
                    f"Blunder rate under 30s: {under_before}/{clocked_before} → "
                    f"{under_after}/{clocked_after}"
                ),
                detail=(
                    "Share of your clocked blunders that were played with under "
                    "30 seconds left on the clock."
                ),
                in_movement=True,
            )
        )

    phase_before = _phase_window_mean(baseline)
    phase_after = _phase_window_mean(recent)
    if phase_before is not None and phase_after is not None:
        before, after = _round(phase_before), _round(phase_after)
        signals.append(
            _Signal(
                key="phase_accuracy",
                label="Phase accuracy",
                unit="%",
                higher_is_better=True,
                before=before,
                after=after,
                material=3,
                notable=1,
                metric=f"Phase accuracy: {_fmt(before, '%')} → {_fmt(after, '%')}",
                detail=(
                    "Mean of the opening, middlegame and endgame accuracies "
                    "captured for each game."
                ),
                in_movement=True,
            )
        )

    tilt_before = _tilt_of(baseline)
    tilt_after = _tilt_of(recent)
    if tilt_before is not None and tilt_after is not None:
        before, after = _round(tilt_before), _round(tilt_after)
        signals.append(
            _Signal(
                key="tilt",
                label="Post-loss tilt",
                unit="pts",
                higher_is_better=True,
                before=before,
                after=after,
                material=5,
                notable=2,
                metric=(
                    "Accuracy after a loss vs after a win: "
                    f"{_fmt(before, 'pts', signed=True)} → "
                    f"{_fmt(after, 'pts', signed=True)}"
                ),
                detail=(
                    "Difference between the accuracy of the game right after a "
                    "defeat and right after a win; closer to zero is better."
                ),
                in_movement=True,
            )
        )

    accuracy_before = _window_mean(baseline, lambda game: game.accuracy)
    accuracy_after = _window_mean(recent, lambda game: game.accuracy)
    if accuracy_before is not None and accuracy_after is not None:
        before, after = _round(accuracy_before), _round(accuracy_after)
        signals.append(
            _Signal(
                key="accuracy",
                label="Accuracy",
                unit="%",
                higher_is_better=True,
                before=before,
                after=after,
                material=3,
                notable=1,
                metric=f"Accuracy: {_fmt(before, '%')} → {_fmt(after, '%')}",
                detail="Per-game accuracy across the baseline versus recent third.",
            )
        )

    blunder_before = _blunder_window_mean(baseline)
    blunder_after = _blunder_window_mean(recent)
    if blunder_before is not None and blunder_after is not None:
        before, after = _round(blunder_before), _round(blunder_after)
        signals.append(
            _Signal(
                key="blunder_rate",
                label="Blunders per game",
                unit="",
                higher_is_better=False,
                before=before,
                after=after,
                material=0.5,
                notable=0.15,
                metric=f"Blunders per game: {_fmt(before)} → {_fmt(after)}",
                detail="Engine-flagged blunders per game in each window.",
            )
        )

    signals.extend(_motif_signals(baseline, recent))
    return signals


def _motif_counts(games: Sequence[_Game]) -> Dict[str, Dict[str, Any]]:
    counts: Dict[str, Dict[str, Any]] = {}
    for game in games:
        for moment in game.moments:
            category, theme = _moment_category(moment)
            entry = counts.setdefault(
                category, {"count": 0, "theme": theme, "themes": {}}
            )
            entry["count"] += 1
            entry["themes"][theme] = entry["themes"].get(theme, 0) + 1
    return counts


def _motif_signals(
    baseline: Sequence[_Game], recent: Sequence[_Game]
) -> List[_Signal]:
    """Real per-motif movement: only motifs with at least two early errors."""
    before_counts = _motif_counts(baseline)
    after_counts = _motif_counts(recent)
    signals: List[_Signal] = []
    for category, entry in sorted(
        before_counts.items(), key=lambda item: item[1]["count"], reverse=True
    ):
        before = int(entry["count"])
        if before < 2:
            continue
        after = int(after_counts.get(category, {}).get("count", 0))
        theme = entry["theme"]
        signals.append(
            _Signal(
                key=f"motif:{theme}:{category}",
                label=f"{category} errors",
                unit="",
                higher_is_better=False,
                before=float(before),
                after=float(after),
                material=2,
                notable=1,
                metric=f"{category} blunders: {before} → {after}",
                detail=(
                    f"Engine-tagged {category.lower()} errors in the baseline "
                    "versus the latest third."
                ),
            )
        )
    return signals


def _movement_items(signals: Sequence[_Signal]) -> List[MovementItem]:
    items: List[MovementItem] = []
    for signal in signals:
        if not signal.in_movement:
            continue
        delta = _round(signal.delta)
        items.append(
            MovementItem(
                key=signal.key,
                label=signal.label,
                before=signal.before,
                after=signal.after,
                delta=delta,
                unit=signal.unit,
                direction="up" if delta >= 0 else "down",
                higher_is_better=signal.higher_is_better,
            )
        )
    return items


def _pillar_item(signal: _Signal, status: str) -> PillarItem:
    return PillarItem(
        title=signal.label,
        metric=signal.metric,
        detail=signal.detail,
        status=status,  # type: ignore[arg-type]
    )


def _build_pillars(
    signals: Sequence[_Signal],
    root_causes: Sequence[RootCause],
    panic: Sequence[PanicBucket],
    key_errors: int,
) -> PillarGroups:
    improved: List[Tuple[float, PillarItem]] = []
    improving: List[Tuple[float, PillarItem]] = []
    needs_work: List[Tuple[float, PillarItem]] = []

    for signal in signals:
        progress = signal.progress
        if progress >= signal.material:
            improved.append((progress, _pillar_item(signal, "mastered")))
        elif progress >= signal.notable:
            improving.append((progress, _pillar_item(signal, "improving")))
        elif progress <= -signal.notable:
            needs_work.append((-progress, _pillar_item(signal, "needs_work")))

    for cause in root_causes:
        if cause.percentage < ROOT_CAUSE_TAG_SHARE:
            continue
        needs_work.append(
            (
                cause.percentage,
                PillarItem(
                    title=f"{cause.category} leak",
                    metric=(
                        f"{cause.count} of {key_errors} key errors "
                        f"({_fmt(cause.percentage, '%')})"
                    ),
                    detail=cause.description,
                    status="needs_work",
                ),
            )
        )

    clocked = sum(bucket.blunders for bucket in panic)
    for bucket in panic:
        if not bucket.worst or bucket.percentage < PANIC_TAG_SHARE:
            continue
        needs_work.append(
            (
                bucket.percentage,
                PillarItem(
                    title="Clock panic",
                    metric=(
                        f"{bucket.blunders} of {clocked} clocked blunders "
                        f"({_fmt(bucket.percentage, '%')}) {bucket.label.lower()}"
                    ),
                    detail=(
                        f"{bucket.games} game(s) contributed blunders with "
                        f"{bucket.label.lower()} left on the clock."
                    ),
                    status="needs_work",
                ),
            )
        )

    def top(items: List[Tuple[float, PillarItem]]) -> List[PillarItem]:
        items.sort(key=lambda item: item[0], reverse=True)
        return [item for _, item in items[:MAX_PILLAR_ITEMS]]

    return PillarGroups(
        improved=top(improved),
        improving=top(improving),
        needs_work=top(needs_work),
    )


# ---------------------------------------------------------------------------
# Root causes, panic buckets and radar
# ---------------------------------------------------------------------------


def _root_causes(games: Sequence[_Game]) -> List[RootCause]:
    total = sum(len(game.moments) for game in games)
    if not total:
        return []

    aggregates: Dict[str, Dict[str, Any]] = {}
    for game in games:
        for moment in game.moments:
            category, theme = _moment_category(moment)
            entry = aggregates.setdefault(
                category,
                {
                    "count": 0,
                    "themes": {},
                    "clocked": 0,
                    "under_30": 0,
                    "details": "",
                    "details_cpl": -1.0,
                },
            )
            entry["count"] += 1
            entry["themes"][theme] = entry["themes"].get(theme, 0) + 1
            clock = _moment_clock(moment)
            if clock is not None and _moment_is_blunder(moment):
                entry["clocked"] += 1
                if clock < 30.0:
                    entry["under_30"] += 1
            cpl = _moment_cpl(moment) or 0.0
            details = str(moment.get("motif_details") or "").strip()
            if details and cpl > entry["details_cpl"]:
                entry["details"] = details
                entry["details_cpl"] = cpl

    ordered = sorted(
        aggregates.items(), key=lambda item: item[1]["count"], reverse=True
    )
    causes: List[RootCause] = []
    for category, entry in ordered[:MAX_ROOT_CAUSES]:
        count = int(entry["count"])
        percentage = _percent(count, total)
        theme = max(entry["themes"].items(), key=lambda item: item[1])[0]
        description = (
            f"{count} of {total} key errors ({_fmt(percentage, '%')}) were "
            f"tagged {category}."
        )
        if entry["under_30"]:
            description += (
                f" {entry['under_30']} of them happened with under 30 seconds "
                "on the clock."
            )
        details = entry["details"]
        if details:
            description = f"{description} {details}"[:280]
        causes.append(
            RootCause(
                category=category,
                count=count,
                percentage=percentage,
                primary_motif=theme,
                description=description,
            )
        )
    return causes


def _panic_buckets(games: Sequence[_Game]) -> List[PanicBucket]:
    counts: Dict[str, Dict[str, Any]] = {
        bucket: {"blunders": 0, "games": set()}
        for bucket, _label, _low, _high in PANIC_BUCKETS
    }
    clocked_total = 0
    for game in games:
        for moment in game.moments:
            clock = _moment_clock(moment)
            if clock is None or not _moment_is_blunder(moment):
                continue
            clocked_total += 1
            for bucket, _label, low, high in PANIC_BUCKETS:
                if low <= clock < high:
                    counts[bucket]["blunders"] += 1
                    counts[bucket]["games"].add(game.analysis_id or game.date)
                    break

    if not clocked_total:
        return []

    buckets: List[PanicBucket] = []
    for bucket, label, _low, _high in PANIC_BUCKETS:
        entry = counts[bucket]
        buckets.append(
            PanicBucket(
                bucket=bucket,
                label=label,
                blunders=int(entry["blunders"]),
                games=len(entry["games"]),
                percentage=_percent(entry["blunders"], clocked_total),
            )
        )

    worst = max(buckets, key=lambda item: (item.percentage, item.blunders))
    if worst.blunders:
        worst.worst = True
    return buckets


_RADAR_LABELS: Dict[str, str] = {
    "consistency": "Consistency",
    "time_management": "Time management",
    "composure": "Composure",
    "tilt": "Tilt",
    "conversion": "Conversion",
    "fighting_spirit": "Fighting spirit",
}

_RADAR_SUFFIXES: Dict[str, str] = {
    "consistency": "Form Swings",
    "time_management": "Clock Leaks",
    "composure": "Composure Dips",
    "tilt": "Tilt Leaks",
    "conversion": "Missed Wins",
    "fighting_spirit": "Early Surrender",
}

_RADAR_BASES: Dict[str, str] = {
    "consistency": "Steady Competitor",
    "time_management": "Clock-Calm Calculator",
    "composure": "Composed Calculator",
    "tilt": "Unshakeable Competitor",
    "conversion": "Clinical Converter",
    "fighting_spirit": "Resilient Fighter",
}


def _radar_window(
    games: Sequence[_Game],
) -> Dict[str, Dict[str, Any]]:
    """Score the six psychology dimensions for one window of games."""
    primitives = [
        game.psychology_primitives
        for game in games
        if isinstance(game.psychology_primitives, dict)
    ]
    if not primitives:
        return {}
    accuracies = [
        float(entry["overall_accuracy"])
        for entry in primitives
        if _is_number(entry.get("overall_accuracy"))
    ]
    tilt_games = [{"psychology": entry} for entry in primitives]

    # The private builders below are the review surface's own rubric, reused so
    # the radar and the single-game psychology panel always agree.
    candidates = {
        "consistency": lambda: psychology._consistency_dimension(accuracies),
        "time_management": lambda: psychology._time_management_dimension(
            primitives, len(primitives)
        ),
        "composure": lambda: psychology._composure_dimension(primitives, accuracies),
        "tilt": lambda: psychology._tilt_dimension(tilt_games),
        "conversion": lambda: psychology._conversion_dimension(primitives),
        "fighting_spirit": lambda: psychology._fighting_spirit_dimension(primitives),
    }
    scored: Dict[str, Dict[str, Any]] = {}
    for key, builder in candidates.items():
        try:
            dimension = builder()
        except Exception:  # pragma: no cover - defensive, rubric is deterministic
            dimension = None
        if isinstance(dimension, dict) and _is_number(dimension.get("score")):
            scored[key] = dimension
    return scored


def _radar_metrics(
    baseline: Sequence[_Game], recent: Sequence[_Game]
) -> List[RadarMetric]:
    baseline_scores = _radar_window(baseline)
    recent_scores = _radar_window(recent)
    if not baseline_scores or not recent_scores:
        return []

    metrics: List[RadarMetric] = []
    for key in psychology.DIMENSION_ORDER:
        if key not in baseline_scores or key not in recent_scores:
            continue
        before = float(baseline_scores[key]["score"])
        after = float(recent_scores[key]["score"])
        metrics.append(
            RadarMetric(
                dimension=_RADAR_LABELS.get(key, key),
                baseline_score=before,
                current_score=after,
                delta=_round(after - before),
            )
        )
    return metrics


# ---------------------------------------------------------------------------
# Persona, focus rules, identity and series
# ---------------------------------------------------------------------------


def _elo_status(
    baseline_mean: Optional[float],
    recent_mean: Optional[float],
    current: float,
    starting: float,
    peak: float,
) -> str:
    if baseline_mean is None or recent_mean is None:
        return ""
    drift = recent_mean - baseline_mean
    net = current - starting
    if drift >= 20 and net >= 0:
        return "accelerating"
    if drift > 0 and current <= peak - 15:
        return "recovering"
    if drift >= 5:
        return "steady_climb"
    if drift <= -15:
        # Outside the documented four, but this is the honest state.
        return "declining"
    return "plateau"


def _milestone_target(current: float) -> Optional[int]:
    if current <= 0:
        return None
    target = int(round((current + 50.0) / 50.0) * 50)
    return max(target, int(current) + 1)


def _build_persona(
    elo: EloProgress,
    signals: Sequence[_Signal],
    radar: Sequence[RadarMetric],
    root_causes: Sequence[RootCause],
    panic: Sequence[PanicBucket],
    key_errors: int,
) -> PersonaProfile:
    ranked = sorted(radar, key=lambda metric: metric.current_score, reverse=True)
    strongest = ranked[0] if ranked else None
    weakest = ranked[-1] if ranked else None

    best_signal = max(signals, key=lambda signal: signal.progress, default=None)
    # The rating climb already leads the verdict, so the second clause uses the
    # strongest non-rating improvement to avoid repeating the same number.
    verdict_signal = max(
        (
            signal
            for signal in signals
            if signal.key != "rating" and signal.progress > 0
        ),
        key=lambda signal: signal.progress,
        default=None,
    )

    if strongest is not None:
        key = next(
            (name for name, label in _RADAR_LABELS.items() if label == strongest.dimension),
            "",
        )
        base = _RADAR_BASES.get(key, "Competitor")
        if (
            weakest is not None
            and weakest.dimension != strongest.dimension
            and weakest.current_score < 70
        ):
            weak_key = next(
                (name for name, label in _RADAR_LABELS.items() if label == weakest.dimension),
                "",
            )
            suffix = _RADAR_SUFFIXES.get(weak_key)
            if suffix:
                base = f"{base} with {suffix}"
        archetype = base
    elif root_causes:
        archetype = f"Developing Player with {root_causes[0].category} Leaks"
    else:
        archetype = "Developing Player"

    verdict_parts: List[str] = []
    if elo.current > 0:
        net = _fmt(elo.net_gain, signed=True)
        verdict_parts.append(
            f"Rating moved from {_fmt(elo.starting)} to {_fmt(elo.current)} "
            f"({net} Elo) across the games in this window"
        )
    if verdict_signal is not None:
        verdict_parts.append(
            f"{verdict_signal.label.lower()} improved ({verdict_signal.metric})"
        )
    clocked = sum(bucket.blunders for bucket in panic)
    if panic and clocked:
        bucket = next((item for item in panic if item.worst), panic[0])
        verdict_parts.append(
            f"{bucket.blunders} of {clocked} clocked blunders "
            f"({_fmt(bucket.percentage, '%')}) still land with "
            f"{bucket.label.lower()} on the clock"
        )
    elif root_causes:
        cause = root_causes[0]
        verdict_parts.append(
            f"the main leak is {cause.category.lower()} "
            f"({cause.count} of {key_errors} key errors)"
        )
    if not verdict_parts:
        verdict_parts.append("Too little recorded data for a stable read")
    summary_verdict = "; ".join(verdict_parts) + "."

    if strongest is not None:
        strength_badge = strongest.dimension
    elif best_signal is not None and best_signal.progress > 0:
        strength_badge = f"{best_signal.label} up"
    else:
        strength_badge = ""

    vulnerability_badge = ""
    if panic and clocked:
        bucket = next((item for item in panic if item.worst), panic[0])
        if bucket.percentage >= PANIC_TAG_SHARE:
            vulnerability_badge = (
                "Sub-30s clock panic"
                if bucket.bucket == UNDER_30S_BUCKET
                else "Clock pressure"
            )
    if not vulnerability_badge and root_causes:
        vulnerability_badge = f"{root_causes[0].category} leaks"
    if not vulnerability_badge and weakest is not None and weakest.current_score < 70:
        vulnerability_badge = weakest.dimension

    target = _milestone_target(elo.current)
    next_milestone = (
        f"Reach {target} Elo ({int(target - elo.current):+d} from {_fmt(elo.current)})"
        if target is not None
        else ""
    )

    return PersonaProfile(
        archetype=archetype[:80],
        summary_verdict=summary_verdict[:420],
        strength_badge=strength_badge[:60],
        vulnerability_badge=vulnerability_badge[:60],
        next_milestone=next_milestone[:120],
    )


def _focus_rules(
    signals: Sequence[_Signal],
    root_causes: Sequence[RootCause],
    panic: Sequence[PanicBucket],
    phases: PhaseProgress,
) -> List[str]:
    rules: List[str] = []

    regressions = sorted(
        (signal for signal in signals if signal.progress <= -signal.notable),
        key=lambda signal: signal.progress,
    )
    if regressions:
        worst = regressions[0]
        rules.append(
            f"Fix {worst.label.lower()} first: {worst.metric}."
        )

    if root_causes:
        cause = root_causes[0]
        rules.append(
            f"Run 10 {cause.primary_motif} puzzles before your next session — "
            f"{cause.category.lower()} accounts for {_fmt(cause.percentage, '%')} "
            "of your key errors."
        )

    clocked = sum(bucket.blunders for bucket in panic)
    if panic and clocked:
        bucket = next((item for item in panic if item.worst), panic[0])
        if bucket.percentage >= 30:
            rules.append(
                f"With {bucket.label.lower()} on the clock, use a three-second "
                f"reset before moving: {bucket.blunders} of {clocked} clocked "
                "blunders happened there."
            )

    lagging = phases.lagging_phase
    lagging_value = {
        "Opening": phases.opening.current,
        "Middlegame": phases.middlegame.current,
        "Endgame": phases.endgame.current,
    }.get(lagging or "")
    if lagging and lagging_value is not None:
        rules.append(
            f"Spend 15 minutes on {lagging.lower()} positions: accuracy there is "
            f"{_fmt(lagging_value, '%')}, the lowest of the three phases."
        )

    unique: List[str] = []
    for rule in rules:
        if rule not in unique:
            unique.append(rule)
    return unique[:4]


def _build_accounts(games: Sequence[_Game]) -> List[TrackedAccount]:
    accounts: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for index, game in enumerate(games):
        if not game.username:
            continue
        key = (game.platform or "unknown", game.username.lower())
        entry = accounts.setdefault(
            key,
            {
                "platform": game.platform or "unknown",
                "username": game.username,
                "games": 0,
                "rating": None,
                "order": index,
            },
        )
        entry["games"] += 1
        if game.rating is not None:
            entry["rating"] = int(round(game.rating))
    ordered = sorted(
        accounts.values(),
        key=lambda entry: (-entry["games"], entry["username"].lower(), entry["order"]),
    )
    return [
        TrackedAccount(
            platform=str(entry["platform"]),
            username=str(entry["username"]),
            games=int(entry["games"]),
            rating=entry["rating"],
        )
        for entry in ordered
    ]


def _build_series(
    games: Sequence[_Game],
) -> Tuple[
    List[ProgressSeriesPoint],
    List[ProgressSeriesPoint],
    List[ProgressSeriesPoint],
    List[ProgressSeriesPoint],
]:
    """Return the elo / acpl / accuracy / phase series in one pass."""
    elo: List[ProgressSeriesPoint] = []
    acpl: List[ProgressSeriesPoint] = []
    accuracy: List[ProgressSeriesPoint] = []
    phases: List[ProgressSeriesPoint] = []

    for game in games:
        base = {
            "date": game.date,
            "game_id": game.analysis_id or None,
            "result": game.result,
            "speed": game.speed,
        }
        if game.rating is not None:
            elo.append(ProgressSeriesPoint(**base, rating=game.rating))
        if game.acpl is not None:
            acpl.append(ProgressSeriesPoint(**base, acpl=game.acpl))
        if game.accuracy is not None:
            accuracy.append(ProgressSeriesPoint(**base, accuracy=game.accuracy))
        if any(value is not None for value in (game.opening, game.middlegame, game.endgame)):
            phases.append(
                ProgressSeriesPoint(
                    **base,
                    opening=game.opening,
                    middlegame=game.middlegame,
                    endgame=game.endgame,
                )
            )
    return elo, acpl, accuracy, phases


# ---------------------------------------------------------------------------
# Data loading and naming
# ---------------------------------------------------------------------------


def _load_rows(
    student_id: str, coach_id: Optional[str]
) -> List[Dict[str, Any]]:
    if coach_id:
        rows = db.list_analyses_by_student(coach_id, student_id)
    else:
        rows = db.list_analyses(
            user_id=student_id,
            limit=100,
            columns=db.ANALYSIS_TELEMETRY_COLUMNS,
        )
    return [row for row in rows if isinstance(row, dict)]


def _resolve_student_name(
    student_id: str, rows: Sequence[Dict[str, Any]]
) -> str:
    """Best real name available: student profile, embedded student, username."""
    try:
        student = db.get_student_by_id(student_id)
    except Exception:
        student = None
    if isinstance(student, dict) and str(student.get("display_name") or "").strip():
        return str(student["display_name"]).strip()

    for row in rows:
        embedded = _as_dict(row.get("student"))
        name = str(embedded.get("display_name") or "").strip()
        if name:
            return name
    for row in rows:
        username = str(row.get("username") or "").strip()
        if username:
            return username

    try:
        profile = db.get_user_profile(student_id)
    except Exception:
        profile = None
    if isinstance(profile, dict) and str(profile.get("display_name") or "").strip():
        return str(profile["display_name"]).strip()
    return f"Student {student_id[:6]}"


# ---------------------------------------------------------------------------
# Synthetic demo profile (demo roster ids / Supabase not configured only)
# ---------------------------------------------------------------------------


def _build_synthetic_progress(
    student_id: str, student_name: str
) -> StudentProgressReport:
    """Deterministic showcase profile for the demo roster / offline mode."""
    is_aarav = "aarav" in student_id.lower() or "2145" in student_id
    base_elo = 2077 if is_aarav else 1350 + (sum(ord(c) for c in student_id) % 300)
    current_elo = 2145 if is_aarav else base_elo + 95
    peak_elo = current_elo + 12

    rating_series = [
        (2077, 0, "win"),
        (2091, 14, "win"),
        (2085, -6, "loss"),
        (2108, 23, "win"),
        (2126, 18, "win"),
        (2145, 19, "win"),
    ]
    if not is_aarav:
        rating_series = [
            (base_elo, 0, "win"),
            (base_elo + 15, 15, "win"),
            (base_elo + 8, -7, "loss"),
            (base_elo + 32, 24, "win"),
            (base_elo + 55, 23, "win"),
            (current_elo, current_elo - (base_elo + 55), "win"),
        ]

    dates = ["2026-08-10", "2026-08-22", "2026-09-05", "2026-09-18", "2026-10-01", "2026-10-12"]
    elo = EloProgress(
        starting=rating_series[0][0],
        current=current_elo,
        peak=peak_elo,
        net_gain=current_elo - rating_series[0][0],
        status="steady_climb",
        series=[
            ProgressSeriesPoint(
                date=date,
                rating=float(rating),
                result=result,
                speed="blitz",
            )
            for date, (rating, _delta, result) in zip(dates, rating_series)
        ],
    )

    acpl_values = (
        [42.1, 39.4, 36.4, 33.1, 31.8, 28.2]
        if is_aarav
        else [62.4, 57.1, 54.1, 48.6, 45.8, 39.2]
    )
    accuracy_values = (
        [74.2, 76.8, 79.4, 83.1, 86.2, 88.5]
        if is_aarav
        else [64.1, 66.5, 69.8, 73.4, 76.9, 80.2]
    )
    opening_values = (
        [74.2, 77.0, 79.4, 82.1, 85.0, 88.5]
        if is_aarav
        else [66.0, 68.4, 71.2, 74.0, 76.8, 80.4]
    )
    middlegame_values = (
        [61.0, 63.5, 65.8, 68.2, 70.5, 72.8]
        if is_aarav
        else [54.0, 56.2, 58.4, 60.7, 62.9, 65.1]
    )
    endgame_values = (
        [52.4, 54.8, 57.2, 59.8, 62.0, 64.1]
        if is_aarav
        else [46.2, 48.6, 51.0, 53.6, 56.2, 58.8]
    )

    def series(points: Sequence[float], attribute: str) -> List[ProgressSeriesPoint]:
        return [
            ProgressSeriesPoint(
                date=date,
                speed="blitz",
                result="win" if index % 4 != 3 else "loss",
                **{attribute: value},
            )
            for index, (date, value) in enumerate(zip(dates, points))
        ]

    movement = [
        MovementItem(
            key="rating",
            label="Rating drift (window average)",
            before=float(rating_series[0][0]),
            after=float(current_elo),
            delta=float(current_elo - rating_series[0][0]),
            unit="Elo",
            direction="up",
            higher_is_better=True,
        ),
        MovementItem(
            key="acpl",
            label="Avg centipawn loss",
            before=acpl_values[0],
            after=acpl_values[-1],
            delta=round(acpl_values[-1] - acpl_values[0], 1),
            unit="cp",
            direction="down",
            higher_is_better=False,
        ),
        MovementItem(
            key="time_trouble",
            label="Sub-30s blunder rate",
            before=58.0,
            after=38.0,
            delta=-20.0,
            unit="%",
            direction="down",
            higher_is_better=False,
        ),
        MovementItem(
            key="phase_accuracy",
            label="Phase accuracy",
            before=round((opening_values[0] + middlegame_values[0] + endgame_values[0]) / 3, 1),
            after=round((opening_values[-1] + middlegame_values[-1] + endgame_values[-1]) / 3, 1),
            delta=round(
                (opening_values[-1] + middlegame_values[-1] + endgame_values[-1]) / 3
                - (opening_values[0] + middlegame_values[0] + endgame_values[0]) / 3,
                1,
            ),
            unit="%",
            direction="up",
            higher_is_better=True,
        ),
        MovementItem(
            key="tilt",
            label="Post-loss tilt",
            before=-14.0,
            after=-5.0,
            delta=9.0,
            unit="pts",
            direction="up",
            higher_is_better=True,
        ),
    ]

    pillars = PillarGroups(
        improved=[
            PillarItem(
                title="Pin detection",
                metric="Blunder rate down by 84% over the last 20 games.",
                detail=(
                    "Diagonal pins against queen and king are consistently "
                    "spotted in early middlegame skirmishes."
                ),
                status="mastered",
            ),
            PillarItem(
                title="Central pawn breaks",
                metric="92% accuracy on thematic ...d5 and ...e5 central breaks.",
                detail="Structural strikes are now prepared instead of rushed.",
                status="mastered",
            ),
            PillarItem(
                title="Early king safety",
                metric="Castles before move 12 in 95% of games.",
                detail="Early f7/f2 sacrifices no longer land in the opening.",
                status="mastered",
            ),
        ],
        improving=[
            PillarItem(
                title="Deflection awareness",
                metric="2 blunders in the last 10 games (down from 6).",
                detail="Overloaded defenders are recognised with growing vigilance.",
                status="improving",
            ),
            PillarItem(
                title="Advantage conversion",
                metric="Win rate climbed from 68% to 79%.",
                detail="Won positions are handled with more patience.",
                status="improving",
            ),
            PillarItem(
                title="Post-loss composure",
                metric="Accuracy drop after a loss reduced from -14 to -5 points.",
                detail="A setback no longer turns into a blitzing spell.",
                status="improving",
            ),
        ],
        needs_work=[
            PillarItem(
                title="Sub-30s clock panic",
                metric="82% of game-losing drops happen under 25 seconds.",
                detail="Moves are rushed when the increment is still available.",
                status="needs_work",
            ),
            PillarItem(
                title="Flight-square blindspot",
                metric="Back-rank vulnerabilities in 4 of the last 15 games.",
                detail="Luft (h3/h6) is skipped before deep rook operations.",
                status="needs_work",
            ),
            PillarItem(
                title="Queen-trade hesitation",
                metric="Technical liquidations avoided when up two pawns.",
                detail="Winning king-and-pawn endgames are declined out of caution.",
                status="needs_work",
            ),
        ],
    )

    root_causes = [
        RootCause(
            category="Clock panic",
            count=18,
            percentage=42.9,
            primary_motif="rushedMove",
            description="Blunders committed under 30 seconds with the increment unused.",
        ),
        RootCause(
            category="Pin",
            count=11,
            percentage=26.2,
            primary_motif="pin",
            description="Indirect pins and knight hops overlooked in congested middlegames.",
        ),
        RootCause(
            category="Back-rank weakness",
            count=7,
            percentage=16.7,
            primary_motif="backRank",
            description="Back-rank mates and pinned escape squares in heavy-piece endings.",
        ),
        RootCause(
            category="Endgame mistakes",
            count=6,
            percentage=14.2,
            primary_motif="endgame",
            description="Advantageous pawn structures liquidated into drawn endgames.",
        ),
    ]

    radar = [
        RadarMetric(dimension="Consistency", baseline_score=60, current_score=78, delta=18),
        RadarMetric(dimension="Time management", baseline_score=38, current_score=46, delta=8),
        RadarMetric(dimension="Composure", baseline_score=65, current_score=81, delta=16),
        RadarMetric(dimension="Tilt", baseline_score=55, current_score=70, delta=15),
        RadarMetric(dimension="Conversion", baseline_score=50, current_score=64, delta=14),
        RadarMetric(dimension="Fighting spirit", baseline_score=72, current_score=87, delta=15),
    ]

    panic = [
        PanicBucket(
            bucket="< 30s",
            label="Under 30 seconds",
            blunders=18,
            games=9,
            percentage=42.9,
            worst=True,
        ),
        PanicBucket(
            bucket="30s - 1m",
            label="30 seconds - 1 minute",
            blunders=11,
            games=8,
            percentage=26.2,
        ),
        PanicBucket(
            bucket="1 - 3 min",
            label="1 - 3 minutes",
            blunders=7,
            games=6,
            percentage=16.7,
        ),
        PanicBucket(
            bucket="> 3 min",
            label="Over 3 minutes",
            blunders=6,
            games=5,
            percentage=14.2,
        ),
    ]

    persona = PersonaProfile(
        archetype="Composed Calculator with Clock Leaks",
        summary_verdict=(
            f"Rating moved from {rating_series[0][0]} to {current_elo} "
            f"({current_elo - rating_series[0][0]:+d} Elo) while 42.9% of clocked "
            "blunders still land under 30 seconds."
        ),
        strength_badge="Composure",
        vulnerability_badge="Sub-30s clock panic",
        next_milestone=(
            f"Reach {_milestone_target(current_elo)} Elo "
            f"({int((_milestone_target(current_elo) or 0) - current_elo):+d} from {current_elo})"
        ),
    )

    return StudentProgressReport(
        student_id=student_id,
        student_name=student_name,
        identity=ProgressIdentity(
            accounts=[
                TrackedAccount(
                    platform="lichess",
                    username="aarav_sharma" if is_aarav else f"player_{student_id[:6]}",
                    games=14,
                    rating=current_elo,
                )
            ]
            if is_aarav
            else [],
            total_games=14,
            filtered_games=14,
            speeds=[],
            days=None,
        ),
        elo=elo,
        acpl=AcplProgress(
            baseline=acpl_values[0],
            recent=acpl_values[-1],
            net_drift=round(acpl_values[-1] - acpl_values[0], 1),
            direction="sharpening",
            series=series(acpl_values, "acpl"),
        ),
        accuracy=AccuracyProgress(
            baseline=accuracy_values[0],
            current=accuracy_values[-1],
            series=series(accuracy_values, "accuracy"),
        ),
        phases=PhaseProgress(
            opening=PhaseSpan(baseline=opening_values[0], current=opening_values[-1]),
            middlegame=PhaseSpan(
                baseline=middlegame_values[0], current=middlegame_values[-1]
            ),
            endgame=PhaseSpan(baseline=endgame_values[0], current=endgame_values[-1]),
            best_phase="Opening",
            lagging_phase="Endgame",
            series=[
                ProgressSeriesPoint(
                    date=date,
                    speed="blitz",
                    opening=opening,
                    middlegame=middlegame,
                    endgame=endgame,
                )
                for date, opening, middlegame, endgame in zip(
                    dates, opening_values, middlegame_values, endgame_values
                )
            ],
        ),
        movement=movement,
        pillars=pillars,
        root_causes=root_causes,
        radar=radar,
        panic=panic,
        persona=persona,
        focus_rules=[
            "Create an escape square (luft: h3/h6) before launching active rook manoeuvres.",
            "Take a mandatory three-second breath before every move under 30 seconds.",
            "Liquidate into king-and-pawn endgames immediately when ahead two clean pawns.",
        ],
        games_used=14,
        insufficient=False,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_student_progress(
    student_id: str,
    coach_id: Optional[str] = None,
    speeds: Optional[List[str]] = None,
    days: Optional[int] = None,
) -> StudentProgressReport:
    """Build the longitudinal progress report for one student.

    Loads the student's completed analyses (coach-owned rows when ``coach_id``
    is given, the student's own rows otherwise), applies the optional speed and
    recency filters and derives every metric from the stored telemetry in a
    single pass. Real students never receive synthetic numbers: when fewer than
    four games match the filter the report is returned with
    ``insufficient=True`` and the fields that cannot be computed left empty.
    """
    wanted_speeds = _normalize_speeds(speeds)
    wanted_days = _normalize_days(days)
    is_demo = student_id.strip().lower().startswith("demo")

    if is_demo or not db.configured():
        is_aarav = "aarav" in student_id.lower() or "2145" in student_id
        demo_name = "Aarav Sharma" if is_aarav else f"Student {student_id[:6]}"
        return _build_synthetic_progress(student_id, demo_name)

    rows = _load_rows(student_id, coach_id)
    student_name = _resolve_student_name(student_id, rows)

    games: List[_Game] = []
    for row in rows:
        game = _extract_game(row)
        if game is not None:
            games.append(game)
    games.sort(
        key=lambda game: (
            game.played_at or datetime.min.replace(tzinfo=timezone.utc),
            game.analysis_id,
        )
    )
    total_games = len(games)

    if wanted_speeds:
        wanted = set(wanted_speeds)
        games = [game for game in games if game.speed in wanted]
    if wanted_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=wanted_days)
        games = [
            game
            for game in games
            if game.played_at is not None and game.played_at >= cutoff
        ]

    games_used = len(games)
    enough = games_used >= MIN_GAMES
    baseline, recent = _split_thirds(games)
    elo_series, acpl_series, accuracy_series, phase_series = _build_series(games)

    ratings = [game.rating for game in games if game.rating is not None]
    starting = float(ratings[0]) if ratings else 0.0
    current = float(ratings[-1]) if ratings else 0.0
    peak = float(max(ratings)) if ratings else 0.0
    rating_before = _window_mean(baseline, lambda game: game.rating)
    rating_after = _window_mean(recent, lambda game: game.rating)
    elo = EloProgress(
        starting=starting,
        current=current,
        peak=peak,
        net_gain=round(current - starting, 1),
        status=(
            _elo_status(rating_before, rating_after, current, starting, peak)
            if enough and len(ratings) >= 2
            else ""
        ),
        series=elo_series,
    )

    acpl_before = _window_mean(baseline, lambda game: game.acpl) if enough else None
    acpl_after = _window_mean(recent, lambda game: game.acpl) if enough else None
    net_drift = (
        _round(acpl_after - acpl_before)
        if acpl_before is not None and acpl_after is not None
        else None
    )
    direction: str = "stable"
    if net_drift is not None:
        if net_drift < -2:
            direction = "sharpening"
        elif net_drift > 2:
            direction = "decaying"
    acpl = AcplProgress(
        baseline=_round(acpl_before) if acpl_before is not None else None,
        recent=_round(acpl_after) if acpl_after is not None else None,
        net_drift=net_drift,
        direction=direction,  # type: ignore[arg-type]
        series=acpl_series,
    )

    accuracy_before = _window_mean(baseline, lambda game: game.accuracy) if enough else None
    accuracy_after = _window_mean(recent, lambda game: game.accuracy) if enough else None
    accuracy = AccuracyProgress(
        baseline=_round(accuracy_before) if accuracy_before is not None else None,
        current=_round(accuracy_after) if accuracy_after is not None else None,
        series=accuracy_series,
    )

    def phase_span(name: str) -> PhaseSpan:
        before = _window_mean(baseline, lambda game: getattr(game, name)) if enough else None
        after = _window_mean(recent, lambda game: getattr(game, name)) if enough else None
        return PhaseSpan(
            baseline=_round(before) if before is not None else None,
            current=_round(after) if after is not None else None,
        )

    opening = phase_span("opening")
    middlegame = phase_span("middlegame")
    endgame = phase_span("endgame")
    current_phases = {
        "Opening": opening.current,
        "Middlegame": middlegame.current,
        "Endgame": endgame.current,
    }
    scored_phases = {
        name: value for name, value in current_phases.items() if value is not None
    }
    best_phase = (
        max(scored_phases, key=lambda name: scored_phases[name])
        if scored_phases
        else None
    )
    lagging_phase = (
        min(scored_phases, key=lambda name: scored_phases[name])
        if scored_phases
        else None
    )
    if len(scored_phases) < 2:
        best_phase = None
        lagging_phase = None
    phases = PhaseProgress(
        opening=opening,
        middlegame=middlegame,
        endgame=endgame,
        best_phase=best_phase,
        lagging_phase=lagging_phase,
        series=phase_series,
    )

    signals = _build_signals(baseline, recent) if enough else []
    movement = _movement_items(signals) if enough else []
    root_causes = _root_causes(games)
    panic = _panic_buckets(games)
    key_errors = sum(len(game.moments) for game in games)
    radar = _radar_metrics(baseline, recent) if enough else []
    pillars = (
        _build_pillars(signals, root_causes, panic, key_errors)
        if enough
        else PillarGroups()
    )
    persona = (
        _build_persona(elo, signals, radar, root_causes, panic, key_errors)
        if enough
        else PersonaProfile(
            archetype="",
            summary_verdict="",
            strength_badge="",
            vulnerability_badge="",
            next_milestone="",
        )
    )
    focus_rules = (
        _focus_rules(signals, root_causes, panic, phases) if enough else []
    )

    return StudentProgressReport(
        student_id=student_id,
        student_name=student_name,
        identity=ProgressIdentity(
            accounts=_build_accounts(games),
            total_games=total_games,
            filtered_games=games_used,
            speeds=wanted_speeds,  # type: ignore[arg-type]
            days=wanted_days,
        ),
        elo=elo,
        acpl=acpl,
        accuracy=accuracy,
        phases=phases,
        movement=movement,
        pillars=pillars,
        root_causes=root_causes,
        radar=radar,
        panic=panic,
        persona=persona,
        focus_rules=focus_rules,
        games_used=games_used,
        insufficient=not enough,
    )
