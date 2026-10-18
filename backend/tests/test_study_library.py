"""Offline tests for the coach's study library.

Run from the backend directory::

    python -m pytest tests/test_study_library.py -q

Everything runs without a network and without Supabase: the Lichess index, the
study export and the analysis rows are all stubbed, and the curation overlay is
a temporary file. Two behaviours matter most here and are asserted directly:

* an anonymous caller sees nothing — no title, no id, no count;
* a free account can open only the studies its tier unlocks, and the content
  endpoint refuses the rest with a 402 upgrade hint rather than an empty page.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_module  # noqa: E402
from main import app, get_current_user, get_optional_user  # noqa: E402
from services import db, library, studies  # noqa: E402

client = TestClient(app)

STUDY_PGN = """[Event "spoil pawn structure : provocation 1"]
[Site "Lichess"]
[Variant "Standard"]
[StudyName "Weak Squares 2"]
[ChapterName "spoil pawn structure : provocation 1"]
[ChapterURL "https://lichess.org/study/tmpWkSq1/HS6vRV0B"]
[Annotator "https://lichess.org/@/MentalCarlsen"]
[FEN "r2r2k1/1ppqbppp/1nn5/1N2p3/6b1/P3PNP1/2QP1PBP/1RB2RK1 b - - 0 1"]
[SetUp "1"]

{ "Provocation" is just a fancy word for teasing! The pawn steps forward and
creates a permanent hole. }
*

[Event "double pins"]
[ChapterName "double pins"]
[ChapterURL "https://lichess.org/study/tmpWkSq1/dPToql1N"]
[Annotator "https://lichess.org/@/MentalCarlsen"]
[FEN "1q5k/6pp/b7/5PQ1/5N2/8/8/6K1 w - - 0 1"]
[SetUp "1"]

