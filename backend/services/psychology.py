"""Derive evidence-based chess psychology signals from engine + clock data.

The module is deliberately deterministic: every dimension shown to the player
is computed from the games themselves, so the coaching report has to ground its
claims in real observations rather than inventing a personality.

Two layers:

* :func:`build_game_primitives` runs per game (from ``AnalysisResult`` plus the
  parsed move clocks) and returns compact, JSON-serializable facts.
* :func:`build_batch_profile` merges those facts across games into a profile
  (dimensions with rubric tags, ranked leaks with fix protocols, form timeline,
  clock-pressure buckets and a player-type leaning) with human-readable
  evidence.
"""

from __future__ import annotations

import statistics
from typing import Dict, List, Optional, Sequence, Tuple

from services import engine

MIN_GAMES_FOR_PROFILE = 3
WINNING_EVAL_PAWNS = 1.5
LOSING_EVAL_PAWNS = -1.5

RUSHED_MOVE_SECONDS = 5.0
FAST_MOVE_SECONDS = 3.0
SLOW_MOVE_SECONDS = 15.0
TIME_TROUBLE_FLOOR_SECONDS = 30.0
TIME_TROUBLE_CAP_SECONDS = 120.0

STRONG_SCORE = 70
DEVELOP_SCORE = 40
MAX_LEAKS = 3

DIMENSION_ORDER: Tuple[str, ...] = (
    "consistency",
    "time_management",
    "composure",
    "tilt",
    "conversion",
    "fighting_spirit",
)

DIMENSION_LABELS = {
    "consistency": "Consistency",
    "time_management": "Time management",
    "composure": "Composure",
    "tilt": "Tilt resistance",
    "conversion": "Converting advantages",
    "fighting_spirit": "Fighting spirit",
}

DIMENSION_SHORT = {
    "consistency": "Consistency",
    "time_management": "Time",
    "composure": "Composure",
    "tilt": "Tilt",
    "conversion": "Conversion",
    "fighting_spirit": "Fighting spirit",
}

FIX_PROTOCOLS = {
    "consistency": (
        "Warm up with ten minutes of puzzles before rated games, and treat the "
        "first game of a session as a warm-up rather than a test."
    ),
    "time_management": (
        "On any move where you have under five seconds, run a one-second scan "
        "for checks, captures and threats before you commit."
    ),
    "composure": (
        "After a blunder, pause and re-scan the board before touching a piece — "
        "decide the next three moves with extra care."
    ),
    "tilt": (
        "Set a stop-loss: after two losses in a row, step away for ten minutes "
        "before queueing again."
    ),
    "conversion": (
        "When you are clearly winning, slow down and trade pieces rather than "
        "pawns; check for stalemate and back-rank tricks before every push."
    ),
    "fighting_spirit": (
        "In a lost position, set a mini-goal: make the next five moves the "
        "hardest your opponent has had all game."
    ),
}

PLAYER_TYPE_LABELS = {
    "activist": "Activist — you play for initiative and sharp positions",
    "pragmatist": "Pragmatist — concrete, practical decisions",
    "theorist": "Theorist — structure and long-term plans",
    "reflector": "Reflector — prophylaxis and restricting your opponent",
}

PLAYER_TYPE_SHORT = {
    "activist": "Activist",
    "pragmatist": "Pragmatist",
    "theorist": "Theorist",
    "reflector": "Reflector",
}

SHARP_OPENING_KEYWORDS = (
    "gambit",
    "sicilian",
    "najdorf",
    "dragon",
    "king's indian",
    "kings indian",
    "benoni",
    "dutch",
    "attack",
    "poisoned",
    "grunfeld",
    "grünfeld",
)

SPEED_BUCKETS: Tuple[Tuple[str, float, float], ...] = (
    ("<2s", 0.0, 2.0),
    ("2-5s", 2.0, 5.0),
    ("5-15s", 5.0, 15.0),
    ("15-60s", 15.0, 60.0),
    (">60s", 60.0, float("inf")),
)

CLOCK_BUCKETS: Tuple[Tuple[str, float, float], ...] = (
    ("<30s", 0.0, 30.0),
    ("30-60s", 30.0, 60.0),
    ("1-2m", 60.0, 120.0),
    ("2-5m", 120.0, 300.0),
    (">5m", 300.0, float("inf")),
)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _bucket_for(value: float, buckets: Sequence[Tuple[str, float, float]]) -> str:
    for label, low, high in buckets:
        if low <= value < high:
            return label
    return buckets[-1][0]


