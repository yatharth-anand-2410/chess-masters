"""Unit tests for newly implemented chess analyzer backend services and endpoints:
1. services.draws (4-quadrant draw classification & eval swing analysis)
2. services.studies (Lichess study fetcher & chapter parser)
3. services.scouting (Opponent scouting dossier, opening trie, time trouble <30s)
4. services.progress (Longitudinal student progress & 3-pillar mastery)
5. services.copilot (Context-aware AI coach copilot)
6. Registered FastAPI endpoints in main.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from main import app
from services import copilot, draws, progress, scouting, studies

client = TestClient(app)


# ---------------------------------------------------------------------------
# 1. Draws Classification Tests
# ---------------------------------------------------------------------------


def test_draw_missed_win_quadrant():
    # Player reaches +3.5 peak eval and collapses to draw
    eval_curve = [0.0, 0.4, 1.2, 2.5, 3.8, 3.5, 2.1, 0.5, 0.0]
    res = draws.classify_draw(
        draws.DrawClassifyRequest(
            eval_curve_pawns=eval_curve,
            player_color="white",
            result="1/2-1/2",
        )
    )
    assert res.quadrant == draws.QUADRANT_MISSED_WIN
    assert res.choke_detected is True
    assert res.eval_swings.peak_eval_player == 3.8
    assert len(res.focus_areas) > 0


def test_draw_heroic_fortress_quadrant():
    # Player is down -3.2 pawns, but recovers and holds draw
    eval_curve = [0.0, -0.8, -1.8, -3.2, -3.0, -2.1, -1.1, -0.2, 0.0]
    res = draws.classify_draw(
        draws.DrawClassifyRequest(
            eval_curve_pawns=eval_curve,
            player_color="white",
            result="1/2-1/2",
        )
    )
    assert res.quadrant == draws.QUADRANT_HEROIC_FORTRESS
    assert res.fortress_detected is True
    assert res.eval_swings.peak_eval_opponent == 3.2


def test_draw_premature_fear_quadrant():
    # Short game (18 moves) within equal corridor [-0.5, +0.6]
    eval_curve = [0.0, 0.2, 0.1, 0.3, 0.4, 0.2, 0.5, 0.4, 0.3]
    res = draws.classify_draw(
        draws.DrawClassifyRequest(
            eval_curve_pawns=eval_curve,
            player_color="white",
            result="1/2-1/2",
        )
    )
    assert res.quadrant == draws.QUADRANT_PREMATURE_FEAR_DRAW
    assert res.choke_detected is False
    assert res.fortress_detected is False


def test_draw_balanced_fight_quadrant():
    # Long game (36+ moves) staying balanced throughout
    eval_curve = [0.0, 0.2, 0.4, 0.1, -0.3, 0.2, 0.5, 0.1, 0.0] * 8
    res = draws.classify_draw(
        draws.DrawClassifyRequest(
            eval_curve_pawns=eval_curve,
            player_color="white",
            result="1/2-1/2",
        )
    )
    assert res.quadrant == draws.QUADRANT_BALANCED_DRAW
    assert res.confidence >= 0.8


def test_draw_eval_swings_and_turning_points():
    evals = [0.0, 0.2, 2.5, 0.1, -1.8, 0.0]
    swings = draws.analyze_eval_swings(evals, player_color="white")
    assert swings.peak_eval_player == 2.5
    assert swings.peak_eval_opponent == 1.8
    assert swings.lead_changes >= 1
    assert len(swings.turning_points) >= 2


def test_draw_classify_endpoint():
    response = client.post(
        "/api/draws/classify",
        json={
            "eval_curve_pawns": [0.0, 0.5, 2.6, 0.1, 0.0],
            "player_color": "white",
            "result": "1/2-1/2",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["quadrant"] == "MISSED_WIN"
    assert "eval_swings" in data
    assert "focus_areas" in data


# ---------------------------------------------------------------------------
# 2. Studies Tests
# ---------------------------------------------------------------------------


def test_extract_study_id():
    assert studies.extract_study_id("https://lichess.org/study/aBcDeFgH") == "aBcDeFgH"
    assert studies.extract_study_id("https://lichess.org/study/aBcDeFgH/chAp1234") == "aBcDeFgH"
    assert studies.extract_study_id("aBcDeFgH") == "aBcDeFgH"


def test_parse_visual_annotations():
    raw_comment = "Notice the key square [%csl Gc4,Re5] and the attack [%cal Gc1g5,Re1e8] [%eval +1.4]"
    clean, circles, arrows, eval_val = studies.parse_visual_annotations(raw_comment)
    assert clean == "Notice the key square and the attack"
    assert len(circles) == 2
    assert circles[0].color == "green" and circles[0].square == "c4"
    assert circles[1].color == "red" and circles[1].square == "e5"
    assert len(arrows) == 2
    assert arrows[0].from_square == "c1" and arrows[0].to_square == "g5"
    assert eval_val == "+1.4"


def test_parse_study_pgn():
    sample_study_pgn = """[Event "Chapter 1: The Pin Attack"]
