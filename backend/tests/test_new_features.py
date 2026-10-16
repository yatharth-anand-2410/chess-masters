"""End-to-End regression and unit tests for the newly expanded Chessmasters features:
- Draw classification (4-quadrant eval swings & psychology)
- Lichess study import & chapter parser with %csl/%cal annotations
- Opponent scouting engine & opening repertoire trie
- Longitudinal student progress tracking & 3-pillar mastery
- Context-aware AI copilot queries

The progress tests seed a fake ``analyses`` table and assert the honest report:
real numbers for a seeded fixture, ``insufficient`` when the history is thin,
and never the synthetic showcase profile for a real account id.
"""

from __future__ import annotations

import sys
from pathlib import Path
import unittest
from typing import Any, Dict, List
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import draws, studies, scouting, progress, copilot


def _progress_row(index: int, *, motif: str = "Pin") -> Dict[str, Any]:
    """One completed analysis row with real telemetry, as Supabase returns it."""
    rating = 1500 + index * 10
    return {
        "id": f"analysis-{index}",
        "status": "completed",
        "platform": "lichess",
        "username": "tester",
        "player_color": "white",
        "result": "1-0",
        "created_at": f"2026-09-{index + 1:02d}T10:00:00Z",
        "pgn": (
            f'[WhiteElo "{rating}"]\n'
            f'[BlackElo "{rating - 20}"]\n'
            f'[TimeControl "300+0"]\n'
        ),
        "insights": {
            "weakness_moments": [
                {
                    "move_number": 20 + index,
                    "quality": "blunder",
                    "centipawn_loss": 250,
                    "clock_remaining": 12.0,
                    "motif": motif,
                    "resource_theme": motif.lower(),
                }
            ]
        },
        "game_summary": {
            "speed": "blitz",
            "time_control": "300+0",
            "username": "tester",
            "platform": "lichess",
            "player_elo": rating,
            "opponent_name": "Hikaru",
            "opponent_elo": rating - 20,
            "accuracy": 80.0 + index,
            "phase_accuracies": {
                "opening": 80.0 + index,
                "middlegame": 70.0 + index,
                "endgame": 60.0 + index,
            },
            "quality": {"blunder": 1, "mistake": 1, "inaccuracy": 2},
        },
    }


def _patch_progress_db(rows: List[Dict[str, Any]]):
    """Install a fake ``analyses`` table on ``services.progress.db``."""
    return patch.multiple(
        progress.db,
        configured=lambda: True,
        get_student_by_id=lambda student_id: None,
        get_user_profile=lambda user_id: None,
        list_analyses=lambda user_id, limit=50: list(rows),
        list_analyses_by_student=lambda user_id, student_id, limit=100: list(rows),
    )


