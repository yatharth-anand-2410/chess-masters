"""Tests for the honest progress-report builder (``services/progress.py``).

Run from the backend directory::

    python -m pytest tests/test_progress_report.py -q

Every fixture row is a fake ``analyses`` dict in the shape Supabase returns, so
the tests exercise the real extraction path (``game_summary``, ``insights``,
PGN headers, ``created_at``) without touching the network or Stockfish.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import progress  # noqa: E402

BASE_DAY = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake rows
# ---------------------------------------------------------------------------


def _moment(
    motif: Optional[str] = None,
    clock: Optional[float] = None,
    cpl: float = 250,
    quality: str = "blunder",
    theme: Optional[str] = None,
    phase: str = "middlegame",
) -> Dict[str, Any]:
    return {
        "move_number": 24,
        "san": "Qd5",
        "color": "white",
        "phase": phase,
        "quality": quality,
        "centipawn_loss": cpl,
        "clock_remaining": clock,
        "resource_theme": theme or (motif.lower() if motif else "middlegame"),
        "motif": motif,
        "motif_details": f"Engine note for {motif}." if motif else None,
    }


def _primitives(accuracy: float, score: float) -> Dict[str, Any]:
    return {
        "overall_accuracy": accuracy,
        "player_score": score,
        "phase_accuracies": {"opening": 70.0, "middlegame": 60.0, "endgame": 50.0},
        "reached_winning_position": True,
        "converted_winning_position": score >= 1.0,
        "was_losing": score <= 0.0,
        "comeback": score >= 0.5,
        "blunder": 2,
        "mistake": 1,
        "accuracy_after_blunder": round(accuracy - 5.0, 1),
        "avg_move_seconds": 10.0,
        "fast_move_ratio": 0.25,
        "min_clock_seconds": 40.0,
        "time_trouble": False,
        "flag_loss": False,
        "rushed_blunders": 1,
        "slow_blunders": 1,
        "blunders_with_clock": 2,
        "clock_pressure": {"<30s": {"moves": 4, "blunders": 1}},
        "speed_profile": {"2-5s": 3},
    }


def _row(
    index: int,
    *,
    created_at: Optional[str] = None,
    rating: Optional[int] = None,
    accuracy: Optional[float] = None,
    speed: Optional[str] = "blitz",
    time_control: Optional[str] = "300+0",
    platform: str = "lichess",
    username: str = "tester",
    platform_summary: Optional[str] = None,
    username_summary: Optional[str] = None,
    result: str = "1-0",
    color: str = "white",
    moments: Optional[Sequence[Dict[str, Any]]] = None,
    phase_bonus: int = 0,
    quality_blunders: int = 2,
    include_summary: bool = True,
    status: str = "completed",
) -> Dict[str, Any]:
    rating = 1500 + index * 10 if rating is None else rating
    accuracy = 80.0 if accuracy is None else accuracy
    pgn_tc = time_control or "300+0"
    pgn = (
        f'[WhiteElo "{rating}"]\n'
        f'[BlackElo "{rating - 20}"]\n'
        f'[TimeControl "{pgn_tc}"]\n'
    )
    date = created_at or (
        BASE_DAY + timedelta(days=index)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    row: Dict[str, Any] = {
        "id": f"analysis-{index}",
        "status": status,
        "platform": platform,
        "username": username,
        "game_url": f"https://lichess.org/game-{index}",
        "player_color": color,
        "player_name": "Tester",
        "opening_name": "Sicilian Defence",
        "eco": "B20",
        "result": result,
        "created_at": date,
        "pgn": pgn,
        "insights": {"weakness_moments": list(moments or [])},
    }
    if include_summary:
        row["game_summary"] = {
            "speed": speed,
            "time_control": time_control,
            "username": username_summary or username,
            "platform": platform_summary or platform,
            "player_elo": rating,
            "opponent_name": "Opponent",
            "opponent_elo": rating - 20,
            "accuracy": accuracy,
            "phase_accuracies": {
                "opening": float(78 + index + phase_bonus),
                "middlegame": float(70 + index + phase_bonus),
                "endgame": float(62 + index + phase_bonus),
            },
            "quality": {
                "blunder": quality_blunders,
                "mistake": 3,
                "inaccuracy": 4,
            },
            "psychology": _primitives(accuracy, 1.0 if index % 2 == 0 else 0.0),
        }
    return row


class FakeDb:
    """Minimal in-memory stand-in for ``services.db``."""

    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self.rows = rows
        self.user_calls: List[Dict[str, Any]] = []
        self.student_calls: List[Dict[str, Any]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch, configured: bool = True) -> None:
        monkeypatch.setattr(progress.db, "configured", lambda: configured)
        monkeypatch.setattr(progress.db, "get_student_by_id", lambda sid: None)
        monkeypatch.setattr(progress.db, "get_user_profile", lambda sid: None)
        monkeypatch.setattr(
            progress.db, "list_analyses", self._list_analyses
        )
        monkeypatch.setattr(
            progress.db, "list_analyses_by_student", self._list_by_student
        )

    def _list_analyses(
        self, user_id: str, limit: int = 50, **kwargs: Any
    ) -> List[Dict[str, Any]]:
        self.user_calls.append(
            {"user_id": user_id, "limit": limit, "columns": kwargs.get("columns")}
        )
        return list(self.rows)

    def _list_by_student(
        self, user_id: str, student_id: str, limit: int = 100
    ) -> List[Dict[str, Any]]:
        self.student_calls.append(
            {"user_id": user_id, "student_id": student_id, "limit": limit}
        )
        return list(self.rows)


#: Twelve healthy games with a deliberate shape:
#:
#: * ratings 1500..1640 in tens, accuracies climbing 84% -> 85.5%
#: * first third (games 1-4): two Pin blunders (<30s) + one Fork blunder (2 min)
#: * middle third (games 5-8): one Fork blunder (over 3 min)
#: * last third (games 9-12): one Pin blunder (40s) + one endgame mistake
#: * games 9-12 are played on Chess.com under a second handle
_HEALTHY_ROWS: List[Dict[str, Any]] = [
    _row(
        0,
        rating=1500,
        accuracy=83.0,
        moments=[
            _moment("Pin", 10, 250),
            _moment("Pin", 20, 300),
            _moment("Fork", 120, 250),
        ],
    ),
    _row(
        1,
        rating=1510,
        accuracy=85.0,
        result="0-1",
        moments=[
            _moment("Pin", 12, 250),
            _moment("Pin", 25, 300),
            _moment("Fork", 130, 250),
        ],
    ),
    _row(
        2,
        rating=1520,
        accuracy=82.0,
        moments=[
            _moment("Pin", 8, 250),
            _moment("Pin", 18, 300),
            _moment("Fork", 140, 250),
        ],
    ),
    _row(
        3,
        rating=1530,
        accuracy=86.0,
        result="0-1",
        moments=[
            _moment("Pin", 15, 250),
            _moment("Pin", 22, 300),
            _moment("Fork", 150, 250),
        ],
    ),
    _row(4, rating=1540, accuracy=90.0, moments=[_moment("Fork", 240, 250)]),
    _row(
        5,
        rating=1550,
        accuracy=91.0,
        result="0-1",
        moments=[_moment("Fork", 260, 250)],
    ),
    _row(6, rating=1560, accuracy=92.0, moments=[_moment("Fork", 280, 250)]),
    _row(
        7,
        rating=1570,
        accuracy=93.0,
        result="0-1",
        moments=[_moment("Fork", 300, 250)],
    ),
    _row(
        8,
        rating=1580,
        accuracy=84.0,
        speed="rapid",
        time_control="600+0",
        platform_summary="chess.com",
        username_summary="TesterCC",
        moments=[
            _moment("Pin", 40, 250),
            _moment(None, 400, 120, quality="mistake", theme="endgame"),
        ],
    ),
    _row(
        9,
        rating=1600,
        accuracy=86.0,
        result="0-1",
        speed="rapid",
        time_control="600+0",
        platform_summary="chess.com",
        username_summary="TesterCC",
        moments=[
            _moment("Pin", 45, 250),
            _moment(None, 420, 120, quality="mistake", theme="endgame"),
        ],
    ),
    _row(
        10,
        rating=1620,
        accuracy=85.0,
        speed="rapid",
        time_control="600+0",
        platform_summary="chess.com",
        username_summary="TesterCC",
        moments=[
            _moment("Pin", 50, 250),
            _moment(None, 440, 120, quality="mistake", theme="endgame"),
        ],
    ),
    _row(
        11,
        rating=1640,
        accuracy=87.0,
        result="0-1",
        speed="rapid",
        time_control="600+0",
        platform_summary="chess.com",
        username_summary="TesterCC",
        moments=[
            _moment("Pin", 55, 250),
            _moment(None, 460, 120, quality="mistake", theme="endgame"),
        ],
    ),
]


def _healthy_report(monkeypatch: pytest.MonkeyPatch) -> progress.StudentProgressReport:
    db = FakeDb(_HEALTHY_ROWS)
    db.install(monkeypatch)
    return progress.build_student_progress("real-user-1")


# ---------------------------------------------------------------------------
# (a) Too few games -> honest insufficient report, never synthetic numbers
# ---------------------------------------------------------------------------


def test_fewer_than_four_games_is_honest(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        _row(0, rating=1500, accuracy=70.0, moments=[_moment("Pin", 10, 250)]),
        _row(1, rating=1510, accuracy=71.0, moments=[_moment("Fork", 12, 250)]),
        _row(2, rating=1520, accuracy=72.0, moments=[_moment("Pin", 14, 250)]),
    ]
    FakeDb(rows).install(monkeypatch)

    report = progress.build_student_progress("real-user-2")

    assert report.insufficient is True
    assert report.games_used == 3
    assert report.identity.total_games == 3
    assert report.identity.filtered_games == 3
    assert report.student_name == "tester"

    # Real single-game facts survive ...
    assert report.elo.starting == 1500
    assert report.elo.current == 1520
    assert report.elo.peak == 1520
    assert report.elo.net_gain == 20
    assert len(report.elo.series) == 3
    assert report.accuracy.series[2].accuracy == 72.0
    # ... real leak counts survive ...
    assert sum(cause.count for cause in report.root_causes) == 3
    assert sum(bucket.blunders for bucket in report.panic) == 3
    # ... but no baseline/current comparison is invented.
    assert report.movement == []
    assert report.pillars.improved == []
    assert report.pillars.improving == []
    assert report.pillars.needs_work == []
    assert report.radar == []
    assert report.focus_rules == []
    assert report.acpl.baseline is None
    assert report.acpl.recent is None
    assert report.acpl.net_drift is None
    assert report.acpl.direction == "stable"
    assert report.accuracy.baseline is None
    assert report.accuracy.current is None
    assert report.phases.opening.baseline is None
    assert report.phases.best_phase is None
    assert report.phases.lagging_phase is None
    assert report.elo.status == ""
    assert report.persona.archetype == ""
    assert report.persona.summary_verdict == ""
    assert report.persona.next_milestone == ""


def test_real_student_never_gets_the_synthetic_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeDb([]).install(monkeypatch)
    report = progress.build_student_progress("some-real-user")
    assert report.insufficient is True
    assert report.games_used == 0
    assert report.identity.total_games == 0
    assert report.persona.archetype == ""
    assert report.elo.current == 0
    assert "aarav" not in report.student_name.lower()


def test_demo_roster_and_unconfigured_db_use_the_showcase_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeDb(_HEALTHY_ROWS)
    fake.install(monkeypatch)

    demo = progress.build_student_progress("demo-aarav")
    assert demo.insufficient is False
    assert demo.games_used == 14
    assert demo.identity.accounts[0].username == "aarav_sharma"
    assert demo.persona.archetype != ""
    assert fake.user_calls == []  # no database traffic for the demo roster

    monkeypatch.setattr(progress.db, "configured", lambda: False)
    offline = progress.build_student_progress("real-user-3")
    assert offline.insufficient is False
    assert offline.games_used == 14
    assert fake.user_calls == []


# ---------------------------------------------------------------------------
# (b) Healthy 12-game set -> real movement / pillars / root causes / panic
# ---------------------------------------------------------------------------


def test_healthy_report_counts_and_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)

    assert report.insufficient is False
    assert report.games_used == 12
    assert report.identity.total_games == 12
    assert report.identity.filtered_games == 12
    assert report.identity.speeds == []
    assert report.identity.days is None

    accounts = report.identity.accounts
    assert [(a.platform, a.username, a.games, a.rating) for a in accounts] == [
        ("lichess", "tester", 8, 1570),
        ("chess.com", "TesterCC", 4, 1640),
    ]


def test_healthy_elo_accuracy_and_phases(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)

    assert (report.elo.starting, report.elo.current, report.elo.peak) == (
        1500.0,
        1640.0,
        1640.0,
    )
    assert report.elo.net_gain == 140.0
    assert report.elo.status == "accelerating"
    assert len(report.elo.series) == 12
    assert report.elo.series[0].rating == 1500.0
    assert report.elo.series[-1].speed == "rapid"
    assert report.elo.series[0].result == "win"
    assert report.elo.series[1].result == "loss"

    # Accuracy: first third (83, 85, 82, 86) vs last third (84, 86, 85, 87).
    assert report.accuracy.baseline == 84.0
    assert report.accuracy.current == 85.5
    assert len(report.accuracy.series) == 12

    # Phase accuracies climb by exactly one point per game.
    assert report.phases.opening.baseline == 79.5
    assert report.phases.opening.current == 87.5
    assert report.phases.middlegame.baseline == 71.5
    assert report.phases.middlegame.current == 79.5
    assert report.phases.endgame.baseline == 63.5
    assert report.phases.endgame.current == 71.5
    assert report.phases.best_phase == "Opening"
    assert report.phases.lagging_phase == "Endgame"
    assert len(report.phases.series) == 12

    # ACPL is the mean centipawn loss of the flagged moments per game.
    assert report.acpl.baseline == 266.7
    assert report.acpl.recent == 185.0
    assert report.acpl.net_drift == -81.7
    assert report.acpl.direction == "sharpening"
    assert report.acpl.series[0].acpl == 266.7
    assert report.acpl.series[-1].acpl == 185.0


def test_healthy_movement_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)

    items = {item.key: item for item in report.movement}
    assert list(items) == ["rating", "acpl", "time_trouble", "phase_accuracy", "tilt"]

    rating = items["rating"]
    assert (rating.before, rating.after, rating.delta) == (1515.0, 1610.0, 95.0)
    assert rating.unit == "Elo"
    assert rating.direction == "up"
    assert rating.higher_is_better is True

    acpl = items["acpl"]
    assert (acpl.before, acpl.after, acpl.delta) == (266.7, 185.0, -81.7)
    assert acpl.unit == "cp"
    assert acpl.direction == "down"
    assert acpl.higher_is_better is False

    clock = items["time_trouble"]
    assert (clock.before, clock.after, clock.delta) == (66.7, 0.0, -66.7)
    assert clock.unit == "%"
    assert clock.higher_is_better is False

    phase = items["phase_accuracy"]
    assert (phase.before, phase.after, phase.delta) == (71.5, 79.5, 8.0)
    assert phase.higher_is_better is True

    tilt = items["tilt"]
    assert (tilt.before, tilt.after, tilt.delta) == (-3.5, -1.5, 2.0)
    assert tilt.higher_is_better is True

    assert all(item.insufficient in (None, False) for item in report.movement)


def test_healthy_pillars_carry_real_numbers(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)
    pillars = report.pillars

    assert all(item.status == "mastered" for item in pillars.improved)
    assert all(item.status == "improving" for item in pillars.improving)
    assert all(item.status == "needs_work" for item in pillars.needs_work)

    improved_titles = [item.title for item in pillars.improved]
    assert "Rating drift (window average)" in improved_titles
    assert "Sub-30s blunder rate" in improved_titles
    clock = next(
        item for item in pillars.improved if item.title == "Sub-30s blunder rate"
    )
    assert "8/12 → 0/4" in clock.metric
    assert all("→" in item.metric for item in pillars.improved)

    improving_titles = [item.title for item in pillars.improving]
    assert "Post-loss tilt" in improving_titles
    assert "Accuracy" in improving_titles
    accuracy = next(item for item in pillars.improving if item.title == "Accuracy")
    assert accuracy.metric == "Accuracy: 84% → 85.5%"

    needs_titles = [item.title for item in pillars.needs_work]
    assert "Pin leak" in needs_titles
    assert "Clock panic" in needs_titles
    pin = next(item for item in pillars.needs_work if item.title == "Pin leak")
    assert pin.metric == "12 of 24 key errors (50%)"


def test_healthy_root_causes_and_panic(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)

    causes = {cause.category: cause for cause in report.root_causes}
    assert set(causes) == {"Pin", "Fork", "Endgame mistakes"}
    assert causes["Pin"].count == 12
    assert causes["Pin"].percentage == 50.0
    assert causes["Pin"].primary_motif == "pin"
    assert "12 of 24 key errors (50%)" in causes["Pin"].description
    assert "8 of them happened with under 30 seconds" in causes["Pin"].description
    assert causes["Fork"].count == 8
    assert causes["Fork"].percentage == 33.3
    assert causes["Fork"].primary_motif == "fork"
    assert causes["Endgame mistakes"].count == 4
    assert causes["Endgame mistakes"].percentage == 16.7
    assert causes["Endgame mistakes"].primary_motif == "endgame"

    buckets = {bucket.bucket: bucket for bucket in report.panic}
    assert list(buckets) == ["< 30s", "30s - 1m", "1 - 3 min", "> 3 min"]
    assert buckets["< 30s"].blunders == 8
    assert buckets["< 30s"].games == 4
    assert buckets["< 30s"].percentage == 40.0
    assert buckets["< 30s"].worst is True
    assert buckets["30s - 1m"].blunders == 4
    assert buckets["30s - 1m"].games == 4
    assert buckets["30s - 1m"].percentage == 20.0
    assert buckets["30s - 1m"].worst in (None, False)
    assert buckets["1 - 3 min"].blunders == 4
    assert buckets["1 - 3 min"].games == 4
    assert buckets["> 3 min"].blunders == 4
    assert buckets["> 3 min"].games == 4
    assert sum(bucket.blunders for bucket in report.panic) == 20


def test_theme_only_moments_share_the_motif_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Old moments without a motif label still group with the labelled ones."""
    rows = [
        _row(index, moments=[_moment(None, 10, 250, theme="pin")])
        for index in range(4)
    ]
    FakeDb(rows).install(monkeypatch)

    report = progress.build_student_progress("real-user-5")
    assert [cause.category for cause in report.root_causes] == ["Pin"]
    assert report.root_causes[0].primary_motif == "pin"
    assert report.root_causes[0].count == 4
    assert report.root_causes[0].percentage == 100.0