[Site "https://lichess.org/study/test1234/chap1"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[Orientation "white"]

1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) 2... Nc6 {Key outpost [%csl Gd5] [%cal Gf3d5]} 3. Bb5 *

[Event "Chapter 2: Endgame Conversion"]
[Site "https://lichess.org/study/test1234/chap2"]
[Orientation "black"]

1. d4 d5 *
"""
    parsed = studies.parse_study_pgn(sample_study_pgn, "test1234")
    assert parsed.study_id == "test1234"
    assert parsed.chapter_count == 2
    assert parsed.chapters[0].title == "Chapter 1: The Pin Attack"
    assert parsed.chapters[0].orientation == "white"
    assert parsed.chapters[1].orientation == "black"
    assert parsed.total_annotations >= 1


def test_studies_import_endpoint_not_found():
    # Expect 404 or 502 for nonexistent study
    with patch("services.studies.fetch_lichess_study_pgn", side_effect=studies.StudyNotFoundError("Study not found")):
        response = client.get("/api/studies/import/invalid88")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 3. Scouting Dossier Tests
# ---------------------------------------------------------------------------


def test_scouting_dossier_synthetic_and_structure():
    dossier = scouting.generate_scouting_dossier("HikaruTest", platform="lichess", max_games=20)
    assert dossier.username == "HikaruTest"
    assert len(dossier.white_repertoire_tree) > 0
    assert len(dossier.black_repertoire_tree) > 0
    assert "opening" in dossier.phase_blunders
    assert "middlegame" in dossier.phase_blunders
    assert "endgame" in dossier.phase_blunders
    assert dossier.time_trouble.moves_under_30s >= 0
    assert len(dossier.tactical_blindspots) > 0
    assert len(dossier.anti_prep_recommendations) > 0


def test_scout_endpoint():
    response = client.get("/api/scout/Hikaru?max_games=10")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "Hikaru"
    assert "white_repertoire_tree" in data
    assert "time_trouble" in data
    assert "vulnerability_multiplier" in data["time_trouble"]


# ---------------------------------------------------------------------------
# 4. Student Progress & 3-Pillar Tests
# ---------------------------------------------------------------------------


def test_student_progress_report():
    report = progress.build_student_progress("student_uuid_12345")
    assert report.student_id == "student_uuid_12345"
    assert report.elo_trajectory.current_rating > 1000
    assert len(report.elo_trajectory.series) > 0
    assert len(report.acpl_drift.chunk_series) > 0
    assert report.phase_accuracy.opening_current > 0
    # Verify 3 Pillars
    assert len(report.three_pillar_mastery.what_has_improved) > 0
    assert len(report.three_pillar_mastery.what_is_improving) > 0
    assert len(report.three_pillar_mastery.what_needs_work) > 0
    # Verify persona profile
    assert report.persona_profile.archetype is not None
    assert len(report.persona_profile.radar_metrics) == 6
    assert len(report.actionable_focus_rules) >= 3


def test_student_progress_endpoint():
    response = client.get("/api/student/student_uuid_12345/progress")
    assert response.status_code == 200
    data = response.json()
    assert data["student_id"] == "student_uuid_12345"
    assert "three_pillar_mastery" in data
    assert "what_has_improved" in data["three_pillar_mastery"]
    assert "persona_profile" in data


# ---------------------------------------------------------------------------
# 5. AI Coach Copilot Tests
# ---------------------------------------------------------------------------


def test_copilot_heuristic_fallback():
    req = copilot.CopilotQueryRequest(
        query="How do I avoid blundering under 30 seconds in Blitz?",
        player_color="white",
        student_id="student_123",
    )
    import asyncio
    res = asyncio.run(copilot.answer_copilot_query(req, client=None))
    assert res.source == "heuristic-engine"
    assert "30 seconds" in res.answer or "clock" in res.answer.lower()
    assert len(res.suggested_actions) > 0
    assert len(res.anchored_facts) > 0


def test_copilot_fen_tactics_detection():
    # Position with White Queen pinning Black knight to King
    fen_pin = "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4"
    req = copilot.CopilotQueryRequest(
        query="What tactical threats should I be alert to in this position?",
        fen=fen_pin,
        player_color="white",
    )
    import asyncio
    res = asyncio.run(copilot.answer_copilot_query(req, client=None))
    assert res.source == "heuristic-engine"
    assert len(res.motifs_detected) >= 1
    assert "pin" in res.motifs_detected


def test_copilot_endpoint():
    response = client.post(
        "/api/copilot/query",
        json={
            "query": "What is my primary weakness when converting winning positions?",
            "student_id": "test_student",
            "player_color": "white",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "answer" in data
    assert "suggested_actions" in data
    assert data["source"] in ("heuristic-engine", "gemini-coach")


# ---------------------------------------------------------------------------
# Test Runner
# ---------------------------------------------------------------------------


def main() -> None:
    tests = [
        name
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    failures = 0
    for name in tests:
        try:
            globals()[name]()
            print(f"PASS {name}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    if failures:
        print(f"\n{failures}/{len(tests)} tests failed")
        sys.exit(1)
    print(f"\nAll {len(tests)} tests passed")


if __name__ == "__main__":
    main()