def _tag_for_score(score: float) -> str:
    if score >= STRONG_SCORE:
        return "strong"
    if score >= DEVELOP_SCORE:
        return "develop"
    return "weak"


def _panel_score(score: float) -> int:
    return int(round(_clamp(score)))


def _player_score(result: Optional[str], player_color: Optional[str]) -> Optional[float]:
    if player_color not in ("white", "black"):
        return None
    if result == "1-0":
        return 1.0 if player_color == "white" else 0.0
    if result == "0-1":
        return 1.0 if player_color == "black" else 0.0
    if result == "1/2-1/2":
        return 0.5
    return None


def _time_trouble_threshold(time_control: Optional[str]) -> float:
    if not time_control:
        return TIME_TROUBLE_CAP_SECONDS
    base_part = time_control.split("+", 1)[0]
    if "/" in base_part:
        base_part = base_part.rsplit("/", 1)[-1]
    try:
        base = float(base_part)
    except ValueError:
        return TIME_TROUBLE_CAP_SECONDS
    threshold = max(TIME_TROUBLE_FLOOR_SECONDS, base * 0.15)
    return min(TIME_TROUBLE_CAP_SECONDS, threshold)


def _player_moves(analysis: engine.AnalysisResult) -> List[engine.MoveInfo]:
    if analysis.player_color not in ("white", "black"):
        return []
    return [move for move in analysis.moves if move.color == analysis.player_color]


def _eval_curve_player_view(analysis: engine.AnalysisResult) -> List[float]:
    curve = analysis.eval_curve_pawns
    if not curve or analysis.player_color not in ("white", "black"):
        return []
    if analysis.player_color == "white":
        return list(curve)
    return [-value for value in curve]


def _accuracy_after_blunders(player_moves: List[engine.MoveInfo]) -> Optional[float]:
    recovery_scores: List[float] = []
    for index, move in enumerate(player_moves):
        if move.quality != engine.QUALITY_BLUNDER:
            continue
        following = player_moves[index + 1 : index + 4]
        if not following:
            continue
        recovery_scores.append(
            sum(engine._move_accuracy(entry) for entry in following) / len(following)
        )
    if not recovery_scores:
        return None
    return round(sum(recovery_scores) / len(recovery_scores), 1)


def _clock_pressure(player_moves: List[engine.MoveInfo]) -> Dict[str, Dict[str, int]]:
    buckets: Dict[str, Dict[str, int]] = {}
    for move in player_moves:
        if move.clock_remaining is None:
            continue
        label = _bucket_for(float(move.clock_remaining), CLOCK_BUCKETS)
        entry = buckets.setdefault(label, {"moves": 0, "blunders": 0})
        entry["moves"] += 1
        if move.quality == engine.QUALITY_BLUNDER:
            entry["blunders"] += 1
    return buckets


def _speed_profile(player_moves: List[engine.MoveInfo]) -> Dict[str, int]:
    buckets: Dict[str, int] = {}
    for move in player_moves:
        if move.seconds_spent is None:
            continue
        label = _bucket_for(float(move.seconds_spent), SPEED_BUCKETS)
        buckets[label] = buckets.get(label, 0) + 1
    return buckets