def test_healthy_radar_persona_and_focus_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = _healthy_report(monkeypatch)

    assert len(report.radar) >= 3
    for metric in report.radar:
        assert 0 <= metric.baseline_score <= 100
        assert 0 <= metric.current_score <= 100
        assert metric.delta == pytest.approx(
            metric.current_score - metric.baseline_score, abs=0.01
        )
    assert "Consistency" in {metric.dimension for metric in report.radar}

    persona = report.persona
    assert persona.archetype != ""
    assert "1500" in persona.summary_verdict
    assert "1640" in persona.summary_verdict
    assert persona.next_milestone == "Reach 1700 Elo (+60 from 1640)"
    assert persona.vulnerability_badge == "Sub-30s clock panic"

    assert 2 <= len(report.focus_rules) <= 4
    joined = " ".join(report.focus_rules).lower()
    assert "pin" in joined
    assert "endgame" in joined


# ---------------------------------------------------------------------------
# (c) Speed and day filters really shrink identity.filtered_games
# ---------------------------------------------------------------------------


def _filter_rows() -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows: List[Dict[str, Any]] = []
    for index in range(12):
        speed = "blitz" if index < 6 else "rapid"
        created = (now - timedelta(days=index * 20)).strftime("%Y-%m-%dT%H:%M:%SZ")
        if index == 11:
            # Oldest row predates the telemetry capture: no game_summary at all,
            # so the speed has to come from the PGN TimeControl header.
            rows.append(
                _row(
                    index,
                    created_at=created,
                    speed=None,
                    time_control="60+0",
                    include_summary=False,
                )
            )
            continue
        rows.append(
            _row(
                index,
                created_at=created,
                speed=speed,
                time_control="300+0" if speed == "blitz" else "600+0",
            )
        )
    return rows