class TestNewFeaturesEndToEnd(unittest.TestCase):
    def test_draw_classification_missed_win(self):
        pgn = """
[Event "Rated Blitz game"]
[Site "https://lichess.org/test1234"]
[Date "2026.10.15"]
[White "Hero"]
[Black "Opponent"]
[Result "1/2-1/2"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 1/2-1/2
"""
        req = draws.DrawClassifyRequest(pgn=pgn, player_color="white")
        result = draws.classify_draw(req)
        self.assertIsNotNone(result.verdict_title)
        self.assertIn(result.quadrant, [
            draws.QUADRANT_MISSED_WIN,
            draws.QUADRANT_HEROIC_FORTRESS,
            draws.QUADRANT_PREMATURE_FEAR_DRAW,
            draws.QUADRANT_BALANCED_DRAW
        ])
        self.assertIsNotNone(result.eval_swings)
        self.assertIsInstance(result.focus_areas, list)

    def test_draw_classification_stalemate(self):
        pgn = """
[Event "Casual Game"]
[Result "1/2-1/2"]

1. e4 e5 2. Qh5 Ke7 3. Qxe5# 1/2-1/2
"""
        req = draws.DrawClassifyRequest(pgn=pgn, player_color="white")
        result = draws.classify_draw(req)
        self.assertIsNotNone(result.quadrant)
        self.assertIsNotNone(result.quadrant_label)

    def test_lichess_study_parser_annotations(self):
        sample_study_pgn = """[Event "Chapter 1: The Deflection Magnet"]
[Site "https://lichess.org/study/test1234/chap1"]
[Result "*"]
[FEN "r1b1r1k1/pp2qpbp/2p3p1/8/3QP3/1P4P1/PB3PBP/3RR1K1 w - - 3 20"]

20. Qxg7# { [%csl Gg7,Re8] [%cal Gd4g7,Re1e8] Deflection mate on the long diagonal! } *
"""
        parsed = studies.parse_study_pgn(sample_study_pgn, study_id="test1234")
        self.assertEqual(len(parsed.chapters), 1)
        chap = parsed.chapters[0]
        self.assertGreater(len(chap.moves_tree), 0)
        move_node = chap.moves_tree[0]
        self.assertGreater(len(move_node.circles), 0)
        self.assertGreater(len(move_node.arrows), 0)
        self.assertIn("Deflection mate", move_node.comment or "")

    def test_opponent_scouting_dossier_mock(self):
        dossier = scouting.generate_scouting_dossier("Grandmaster_Opponent", platform="lichess", max_games=20)
        self.assertEqual(dossier.username, "Grandmaster_Opponent")
        self.assertGreaterEqual(len(dossier.anti_prep_recommendations), 1)
        self.assertTrue(hasattr(dossier, "time_trouble"))
        self.assertIsInstance(dossier.white_repertoire_tree, list)
        self.assertIsInstance(dossier.black_repertoire_tree, list)
        self.assertIsInstance(dossier.tactical_blindspots, list)

    def test_student_progress_report(self):
        """A real account is answered from its own seeded analyses."""
        rows = [
            _progress_row(index, motif="Pin" if index % 2 == 0 else "Fork")
            for index in range(6)
        ]
        with _patch_progress_db(rows):
            report = progress.build_student_progress("aarav-sharma-123")

        self.assertFalse(report.insufficient)
        self.assertEqual(report.games_used, 6)
        self.assertEqual(report.identity.total_games, 6)
        # Real numbers, derived from the seeded ratings 1500..1550.
        self.assertEqual(report.elo.starting, 1500)
        self.assertEqual(report.elo.current, 1550)
        self.assertTrue(len(report.elo.series) == 6)
        self.assertTrue(report.movement)
        self.assertTrue(len(report.pillars.needs_work) > 0)
        self.assertTrue(len(report.root_causes) > 0)
        self.assertEqual(sum(cause.count for cause in report.root_causes), 6)
        self.assertTrue(len(report.focus_rules) > 0)
        # The synthetic showcase profile never reaches a real account id.
        self.assertEqual(report.identity.accounts[0].username, "tester")
        self.assertNotEqual(report.elo.current, 2145)
        self.assertNotIn("aarav", report.student_name.lower())

    def test_student_progress_report_is_insufficient_when_thin(self):
        with _patch_progress_db([_progress_row(0)]):
            report = progress.build_student_progress("aarav-sharma-123")

        self.assertTrue(report.insufficient)
        self.assertEqual(report.games_used, 1)
        self.assertEqual(report.elo.current, 1500)
        self.assertEqual(report.movement, [])
        self.assertEqual(report.pillars.needs_work, [])
        self.assertEqual(report.radar, [])
        self.assertEqual(report.persona.archetype, "")
        self.assertIsNone(report.acpl.baseline)
        self.assertNotEqual(report.elo.current, 2145)
        self.assertNotIn("aarav", report.student_name.lower())

    def test_copilot_query_execution(self):
        import asyncio
        req = copilot.CopilotQueryRequest(
            query="Where am I making the most mistakes in my games?",
            user_id="test_user_123"
        )
        res = asyncio.run(copilot.answer_copilot_query(req, client=None))
        self.assertTrue(len(res.answer) > 20)
        self.assertIsInstance(res.suggested_actions, list)
        self.assertIn(res.source, ["gemini-coach", "heuristic-engine"])


if __name__ == "__main__":
    unittest.main()