def build_game_primitives(analysis: engine.AnalysisResult) -> Dict[str, object]:
    """Compact per-game facts used by the batch psychology profile."""
    player_moves = _player_moves(analysis)
    timed_moves = [move for move in player_moves if move.seconds_spent is not None]
    blunders = [move for move in player_moves if move.quality == engine.QUALITY_BLUNDER]
    blunders_with_clock = [move for move in blunders if move.seconds_spent is not None]
    clocks = [
        move.clock_remaining
        for move in player_moves
        if move.clock_remaining is not None
    ]

    player_view = _eval_curve_player_view(analysis)
    peak = round(max(player_view), 2) if player_view else None
    trough = round(min(player_view), 2) if player_view else None
    reached_winning = peak is not None and peak >= WINNING_EVAL_PAWNS
    was_losing = trough is not None and trough <= LOSING_EVAL_PAWNS
    player_score = _player_score(analysis.result, analysis.player_color)
    converted: Optional[bool] = None
    if reached_winning and player_score is not None:
        converted = player_score >= 1.0
    comeback: Optional[bool] = None
    if was_losing and player_score is not None:
        comeback = player_score >= 0.5

    min_clock = round(min(clocks), 1) if clocks else None
    threshold = _time_trouble_threshold(analysis.time_control)
    time_trouble: Optional[bool] = None
    if min_clock is not None:
        time_trouble = min_clock <= threshold

    termination = (analysis.termination or "").strip().lower()
    flag_loss: Optional[bool] = None
    if player_score is not None and termination:
        flag_loss = player_score == 0.0 and "time" in termination

    return {
        "result": analysis.result,
        "player_color": analysis.player_color,
        "player_score": player_score,
        "overall_accuracy": analysis.overall_accuracy,
        "phase_accuracies": analysis.phase_accuracies,
        "peak_advantage_pawns": peak,
        "trough_advantage_pawns": trough,
        "reached_winning_position": reached_winning,
        "converted_winning_position": converted,
        "was_losing": was_losing,
        "comeback": comeback,
        "blunder": int(analysis.statistics.get(engine.QUALITY_BLUNDER, 0) or 0),
        "mistake": int(analysis.statistics.get(engine.QUALITY_MISTAKE, 0) or 0),
        "inaccuracy": int(analysis.statistics.get(engine.QUALITY_INACCURACY, 0) or 0),
        "accuracy_after_blunder": _accuracy_after_blunders(player_moves),
        "avg_move_seconds": (
            round(sum(move.seconds_spent for move in timed_moves) / len(timed_moves), 1)
            if timed_moves
            else None
        ),
        "fast_move_ratio": (
            round(
                sum(
                    1
                    for move in timed_moves
                    if float(move.seconds_spent) <= FAST_MOVE_SECONDS
                )
                / len(timed_moves),
                2,
            )
            if timed_moves
            else None
        ),
        "min_clock_seconds": min_clock,
        "time_trouble": time_trouble,
        "flag_loss": flag_loss,
        "rushed_blunders": (
            sum(
                1
                for move in blunders_with_clock
                if float(move.seconds_spent) <= RUSHED_MOVE_SECONDS
            )
            if blunders_with_clock
            else None
        ),
        "slow_blunders": (
            sum(
                1
                for move in blunders_with_clock
                if float(move.seconds_spent) >= SLOW_MOVE_SECONDS
            )
            if blunders_with_clock
            else None
        ),
        "blunders_with_clock": len(blunders_with_clock) or None,
        "clock_pressure": _clock_pressure(player_moves),
        "speed_profile": _speed_profile(player_moves),
        "started_at": analysis.started_at,
        "time_control": analysis.time_control,
    }


def _dimension(key: str, score: float, evidence: str) -> Dict[str, object]:
    value = _panel_score(score)
    return {
        "key": key,
        "label": DIMENSION_LABELS[key],
        "short_label": DIMENSION_SHORT[key],
        "score": value,
        "tag": _tag_for_score(value),
        "evidence": evidence,
    }