def test_speed_filter_reduces_filtered_games(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeDb(_filter_rows()).install(monkeypatch)

    report = progress.build_student_progress("real-user-4", speeds=["blitz"])
    assert report.identity.total_games == 12
    assert report.identity.filtered_games == 6
    assert report.games_used == 6
    assert report.identity.speeds == ["blitz"]

    rapid = progress.build_student_progress(
        "real-user-4", speeds=["rapid", "bullet"]
    )
    assert rapid.identity.filtered_games == 6
    # Echoed in the canonical chip order used by the frontend.
    assert rapid.identity.speeds == ["bullet", "rapid"]
    assert rapid.games_used == 6


def test_pgn_time_control_is_used_when_telemetry_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeDb(_filter_rows()).install(monkeypatch)

    report = progress.build_student_progress("real-user-4", speeds=["bullet"])
    assert report.games_used == 1
    assert report.elo.series[0].speed == "bullet"
    assert report.identity.filtered_games == 1


def test_days_filter_reduces_filtered_games(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeDb(_filter_rows()).install(monkeypatch)

    report = progress.build_student_progress("real-user-4", days=90)
    # Games exactly 0, 20, 40, 60 and 80 days old are inside the window.
    assert report.identity.total_games == 12
    assert report.identity.filtered_games == 5
    assert report.identity.days == 90
    assert report.games_used == 5

    combined = progress.build_student_progress(
        "real-user-4", speeds=["rapid"], days=90
    )
    assert combined.identity.filtered_games == 0
    assert combined.insufficient is True
    assert combined.movement == []
    assert combined.games_used == 0


def test_coach_path_uses_student_scoped_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeDb(_HEALTHY_ROWS)
    fake.install(monkeypatch)

    report = progress.build_student_progress(
        "student-9", coach_id="coach-1", days=3650
    )
    assert fake.student_calls == [
        {"user_id": "coach-1", "student_id": "student-9", "limit": 100}
    ]
    assert fake.user_calls == []
    assert report.identity.filtered_games == 12
    assert report.identity.days == 3650


# ---------------------------------------------------------------------------
# Helpers and shape
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("60+0", "bullet"),
        ("120+0", "bullet"),
        ("180+0", "blitz"),
        ("300+0", "blitz"),
        ("300", "blitz"),
        ("600+0", "rapid"),
        ("900+10", "rapid"),
        ("1800+0", "classical"),
        ("40/7200+30", "classical"),
        ("1/259200", "correspondence"),
        ("300+0,300+0", "blitz"),
        ("-", None),
        ("", None),
        (None, None),
    ],
)
def test_speed_derivation_from_time_control(
    value: Optional[str], expected: Optional[str]
) -> None:
    assert progress._speed_from_time_control(value) == expected


