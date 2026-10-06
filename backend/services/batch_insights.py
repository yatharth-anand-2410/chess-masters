"""Aggregate per-game engine insights into one multi-game coaching payload.

Each entry passed to :func:`build_batch_insights` looks like::

    {
        "analysis_id": "...",
        "label": "Game 1",
        "game_id": "...",
        "game_url": "...",
        "platform": "lichess",
        "engine_data": {...},   # output of recommendations.build_insights
    }

The returned payload is both stored for the UI and (trimmed) for the LLM.
"""

from __future__ import annotations

from typing import Dict, List

from services import psychology

MAX_BATCH_WEAKNESS_MOMENTS = 6
MAX_BATCH_STRENGTH_MOMENTS = 4
MAX_BATCH_RESOURCES = 6
MAX_RECURRING_THEMES = 5

PHASES = ("opening", "middlegame", "endgame")


def _tag_moments(
    moments: object,
    label: str,
    analysis_id: object,
) -> List[Dict[str, object]]:
    if not isinstance(moments, list):
        return []
    tagged: List[Dict[str, object]] = []
    for moment in moments:
        if not isinstance(moment, dict):
            continue
        tagged.append({**moment, "game_label": label, "analysis_id": analysis_id})
    return tagged


def _game_summary(index: int, entry: Dict[str, object]) -> Dict[str, object]:
    engine_data = entry.get("engine_data") or {}
    if not isinstance(engine_data, dict):
        engine_data = {}
    label = str(entry.get("label") or f"Game {index}")
    analysis_id = entry.get("analysis_id")
    statistics = engine_data.get("statistics") or {}
    if not isinstance(statistics, dict):
        statistics = {}
    return {
        "label": label,
        "analysis_id": analysis_id,
        "game_id": entry.get("game_id"),
        "game_url": entry.get("game_url"),
        "platform": entry.get("platform"),
        "opening_name": engine_data.get("opening_name"),
        "eco": engine_data.get("eco"),
        "result": engine_data.get("result"),
        "player_color": engine_data.get("player_color"),
        "overall_accuracy": engine_data.get("overall_accuracy"),
        "phase_accuracies": engine_data.get("phase_accuracies") or {},
        "statistics": {
            "blunder": int(statistics.get("blunder", 0) or 0),
            "mistake": int(statistics.get("mistake", 0) or 0),
            "inaccuracy": int(statistics.get("inaccuracy", 0) or 0),
        },
        "strength_moments": _tag_moments(
            engine_data.get("strength_moments"), label, analysis_id
        ),
        "weakness_moments": _tag_moments(
            engine_data.get("weakness_moments"), label, analysis_id
        ),
        "resources": engine_data.get("resources") or [],
        "psychology": engine_data.get("psychology"),
    }