def _mean(values: Sequence[float]) -> Optional[float]:
    clean = [float(value) for value in values if value is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _ordered(games: List[Dict[str, object]]) -> List[Dict[str, object]]:
    indexed = list(enumerate(games))
    if all(
        isinstance((game.get("psychology") or {}).get("started_at"), str)
        for _, game in indexed
    ):
        indexed.sort(
            key=lambda item: str(((item[1].get("psychology") or {})).get("started_at"))
        )
    return [game for _, game in indexed]


def _consistency_dimension(accuracies: List[float]) -> Optional[Dict[str, object]]:
    if len(accuracies) < 2:
        return None
    spread = statistics.pstdev(accuracies)
    score = 100 - spread * 2.2
    evidence = (
        f"Game accuracy ranged from {min(accuracies):.0f} to {max(accuracies):.0f} "
        f"across {len(accuracies)} games."
    )
    if spread <= 5:
        evidence = (
            f"Your accuracy stayed within {max(accuracies) - min(accuracies):.0f} "
            "points across every game — a steady baseline."
        )
    return _dimension("consistency", score, evidence)


def _time_management_dimension(
    primitives: List[Dict[str, object]], game_count: int
) -> Optional[Dict[str, object]]:
    with_clock = [entry for entry in primitives if entry.get("blunders_with_clock")]
    averages = [
        float(entry["avg_move_seconds"])
        for entry in primitives
        if entry.get("avg_move_seconds") is not None
    ]
    trouble_games = sum(1 for entry in primitives if entry.get("time_trouble"))
    flag_losses = sum(1 for entry in primitives if entry.get("flag_loss"))
    if not with_clock and not averages:
        return None

    total_blunders = sum(int(entry["blunders_with_clock"]) for entry in with_clock)
    rushed = min(
        total_blunders,
        sum(int(entry.get("rushed_blunders") or 0) for entry in with_clock),
    )
    rushed_ratio = (rushed / total_blunders) if total_blunders else 0.0
    trouble_ratio = trouble_games / game_count if game_count else 0.0
    score = 100 - rushed_ratio * 70 - trouble_ratio * 20 - min(flag_losses, 3) * 10
    average_seconds = _mean(averages)

    parts: List[str] = []
    if total_blunders and rushed:
        parts.append(
            f"{rushed} of your {total_blunders} clocked blunders came on moves "
            "with under 5 seconds spent."
        )
    if trouble_games:
        parts.append(
            f"You dropped into time trouble in {trouble_games} of {game_count} games."
        )
    if flag_losses:
        parts.append(f"You lost {flag_losses} game(s) on time.")
    if average_seconds is not None:
        parts.append(f"Your average move took about {average_seconds:.0f} seconds.")
    if not parts:
        parts.append("Your clock use was calm and controlled in this sample.")
    return _dimension("time_management", score, " ".join(parts))


def _composure_dimension(
    primitives: List[Dict[str, object]],
    accuracies: List[float],
) -> Optional[Dict[str, object]]:
    recovery = [
        float(entry["accuracy_after_blunder"])
        for entry in primitives
        if entry.get("accuracy_after_blunder") is not None
    ]
    overall = _mean(accuracies)
    if not recovery or overall is None:
        return None
    recovery_mean = _mean(recovery)
    delta = recovery_mean - overall
    score = 80 + delta * 2.5
    if delta >= -2:
        evidence = (
            "You steady yourself after your own mistakes — the moves that "
            "follow hold your usual accuracy."
        )
    elif delta >= -8:
        evidence = (
            "Your accuracy slips somewhat after a blunder, though it does not "
            "collapse."
        )
    else:
        evidence = (
            "Your play dips right after a blunder: the moves that follow are "
            "noticeably less accurate than your game average."
        )
    return _dimension("composure", score, evidence)


def _tilt_dimension(games: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    after_loss: List[float] = []
    after_win: List[float] = []
    for previous, current in zip(games, games[1:]):
        previous_primitive = previous.get("psychology") or {}
        current_primitive = current.get("psychology") or {}
        accuracy = current_primitive.get("overall_accuracy")
        if accuracy is None:
            continue
        previous_score = previous_primitive.get("player_score")
        if previous_score == 0.0:
            after_loss.append(float(accuracy))
        elif previous_score == 1.0:
            after_win.append(float(accuracy))

    if not after_loss or not after_win:
        return None
    loss_mean = _mean(after_loss)
    win_mean = _mean(after_win)
    drop = win_mean - loss_mean
    if drop > 5:
        score = 70 - (drop - 5) * 3
        evidence = (
            f"After a loss your next game averaged {drop:.0f} accuracy points "
            "below your games after a win — a tilt-style dip."
        )
    elif drop < -5:
        score = 78
        evidence = "A loss seems to sharpen you: your next game is stronger."
    else:
        score = 72
        evidence = "Your results don't swing much from game to game."
    return _dimension("tilt", score, evidence)


def _conversion_dimension(primitives: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    chances = [
        entry for entry in primitives if entry.get("reached_winning_position")
    ]
    if not chances:
        return None
    converted = sum(1 for entry in chances if entry.get("converted_winning_position"))
    rate = converted / len(chances)
    evidence = (
        f"You reached a clearly winning position in {len(chances)} of these games "
        f"and closed out {converted}."
    )
    return _dimension("conversion", rate * 100, evidence)


def _fighting_spirit_dimension(
    primitives: List[Dict[str, object]],
) -> Optional[Dict[str, object]]:
    lost_positions = [entry for entry in primitives if entry.get("was_losing")]
    if not lost_positions:
        return None
    rescued = sum(1 for entry in lost_positions if entry.get("comeback"))
    rate = rescued / len(lost_positions)
    evidence = (
        f"You fell to a clearly worse position in {len(lost_positions)} of these "
        f"games and salvaged {rescued}."
    )
    return _dimension("fighting_spirit", rate * 100, evidence)


def _phase_mean(primitives: List[Dict[str, object]], phase: str) -> Optional[float]:
    values: List[float] = []
    for entry in primitives:
        accuracies = entry.get("phase_accuracies") or {}
        if isinstance(accuracies, dict) and accuracies.get(phase) is not None:
            values.append(float(accuracies[phase]))
    return _mean(values)


def _player_type(
    games: List[Dict[str, object]],
    primitives: List[Dict[str, object]],
    accuracies: List[float],
    consistency_score: float,
) -> Dict[str, object]:
    game_count = len(games) or 1
    overall = _mean(accuracies) or 60.0
    blunder_rate = (
        sum(int(entry.get("blunder") or 0) for entry in primitives) / game_count
    )
    fast_ratios = [
        float(entry["fast_move_ratio"])
        for entry in primitives
        if entry.get("fast_move_ratio") is not None
    ]
    fast_ratio = _mean(fast_ratios) or 0.0
    sharp = sum(
        1
        for game in games
        if any(
            keyword in str(game.get("opening_name") or "").lower()
            for keyword in SHARP_OPENING_KEYWORDS
        )
    )

    middlegame = _phase_mean(primitives, "middlegame")
    endgame = _phase_mean(primitives, "endgame")
    opening = _phase_mean(primitives, "opening")
    middlegame_edge = (
        (middlegame - endgame)
        if middlegame is not None and endgame is not None
        else 0.0
    )
    endgame_edge = -middlegame_edge
    opening_edge = (
        (opening - middlegame)
        if opening is not None and middlegame is not None
        else 0.0
    )
    aggression = sharp / game_count

    scores = {
        "activist": 45 + aggression * 25 + max(0.0, middlegame_edge) * 1.1 + fast_ratio * 18,
        "pragmatist": 52 + (overall - 70) * 0.8 - blunder_rate * 6 + max(0.0, endgame_edge) * 0.4,
        "theorist": 48 + max(0.0, endgame_edge) * 1.1 + max(0.0, opening_edge) * 0.7 + (consistency_score - 50) * 0.25,
        "reflector": 46 + consistency_score * 0.22 + (1 - aggression) * 10 + max(0.0, endgame_edge) * 0.3,
    }
    ordered_scores = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    winner, winner_score = ordered_scores[0]
    margin = winner_score - ordered_scores[1][1]
    confidence = "medium" if margin >= 12 and game_count >= 4 else "low"

    evidence: List[str] = []
    if sharp:
        evidence.append(
            f"You chose sharp, double-edged openings in {sharp} of {game_count} games."
        )
    if middlegame_edge >= 8:
        evidence.append("Your middlegame play is stronger than your endgame technique.")
    elif endgame_edge >= 8:
        evidence.append("Your endgame accuracy is a clear strength compared with the middlegame.")
    if opening_edge >= 8:
        evidence.append("You tend to come out of the opening with accurate play.")
    return {
        "player_type": winner,
        "player_type_label": PLAYER_TYPE_LABELS[winner],
        "player_type_confidence": confidence,
        "type_evidence": evidence,
        "type_scores": {key: _panel_score(value) for key, value in scores.items()},
    }


def _form(games: List[Dict[str, object]]) -> List[Dict[str, object]]:
    form: List[Dict[str, object]] = []
    previous_score: Optional[float] = None
    for game in games:
        primitive = game.get("psychology") or {}
        accuracy = primitive.get("overall_accuracy")
        if accuracy is None:
            previous_score = primitive.get("player_score")
            continue
        form.append(
            {
                "label": game.get("label"),
                "accuracy": round(float(accuracy), 1),
                "score": primitive.get("player_score"),
                "after_loss": previous_score == 0.0,
            }
        )
        previous_score = primitive.get("player_score")
    return form


def _speed_totals(primitives: List[Dict[str, object]]) -> List[Dict[str, object]]:
    totals: Dict[str, int] = {}
    for entry in primitives:
        profile = entry.get("speed_profile") or {}
        if not isinstance(profile, dict):
            continue
        for label, count in profile.items():
            totals[label] = totals.get(label, 0) + int(count)
    return [
        {"bucket": label, "moves": totals[label]}
        for label, _, _ in SPEED_BUCKETS
        if totals.get(label)
    ]


def _time_pressure(primitives: List[Dict[str, object]]) -> List[Dict[str, object]]:
    totals: Dict[str, Dict[str, int]] = {}
    for entry in primitives:
        pressure = entry.get("clock_pressure") or {}
        if not isinstance(pressure, dict):
            continue
        for label, counts in pressure.items():
            bucket = totals.setdefault(label, {"moves": 0, "blunders": 0})
            bucket["moves"] += int(counts.get("moves", 0))
            bucket["blunders"] += int(counts.get("blunders", 0))
    ordered: List[Dict[str, object]] = []
    for label, _, _ in CLOCK_BUCKETS:
        counts = totals.get(label)
        if not counts or not counts["moves"]:
            continue
        ordered.append(
            {
                "bucket": label,
                "moves": counts["moves"],
                "blunders": counts["blunders"],
                "rate": round(counts["blunders"] / counts["moves"], 2),
            }
        )
    return ordered


def _color_evidence(primitives: List[Dict[str, object]]) -> Optional[str]:
    scores: Dict[str, List[float]] = {"white": [], "black": []}
    for entry in primitives:
        color = entry.get("player_color")
        score = entry.get("player_score")
        if color in scores and score is not None:
            scores[color].append(float(score))
    if not scores["white"] or not scores["black"]:
        return None
    if len(scores["white"]) + len(scores["black"]) < 3:
        return None
    white_rate = _mean(scores["white"]) or 0.0
    black_rate = _mean(scores["black"]) or 0.0
    gap = white_rate - black_rate
    if abs(gap) < 0.25:
        return None
    stronger, weaker = ("White", "Black") if gap > 0 else ("Black", "White")
    return (
        f"You score noticeably better with {stronger} than with {weaker} "
        "in this sample."
    )


def _headline(
    player_type: str,
    dimensions: Dict[str, Optional[Dict[str, object]]],
) -> str:
    short = PLAYER_TYPE_SHORT.get(player_type, "Player")
    scored = [
        (key, int(dimension["score"]))
        for key, dimension in dimensions.items()
        if dimension is not None
    ]
    if not scored:
        return f"{short} — too little data for a mental-game read yet."
    strongest = max(scored, key=lambda item: item[1])
    weakest = min(scored, key=lambda item: item[1])
    if weakest[1] >= STRONG_SCORE:
        return (
            f"{short} profile — no glaring mental leaks in this sample; "
            f"{DIMENSION_LABELS[strongest[0]].lower()} leads."
        )
    return (
        f"{short} profile — {DIMENSION_LABELS[weakest[0]].lower()} is the gap; "
        f"{DIMENSION_LABELS[strongest[0]].lower()} is your edge."
    )


def _leaks(
    dimensions: Dict[str, Optional[Dict[str, object]]],
) -> List[Dict[str, object]]:
    ranked = sorted(
        (
            (key, dimension)
            for key, dimension in dimensions.items()
            if dimension is not None and int(dimension["score"]) < STRONG_SCORE
        ),
        key=lambda item: int(item[1]["score"]),
    )
    leaks: List[Dict[str, object]] = []
    for key, dimension in ranked[:MAX_LEAKS]:
        score = int(dimension["score"])
        leaks.append(
            {
                "key": key,
                "label": dimension["label"],
                "score": score,
                "tag": dimension["tag"],
                "severity": "high" if score < DEVELOP_SCORE else "medium",
                "evidence": dimension["evidence"],
                "fix": FIX_PROTOCOLS[key],
            }
        )
    return leaks


def _capitalization(games: List[Dict[str, object]]) -> int:
    total = 0
    for game in games:
        for moment in game.get("strength_moments") or []:
            if isinstance(moment, dict) and moment.get("capitalizes"):
                total += 1
    return total


def build_batch_profile(games: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    """Aggregate per-game primitives into a psychology profile for the report."""
    if len(games) < MIN_GAMES_FOR_PROFILE:
        return None

    primitives = [
        (game.get("psychology") or {}) for game in games if isinstance(game, dict)
    ]
    accuracies = [
        float(entry["overall_accuracy"])
        for entry in primitives
        if entry.get("overall_accuracy") is not None
    ]
    if not accuracies:
        return None

    ordered = _ordered(games)

    dimensions: Dict[str, Optional[Dict[str, object]]] = {
        "consistency": _consistency_dimension(accuracies),
        "time_management": _time_management_dimension(primitives, len(games)),
        "composure": _composure_dimension(primitives, accuracies),
        "tilt": _tilt_dimension(ordered),
        "conversion": _conversion_dimension(primitives),
        "fighting_spirit": _fighting_spirit_dimension(primitives),
    }

    consistency_score = (
        float(dimensions["consistency"]["score"])
        if dimensions["consistency"]
        else 50.0
    )
    player_type = _player_type(games, primitives, accuracies, consistency_score)

    type_evidence = [str(item) for item in player_type.pop("type_evidence", [])]
    evidence = list(type_evidence)
    for key in DIMENSION_ORDER:
        dimension = dimensions.get(key)
        if dimension:
            evidence.append(str(dimension["evidence"]))
    capitalization = _capitalization(games)
    if capitalization:
        evidence.append(
            f"You punished an opponent error with the strongest reply "
            f"{capitalization} time(s)."
        )
    color_note = _color_evidence(primitives)
    if color_note:
        evidence.append(color_note)

    leaks = _leaks(dimensions)
    headline = _headline(str(player_type["player_type"]), dimensions)

    caveats: List[str] = []
    if dimensions["time_management"] is None:
        caveats.append(
            "Clock data was not available for these games, so time management "
            "could not be assessed."
        )
    if len(games) <= MIN_GAMES_FOR_PROFILE:
        caveats.append(
            "With only a few games these are early signals, not settled habits."
        )
    caveats.append("This is a pattern read from this sample, not a fixed profile.")

    return {
        "sample_size": len(games),
        "headline": headline,
        "player_type": player_type["player_type"],
        "player_type_label": player_type["player_type_label"],
        "player_type_confidence": player_type["player_type_confidence"],
        "type_scores": player_type["type_scores"],
        "dimension_order": list(DIMENSION_ORDER),
        "dimensions": dimensions,
        "leaks": leaks,
        "form": _form(ordered),
        "time_pressure": _time_pressure(primitives),
        "speed_profile": _speed_totals(primitives),
        "type_evidence": type_evidence,
        "evidence": evidence,
        "caveats": caveats,
    }


def build_prompt_payload(profile: Dict[str, object]) -> Dict[str, object]:
    """Trim the profile for the LLM: metrics and evidence, no raw internals."""
    dimensions: Dict[str, object] = {}
    raw_dimensions = profile.get("dimensions")
    if isinstance(raw_dimensions, dict):
        for key, dimension in raw_dimensions.items():
            if isinstance(dimension, dict):
                dimensions[key] = {
                    "label": dimension.get("label"),
                    "score": dimension.get("score"),
                    "tag": dimension.get("tag"),
                    "evidence": dimension.get("evidence"),
                }
    leaks: List[Dict[str, object]] = []
    raw_leaks = profile.get("leaks")
    if isinstance(raw_leaks, list):
        for leak in raw_leaks:
            if isinstance(leak, dict):
                leaks.append(
                    {
                        "label": leak.get("label"),
                        "severity": leak.get("severity"),
                        "evidence": leak.get("evidence"),
                        "fix": leak.get("fix"),
                    }
                )
    return {
        "sample_size": profile.get("sample_size"),
        "headline": profile.get("headline"),
        "player_type": profile.get("player_type"),
        "player_type_label": profile.get("player_type_label"),
        "player_type_confidence": profile.get("player_type_confidence"),
        "dimensions": dimensions,
        "leaks": leaks,
        "evidence": profile.get("evidence"),
        "caveats": profile.get("caveats"),
    }