def test_payload_matches_typescript_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    report = _healthy_report(monkeypatch)
    payload = json.loads(json.dumps(report.model_dump()))

    assert set(payload) == {
        "student_id",
        "student_name",
        "identity",
        "elo",
        "acpl",
        "accuracy",
        "phases",
        "movement",
        "pillars",
        "root_causes",
        "radar",
        "panic",
        "persona",
        "focus_rules",
        "games_used",
        "insufficient",
    }
    assert set(payload["identity"]) == {
        "accounts",
        "total_games",
        "filtered_games",
        "speeds",
        "days",
    }
    assert set(payload["identity"]["accounts"][0]) == {
        "platform",
        "username",
        "games",
        "rating",
    }
    assert set(payload["elo"]) == {
        "starting",
        "current",
        "peak",
        "net_gain",
        "status",
        "series",
    }
    assert set(payload["elo"]["series"][0]) == {
        "date",
        "game_id",
        "result",
        "speed",
        "rating",
        "accuracy",
        "acpl",
        "opening",
        "middlegame",
        "endgame",
    }
    assert set(payload["acpl"]) == {
        "baseline",
        "recent",
        "net_drift",
        "direction",
        "series",
    }
    assert set(payload["accuracy"]) == {"baseline", "current", "series"}
    assert set(payload["phases"]) == {
        "opening",
        "middlegame",
        "endgame",
        "best_phase",
        "lagging_phase",
        "series",
    }
    assert set(payload["phases"]["opening"]) == {"baseline", "current"}
    assert set(payload["movement"][0]) == {
        "key",
        "label",
        "before",
        "after",
        "delta",
        "unit",
        "direction",
        "higher_is_better",
        "insufficient",
    }
    assert set(payload["pillars"]) == {"improved", "improving", "needs_work"}
    assert set(payload["pillars"]["improved"][0]) == {
        "title",
        "metric",
        "detail",
        "status",
    }
    assert set(payload["root_causes"][0]) == {
        "category",
        "count",
        "percentage",
        "primary_motif",
        "description",
    }
    assert set(payload["radar"][0]) == {
        "dimension",
        "baseline_score",
        "current_score",
        "delta",
    }
    assert set(payload["panic"][0]) == {
        "bucket",
        "label",
        "blunders",
        "games",
        "percentage",
        "worst",
    }
    assert set(payload["persona"]) == {
        "archetype",
        "summary_verdict",
        "strength_badge",
        "vulnerability_badge",
        "next_milestone",
    }


def test_legacy_progress_attributes_still_resolve(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``services/copilot.py`` reads the pre-rollout attribute names."""
    report = _healthy_report(monkeypatch)

    assert report.elo_trajectory.current_rating == 1640.0
    assert report.persona_profile.archetype == report.persona.archetype
    assert (
        report.three_pillar_mastery.what_needs_work[0].title
        == report.pillars.needs_work[0].title
    )