1. Qg6 hxg6 2. Nxg6# { A double pin finishes it. [%csl Gh7][%cal Gf5g6] } 1-0
"""

INDEX_ROWS = [
    {"id": "tmpPin01", "name": "Advanced Pins", "created_at": 1, "updated_at": 500},
    {"id": "tmpFrk01", "name": "FORK", "created_at": 1, "updated_at": 400},
    {"id": "tmpWkSq1", "name": "Weak Squares 2", "created_at": 1, "updated_at": 300},
    {"id": "tmpHide1", "name": "Alex Game", "created_at": 1, "updated_at": 200},
    {"id": "tmpNew01", "name": "Brand New Study", "created_at": 1, "updated_at": 100},
]

OVERLAY = {
    "owner": "TestCoach",
    "groups": {
        "weakSquares": {
            "label": "Weak Squares",
            "description": "Holes and outposts.",
        }
    },
    "studies": [
        {"id": "tmpPin01", "title": "Advanced Pins", "group": "pin", "order": 0},
        {"id": "tmpFrk01", "title": "FORK", "group": "fork", "order": 1},
        {"id": "tmpWkSq1", "title": "Weak Squares 2", "group": "weakSquares", "order": 2},
        {"id": "tmpHide1", "title": "Alex Game", "hidden": True},
        {"id": "tmpGone1", "title": "Deleted Study", "group": "fork", "order": 3},
    ],
}


@pytest.fixture(autouse=True)
def offline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """A temporary overlay, a stubbed Lichess and no Supabase.

    The stub sits at the HTTP layer so the real index parser and the real
    cache run in every endpoint test.
    """
    overlay = tmp_path / "study_library.json"
    overlay.write_text(json.dumps(OVERLAY), encoding="utf-8")
    monkeypatch.setattr(library, "_OVERLAY_PATH", str(overlay))
    monkeypatch.setattr(studies, "lichess_configured", lambda: True)

    def fake_get(url, params=None, headers=None, timeout=None, allow_redirects=True):
        if "/api/study/by/" in url:
            body = "\n".join(
                json.dumps(
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "createdAt": row["created_at"],
                        "updatedAt": row["updated_at"],
                    }
                )
                for row in INDEX_ROWS
            )
            return _pgn_response(body)
        return _pgn_response(STUDY_PGN)

    monkeypatch.setattr(studies.http, "get", fake_get)
    monkeypatch.setattr(db, "configured", lambda: False)
    library.clear_caches()
    studies.clear_caches()
    yield
    library.clear_caches()
    studies.clear_caches()
    app.dependency_overrides.clear()


@pytest.fixture
def as_user():
    def _install(user_id: str = "user-1"):
        identity = {"id": user_id, "email": None, "user_metadata": None}
        app.dependency_overrides[get_current_user] = lambda: identity
        app.dependency_overrides[get_optional_user] = lambda: identity

    return _install


@pytest.fixture
def tier(monkeypatch: pytest.MonkeyPatch):
    def _install(plan_tier: str = "free"):
        usage = {
            "plan": "free" if plan_tier == "free" else "paid",
            "plan_tier": plan_tier,
            "analyses_used": 0,
            "free_analysis_limit": 5,
            "paid_analysis_limit": 100,
            "subscription_status": "inactive",
            "current_period_end": None,
        }
        monkeypatch.setattr(main_module.db, "get_usage", lambda user_id: usage)

    return _install


def _pgn_response(text: str = STUDY_PGN, status_code: int = 200) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.url = "https://lichess.org/api/study/tmpWkSq1.pgn"
    return response


# ---------------------------------------------------------------------------
# Parser: the chapter's own lesson text and its Lichess deep link
# ---------------------------------------------------------------------------


def test_parser_keeps_the_chapter_root_comment():
    parsed = studies.parse_study_pgn(STUDY_PGN, "tmpWkSq1")
    assert parsed.chapter_count == 2
    first = parsed.chapters[0]
    # A position-only chapter's lesson lives on the starting position.
    assert first.total_moves == 0
    assert "Provocation" in (first.initial_comment or "")
    assert "permanent hole" in (first.initial_comment or "")
    assert first.chapter_url == "https://lichess.org/study/tmpWkSq1/HS6vRV0B"
    assert parsed.position_only_chapters == 1


def test_parser_reads_move_annotations_and_marks():
    parsed = studies.parse_study_pgn(STUDY_PGN, "tmpWkSq1")
    chapter = parsed.chapters[1]
    assert chapter.total_moves == 3
    assert chapter.chapter_url == "https://lichess.org/study/tmpWkSq1/dPToql1N"
    # moves_tree holds the root variations; the main line is each node's first
    # child, and the annotation sits on the study's last move.
    move = chapter.moves_tree[0]
    assert move.san == "Qg6"
    hidden = move.variations[0].variations[0]
    assert hidden.san == "Nxg6+"
    assert hidden.comment == "A double pin finishes it."
    assert [circle.square for circle in hidden.circles] == ["h7"]
    assert [(arrow.from_square, arrow.to_square) for arrow in hidden.arrows] == [
        ("f5", "g6")
    ]
    assert parsed.annotator == "MentalCarlsen"


# ---------------------------------------------------------------------------
# Lichess transport: the token, the failure modes, and the cache
# ---------------------------------------------------------------------------


def test_export_sends_the_token(monkeypatch: pytest.MonkeyPatch):
    seen: Dict[str, Any] = {}

    def fake_get(url, params=None, headers=None, timeout=None, allow_redirects=True):
        seen.update({"url": url, "headers": headers or {}})
        return _pgn_response()

    monkeypatch.setenv("LICHESS_TOKEN", "tok-123")
    monkeypatch.setattr(studies.http, "get", fake_get)
    studies.fetch_lichess_study_pgn("tmpWkSq1")
    assert seen["url"] == "https://lichess.org/api/study/tmpWkSq1.pgn"
    assert seen["headers"]["Authorization"] == "Bearer tok-123"


def test_export_without_a_token_sends_no_authorization(monkeypatch: pytest.MonkeyPatch):
    seen: Dict[str, Any] = {}

    def fake_get(url, params=None, headers=None, timeout=None, allow_redirects=True):
        seen.update({"headers": headers or {}})
        return _pgn_response()

    monkeypatch.delenv("LICHESS_TOKEN", raising=False)
    monkeypatch.setattr(studies.http, "get", fake_get)
    studies.fetch_lichess_study_pgn("tmpWkSq1")
    assert "Authorization" not in seen["headers"]


@pytest.mark.parametrize("status", [401, 403])
def test_export_maps_refused_reads_to_a_private_study(
    monkeypatch: pytest.MonkeyPatch, status: int
):
    monkeypatch.setattr(
        studies.http, "get", lambda *a, **k: _pgn_response("", status_code=status)
    )
    with pytest.raises(studies.StudyPrivateError):
        studies.fetch_lichess_study_pgn("tmpWkSq1")


def test_export_maps_404_and_empty_exports_to_not_found(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        studies.http, "get", lambda *a, **k: _pgn_response("", status_code=404)
    )
    with pytest.raises(studies.StudyNotFoundError):
        studies.fetch_lichess_study_pgn("tmpWkSq1")

    monkeypatch.setattr(studies.http, "get", lambda *a, **k: _pgn_response("   "))
    with pytest.raises(studies.StudyNotFoundError):
        studies.fetch_lichess_study_pgn("tmpWkSq1")


def test_a_parsed_study_is_served_from_cache(monkeypatch: pytest.MonkeyPatch):
    calls: List[str] = []

    def fake_get(url, params=None, headers=None, timeout=None, allow_redirects=True):
        calls.append(url)
        return _pgn_response()

    monkeypatch.setattr(studies.http, "get", fake_get)
    first = studies.import_lichess_study("tmpWkSq1")
    second = studies.import_lichess_study("tmpWkSq1")
    forced = studies.import_lichess_study("tmpWkSq1", use_cache=False)
    assert len(calls) == 2
    assert first.source == "lichess"
    assert second.source == "cache"
    assert forced.source == "lichess"
    assert second.chapter_count == first.chapter_count


def test_the_study_index_parses_ndjson_and_sorts_by_recency(
    monkeypatch: pytest.MonkeyPatch,
):
    body = "\n".join(
        json.dumps({"id": row["id"], "name": row["name"], "updatedAt": row["updated_at"]})
        for row in INDEX_ROWS
    )
    monkeypatch.setattr(studies.http, "get", lambda *a, **k: _pgn_response(body))
    rows = studies.list_owner_studies("TestCoach")
    assert [row["id"] for row in rows][0] == "tmpPin01"
    assert rows[-1]["name"] == "Brand New Study"
    assert studies.list_owner_studies("TestCoach") is not None  # served from cache


def test_the_study_index_reports_a_refused_read(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        studies.http, "get", lambda *a, **k: _pgn_response("", status_code=403)
    )
    with pytest.raises(studies.StudyPrivateError):
        studies.list_owner_studies("TestCoach")


# ---------------------------------------------------------------------------
# Vocabulary: names may only suggest themes that really exist
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Advanced Pins", "pin"),
        ("PINS ULTIMATE PUZZLES", "pin"),
        ("FORK WITH PAWN", "fork"),
        ("ULTIMATE FORKS PUZZLES", "fork"),
        ("Mate in two Harder", "mateIn2"),
        ("MATE IN 1", "mateIn1"),
        ("X-RAY", "xRayAttack"),
        ("DOUBLE CHECK", "doubleCheck"),
        ("DISCOVERED CHECK", "discoveredCheck"),
        ("Castling Early", "castling"),
        # Only a real signal counts: these names claim nothing the app can name.
        ("Mating Matador", None),
        ("Happy Pieces Knights", None),
        ("Endgame Roadmap : Your Compass for Endgame", None),
        ("Weak Squares 2", None),
        ("TEST YOUR KNOWLEDGE", None),
    ],
)
def test_theme_suggestions(name: str, expected: str | None):
    assert library.suggest_theme(name) == expected


def test_every_lichess_group_points_at_a_real_slug():
    for slug, meta in library.vocabulary().items():
        link = library.group_meta(slug)["training_url"]
        assert link == f"https://lichess.org/training/{slug}"
        assert meta["label"]


# ---------------------------------------------------------------------------
# The library payload
# ---------------------------------------------------------------------------


def test_library_joins_the_overlay_with_the_live_index():
    payload = library.build_library(tier="student")
    titles = {item["title"] for item in payload["studies"]}
    assert payload["owner"] == "TestCoach"
    assert payload["configured"] is True
    # The overlay's curated title is refreshed from the live index…
    assert "Advanced Pins" in titles
    # …a study the overlay has never seen still appears, unfiled…
    assert "Brand New Study" in titles
    new = next(item for item in payload["studies"] if item["title"] == "Brand New Study")
    assert new["group"] == library.UNFILED_GROUP
    # …a hidden study is not listed, and an overlay-only one is reported.
    assert "Alex Game" not in titles
    assert payload["hidden_count"] == 1
    assert payload["missing_from_index"] == ["tmpGone1"]
    assert payload["total_studies"] == 5


def test_free_tier_unlocks_the_studies_its_own_leaks_point_at():
    payload = library.build_library(tier="free", observed={"pin": 4, "fork": 1})
    assert payload["locked_count"] == 3
    # The two worst motifs decide the sample; the order in the payload is just
    # a stable sort of the same set.
    assert set(payload["unlocked_ids"]) == {"tmpPin01", "tmpFrk01"}
    locked = {item["id"] for item in payload["studies"] if item["locked"]}
    assert locked == {"tmpWkSq1", "tmpGone1", "tmpNew01"}


def test_free_tier_with_no_history_opens_the_first_studies():
    payload = library.build_library(tier="free")
    assert set(payload["unlocked_ids"]) == {"tmpPin01", "tmpFrk01"}


def test_paid_tier_locks_nothing():
    payload = library.build_library(tier="student")
    assert payload["locked_count"] == 0
    assert all(not item["locked"] for item in payload["studies"])
    assert library.unlocked_study_ids(payload) is None


def test_curated_cards_point_at_the_coachs_own_study():
    payload = library.build_library(tier="free", observed={"pin": 4})
    curated = [
        {
            "id": "curated-pin",
            "title": "Practice Pins",
            "reason": "…",
            "source_url": "https://lichess.org/training/pin",
            "motif": "pin",
            "chapters": None,
        },
        {
            "id": "curated-trapped",
            "title": "Trapped Pieces",
            "reason": "…",
            "source_url": "https://lichess.org/training/trappedPiece",
            "motif": "trappedPiece",
            "chapters": None,
        },
    ]
    covered = library.attach_curated_studies(curated, payload)
    assert covered[0]["study_id"] == "tmpPin01"
    assert covered[0]["study_title"] == "Advanced Pins"
    assert covered[0]["source_url"] == "https://lichess.org/study/tmpPin01"
    assert covered[0]["locked"] is False
    # A motif the library does not teach keeps its Lichess training link.
    assert covered[1].get("study_id") is None
    assert covered[1]["source_url"] == "https://lichess.org/training/trappedPiece"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def test_anonymous_library_is_empty_and_leaks_nothing():
    """The dedicated library endpoint stays shut to signed-out callers."""
    app.dependency_overrides[get_optional_user] = lambda: None
    response = client.get("/api/studies/library")
    body = response.json()
    assert response.status_code == 200
    assert body["signed_in"] is False
    assert body["studies"] == []
    assert body["groups"] == []
    for secret in ["Advanced Pins", "Weak Squares", "TestCoach", "tmpPin01"]:
        assert secret not in response.text


def test_anonymous_tactics_offer_a_shop_window():
    """The public page shows the catalogue with the free sample already open."""
    app.dependency_overrides[get_optional_user] = lambda: None
    body = client.get("/api/tactics").json()
    preview = body["library"]
    assert preview["preview"] is True
    assert preview["total_studies"] >= 3
    # Exactly the free allowance is open, and it is a real allowance: the same
    # number a signed-in free account gets.
    open_studies = [study for study in preview["studies"] if not study["locked"]]
    assert len(open_studies) == library.FREE_STUDY_LIMIT
    assert preview["unlocked_ids"] == sorted(study["id"] for study in open_studies)
    assert preview["locked_count"] == preview["total_studies"] - len(open_studies)
    assert preview["groups"], "the teaser still groups the studies"


def test_the_open_preview_studies_are_readable_without_an_account(
    monkeypatch: pytest.MonkeyPatch,
):
    """The shop window has to actually open, and stay exactly that wide."""
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr(studies.http, "get", lambda *a, **k: _pgn_response())
    preview = client.get("/api/tactics").json()["library"]

    for study in preview["studies"]:
        response = client.get(f"/api/studies/import/{study['id']}")
        if study["locked"]:
            assert response.status_code == 401, study["id"]
        else:
            assert response.status_code == 200, study["id"]


def test_anonymous_tactics_carry_no_personalisation():
    app.dependency_overrides[get_optional_user] = lambda: None
    body = client.get("/api/tactics").json()
    assert all("study" not in theme for theme in body["themes"])
    assert all("observed_count" not in theme for theme in body["themes"])


def test_signed_in_tactics_carry_the_library_and_the_theme_pointer(
    as_user, tier, monkeypatch: pytest.MonkeyPatch
):
    as_user()
    tier("student")
    body = client.get("/api/tactics").json()
    assert body["library"]["total_studies"] == 5
    pin = next(theme for theme in body["themes"] if theme["key"] == "pin")
    assert pin["study"]["id"] == "tmpPin01"
    assert pin["study"]["locked"] is False


def test_curated_endpoint_uses_the_coachs_study(as_user, tier, monkeypatch):
    as_user()
    tier("student")
    monkeypatch.setattr(
        main_module.db,
        "list_analyses",
        lambda user_id, limit=None, columns=None: [
            {
                "id": "analysis-1",
                "game_id": "abcd1234",
                "status": "completed",
                "insights": {
                    "weakness_moments": [
                        {
                            "move_number": 12,
                            "quality": "blunder",
                            "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
                            "motif": "Pin",
                            "centipawn_loss": 320,
                        }
                    ]
                },
                "game_summary": {"opponent_name": "Hikaru"},
            }
        ],
    )
    body = client.get("/api/studies/curated").json()
    assert body[0]["motif"] == "pin"
    assert body[0]["study_id"] == "tmpPin01"
    assert body[0]["source_url"] == "https://lichess.org/study/tmpPin01"


def test_import_requires_a_session_for_a_locked_library_study():
    """The shop window is two studies wide, not the whole library."""
    app.dependency_overrides[get_optional_user] = lambda: None
    assert client.get("/api/studies/import/tmpWkSq1").status_code == 401


def test_import_still_serves_a_public_study_anonymously(
    monkeypatch: pytest.MonkeyPatch,
):
    """A study outside the library is not gated: the old path is unchanged."""
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr(studies.http, "get", lambda *a, **k: _pgn_response())
    assert client.get("/api/studies/import/zzzz9999").status_code == 200


def test_import_refuses_a_locked_study_with_an_upgrade_hint(as_user, tier):
    as_user()
    tier("free")
    response = client.get("/api/studies/import/tmpWkSq1")
    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "upgrade_required"
    assert detail["feature"] == "studies"


def test_import_opens_the_study_a_free_tier_unlocks(
    as_user, tier, monkeypatch: pytest.MonkeyPatch
):
    as_user()
    tier("free")
    monkeypatch.setattr(
        studies.http, "get", lambda *a, **k: _pgn_response()
    )
    response = client.get("/api/studies/import/tmpPin01")
    assert response.status_code == 200
    assert response.json()["chapter_count"] == 2


def test_import_opens_a_study_outside_the_library(
    as_user, tier, monkeypatch: pytest.MonkeyPatch
):
    """A public Lichess study is still importable — only the library is gated."""
    as_user()
    tier("free")
    monkeypatch.setattr(studies.http, "get", lambda *a, **k: _pgn_response())
    response = client.get("/api/studies/import/zzzz9999")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# The join: a leak, its theme, and the studies that answer it
# ---------------------------------------------------------------------------


def test_theme_coverage_describes_a_covered_and_an_uncovered_theme():
    built = library.build_library(tier="student")
    pin = library.theme_coverage(built, "pin")
    assert pin["label"] == "Pin"
    assert pin["kind"] == "lichess"
    assert pin["training_url"] == "https://lichess.org/training/pin"
    assert pin["study_count"] == 1
    assert [study["title"] for study in pin["studies"]] == ["Advanced Pins"]

    fork = library.theme_coverage(built, "fork")
    assert {study["title"] for study in fork["studies"]} == {"FORK", "Deleted Study"}

    # A real Lichess theme the library has no study for: the drill link stands.
    promotion = library.theme_coverage(built, "promotion")
    assert promotion["study_count"] == 0
    assert promotion["training_url"] == "https://lichess.org/training/promotion"

    # A phase fallback with no vocabulary entry still gets its real link.
    mix = library.theme_coverage(built, "blunder")
    assert mix["training_url"] == "https://lichess.org/training/mix"


def test_practice_plan_follows_the_players_own_leaks():
    built = library.build_library(tier="student")
    plan = library.practice_plan(built, {"pin": 6, "fork": 2, "zugzwang": 1})
    assert [item["theme"] for item in plan] == ["pin", "fork", "zugzwang"]
    assert plan[0]["observed_count"] == 6
    assert plan[0]["study_count"] == 1
    assert plan[1]["study_count"] == 2
    # The library teaches no zugzwang, and that is reported rather than hidden.
    assert plan[2]["study_count"] == 0
    assert plan[2]["training_url"] == "https://lichess.org/training/zugzwang"
    assert library.practice_plan(built, {"pin": 6, "fork": 2}, limit=1) == [plan[0]]


def test_curated_cards_carry_the_themes_words():
    built = library.build_library(tier="free", observed={"pin": 4})
    curated = [
        {
            "id": "curated-pin",
            "title": "Practice Pins",
            "reason": "…",
            "source_url": "https://lichess.org/training/pin",
            "motif": "pin",
            "chapters": None,
        },
        {
            "id": "curated-zugzwang",
            "title": "Zugzwang Positions",
            "reason": "…",
            "source_url": "https://lichess.org/training/zugzwang",
            "motif": "zugzwang",
            "chapters": None,
        },
    ]
    covered, uncovered = library.attach_curated_studies(curated, built)
    assert covered["theme_label"] == "Pin"
    assert covered["theme_description"].startswith("A piece cannot move")
    assert covered["study_count"] == 1
    assert covered["study_id"] == "tmpPin01"
    assert covered["locked"] is False
    # No study for zugzwang yet: the Lichess link stays, and the gap is visible.
    assert uncovered["study_count"] == 0
    assert uncovered["source_url"] == "https://lichess.org/training/zugzwang"
    assert uncovered.get("study_id") is None


# ---------------------------------------------------------------------------
# The report read: library studies ride along with the engine's own resources
# ---------------------------------------------------------------------------


def _analysis_row() -> Dict[str, Any]:
    return {
        "id": "analysis-1",
        "game_id": "g1",
        "status": "completed",
        "insights": {
            "weakness_moments": [
                {
                    "move_number": 12,
                    "san": "Nf3",
                    "quality": "blunder",
                    "motif": "Pin",
                    "resource_theme": "pin",
                    "centipawn_loss": 320,
                    "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
                }
            ],
            "resources": [
                {
                    "title": "Practice Pins",
                    "url": "https://lichess.org/training/pin",
                    "theme": "pin",
                    "source_move": "12. Nf3",
                }
            ],
        },
        "game_summary": {"opponent_name": "Hikaru"},
    }


def test_a_report_gains_the_coachs_studies(as_user, tier, monkeypatch):
    as_user()
    tier("student")
    monkeypatch.setattr(main_module.db, "get_analysis", lambda uid, aid: _analysis_row())
    monkeypatch.setattr(main_module.db, "list_messages", lambda aid: [])

    body = client.get("/api/analyses/analysis-1").json()["analysis"]
    resources = body["insights"]["resources"]
    engine = [item for item in resources if item.get("kind") != "library"]
    coach = [item for item in resources if item.get("kind") == "library"]
    # The engine's own resource is untouched…
    assert engine == [
        {
            "title": "Practice Pins",
            "url": "https://lichess.org/training/pin",
            "theme": "pin",
            "source_move": "12. Nf3",
        }
    ]
    # …and the coach's study for this leak is appended once.
    assert coach == [
        {
            "title": "Advanced Pins",
            "url": "https://lichess.org/study/tmpPin01",
            "theme": "pin",
            "source_move": None,
            "kind": "library",
            "locked": False,
        }
    ]


def test_a_report_never_hands_over_a_locked_study(as_user, tier, monkeypatch):
    """No free allowance left: the study is named and marked locked."""
    as_user()
    tier("free")
    monkeypatch.setattr(library, "FREE_STUDY_LIMIT", 0)
    monkeypatch.setattr(main_module.db, "get_analysis", lambda uid, aid: _analysis_row())
    monkeypatch.setattr(main_module.db, "list_messages", lambda aid: [])
    body = client.get("/api/analyses/analysis-1").json()["analysis"]
    coach = [r for r in body["insights"]["resources"] if r.get("kind") == "library"]
    assert coach and all(item["locked"] for item in coach)


def test_a_report_without_moments_is_untouched(as_user, tier, monkeypatch):
    as_user()
    tier("student")
    empty = {"id": "a", "game_id": "g", "status": "completed", "insights": {"resources": []}}
    monkeypatch.setattr(main_module.db, "get_analysis", lambda uid, aid: empty)
    monkeypatch.setattr(main_module.db, "list_messages", lambda aid: [])
    body = client.get("/api/analyses/a").json()["analysis"]
    assert body["insights"] == {"resources": []}


def test_the_progress_plan_is_built_from_the_reports_own_leaks(
    as_user, tier, monkeypatch: pytest.MonkeyPatch
):
    as_user()
    tier("student")
    from services import progress as progress_service

    rows = [
        {
            "id": f"analysis-{index}",
            "status": "completed",
            "platform": "lichess",
            "username": "tester",
            "game_url": f"https://lichess.org/game-{index}",
            "player_color": "white",
            "player_name": "Tester",
            "opening_name": "Sicilian Defence",
            "eco": "B20",
            "result": "1-0",
            "created_at": f"2026-01-{index + 1:02d}T00:00:00Z",
            "pgn": '[TimeControl "300+0"]\n',
            "insights": {
                "weakness_moments": [
                    {
                        "move_number": 10 + index,
                        "san": "Nf3",
                        "quality": "blunder",
                        "motif": "Pin",
                        "resource_theme": "pin",
                        "centipawn_loss": 300,
                        "fen_before": "8/8/8/8/8/8/8/8 w - - 0 1",
                    }
                ]
            },
            "game_summary": {"opponent_name": "Hikaru", "player_color": "white"},
        }
        for index in range(6)
    ]
    monkeypatch.setattr(progress_service, "_load_rows", lambda *a, **k: rows)

    body = client.get("/api/progress").json()
    plan = body.get("practice_plan") or []
    assert plan, "the report's own root causes should produce a plan"
    # Ordered by what cost the player most, and the pin study is attached.
    counts = [item["observed_count"] for item in plan]
    assert counts == sorted(counts, reverse=True)
    pin = next(item for item in plan if item["theme"] == "pin")
    assert [study["title"] for study in pin["studies"]] == ["Advanced Pins"]
    assert pin["studies"][0]["source_url"] == "https://lichess.org/study/tmpPin01"
    assert pin["training_url"] == "https://lichess.org/training/pin"
    # A habit-shaped cause (clock panic → "rushedMove") is not a Lichess theme,
    # so it must speak with the report's own words rather than a humanised key.
    rushed = next((item for item in plan if item["theme"] == "rushedmove"), None)
    if rushed is not None:
        assert rushed["label"] == "Clock panic"
        assert rushed["description"]
        assert rushed["kind"] == "coach"
        assert rushed["study_count"] == 0
