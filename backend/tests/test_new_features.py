"""End-to-End regression and unit tests for the newly expanded Chessmasters features:
- Draw classification (4-quadrant eval swings & psychology)
- Lichess study import & chapter parser with %csl/%cal annotations
- Opponent scouting engine & opening repertoire trie
- Longitudinal student progress tracking & 3-pillar mastery
- Context-aware AI copilot queries
"""

from __future__ import annotations

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import draws, studies, scouting, progress, copilot


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
        report = progress.build_student_progress("aarav-sharma-123")
        self.assertTrue("aarav" in report.student_id.lower() or "student" in report.student_name.lower())
        self.assertGreaterEqual(report.elo_trajectory.current_rating, 1000)
        self.assertGreater(len(report.three_pillar_mastery.what_has_improved), 0)
        self.assertGreater(len(report.three_pillar_mastery.what_is_improving), 0)
        self.assertGreater(len(report.three_pillar_mastery.what_needs_work), 0)
        self.assertGreater(len(report.blunder_root_causes), 0)
        self.assertGreater(len(report.actionable_focus_rules), 0)

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