def build_batch_insights(games: List[Dict[str, object]]) -> Dict[str, object]:
    """Merge per-game engine data into a batch payload for UI + prompting."""
    summaries: List[Dict[str, object]] = []
    weakness_moments: List[Dict[str, object]] = []
    strength_moments: List[Dict[str, object]] = []
    resource_map: Dict[str, Dict[str, object]] = {}
    totals = {"blunder": 0, "mistake": 0, "inaccuracy": 0}
    phase_values: Dict[str, List[float]] = {phase: [] for phase in PHASES}
    theme_counts: Dict[str, Dict[str, object]] = {}

    for index, entry in enumerate(games, start=1):
        summary = _game_summary(index, entry)
        summaries.append(summary)

        statistics = summary["statistics"]
        if isinstance(statistics, dict):
            for key in totals:
                totals[key] += int(statistics.get(key, 0) or 0)

        accuracies = summary["phase_accuracies"]
        if isinstance(accuracies, dict):
            for phase in PHASES:
                value = accuracies.get(phase)
                if isinstance(value, (int, float)):
                    phase_values[phase].append(float(value))

        game_weakness = summary["weakness_moments"]
        game_strength = summary["strength_moments"]
        if isinstance(game_weakness, list):
            weakness_moments.extend(game_weakness)
        if isinstance(game_strength, list):
            strength_moments.extend(game_strength)

        resources = summary["resources"]
        if isinstance(resources, list):
            for resource in resources:
                if not isinstance(resource, dict):
                    continue
                url = resource.get("url")
                if url and url not in resource_map:
                    resource_map[url] = {
                        **resource,
                        "game_label": summary["label"],
                        "analysis_id": summary["analysis_id"],
                    }

        if isinstance(game_weakness, list):
            for moment in game_weakness:
                if not isinstance(moment, dict):
                    continue
                theme = str(
                    moment.get("motif")
                    or moment.get("resource_theme")
                    or "blunder"
                )
                bucket = theme_counts.setdefault(
                    theme, {"theme": theme, "count": 0, "games": []}
                )
                bucket["count"] = int(bucket["count"]) + 1
                game_labels = bucket["games"]
                if isinstance(game_labels, list) and summary["label"] not in game_labels:
                    game_labels.append(summary["label"])

    weakness_moments.sort(
        key=lambda moment: int(moment.get("centipawn_loss") or 0), reverse=True
    )
    recurring = sorted(
        theme_counts.values(), key=lambda item: int(item["count"]), reverse=True
    )[:MAX_RECURRING_THEMES]

    phase_accuracies: Dict[str, object] = {}
    for phase in PHASES:
        values = phase_values[phase]
        phase_accuracies[phase] = (
            round(sum(values) / len(values), 1) if values else None
        )

    payload: Dict[str, object] = {
        "game_count": len(summaries),
        "games": summaries,
        "totals": totals,
        "phase_accuracies": phase_accuracies,
        "recurring_themes": recurring,
        "strength_moments": strength_moments[:MAX_BATCH_STRENGTH_MOMENTS],
        "weakness_moments": weakness_moments[:MAX_BATCH_WEAKNESS_MOMENTS],
        "resources": list(resource_map.values())[:MAX_BATCH_RESOURCES],
    }
    profile = psychology.build_batch_profile(summaries)
    if profile is not None:
        payload["psychology"] = profile
    return payload


def _trim_moment(moment: Dict[str, object]) -> Dict[str, object]:
    trimmed: Dict[str, object] = {
        "move_number": moment.get("move_number"),
        "san": moment.get("san"),
        "phase": moment.get("phase"),
        "quality": moment.get("quality"),
        "centipawn_loss": moment.get("centipawn_loss"),
    }
    motif = moment.get("motif")
    if motif:
        trimmed["motif"] = motif
    details = moment.get("motif_details")
    if details:
        trimmed["motif_details"] = details
    blindspot = moment.get("blindspot")
    if isinstance(blindspot, dict) and blindspot.get("explanation"):
        trimmed["blindspot"] = blindspot.get("explanation")
    best_move = moment.get("best_move_san")
    if best_move:
        trimmed["best_move_san"] = best_move
    note = moment.get("note")
    if note:
        trimmed["note"] = note
    better_idea = moment.get("better_move_idea")
    if better_idea:
        trimmed["better_move_idea"] = better_idea
    return trimmed


def build_prompt_payload(insights: Dict[str, object]) -> Dict[str, object]:
    """Trim the batch payload so the LLM gets signal without raw FEN dumps."""
    games_payload: List[Dict[str, object]] = []
    games = insights.get("games")
    if isinstance(games, list):
        for game in games:
            if not isinstance(game, dict):
                continue
            weak = game.get("weakness_moments")
            strong = game.get("strength_moments")
            games_payload.append(
                {
                    "label": game.get("label"),
                    "player_color": game.get("player_color"),
                    "result": game.get("result"),
                    "opening_name": game.get("opening_name"),
                    "phase_accuracies": game.get("phase_accuracies"),
                    "statistics": game.get("statistics"),
                    "key_moments": [
                        _trim_moment(moment)
                        for moment in (weak if isinstance(weak, list) else [])[:4]
                        if isinstance(moment, dict)
                    ],
                    "strengths": [
                        _trim_moment(moment)
                        for moment in (strong if isinstance(strong, list) else [])[:2]
                        if isinstance(moment, dict)
                    ],
                }
            )
    payload: Dict[str, object] = {
        "game_count": insights.get("game_count"),
        "totals": insights.get("totals"),
        "average_phase_accuracies": insights.get("phase_accuracies"),
        "recurring_themes": insights.get("recurring_themes"),
        "games": games_payload,
    }
    profile = insights.get("psychology")
    if isinstance(profile, dict):
        payload["psychology"] = psychology.build_prompt_payload(profile)
    return payload
