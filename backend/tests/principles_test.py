"""Offline unit tests for the curated coaching-principle library.

Run from the backend directory:
    ../.venv/bin/python -m tests.principles_test
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import analyzer, principles


def _entry(**overrides: object) -> dict:
    entry: dict = {
        "id": "entry",
        "title": "A test principle",
        "signals": [],
        "phases": [],
        "motifs": [],
        "observed_template": "",
        "mechanism": "mechanism",
        "rule": "rule",
        "concept_source": "test:reference",
        # Default to a signed-off entry: most tests here exercise retrieval and
        # ranking, and the review gate would otherwise exclude every fixture.
        # Tests that need an unsigned entry pass reviewed_by=REVIEW_PENDING.
        "reviewed_by": "Test Reviewer",
        "reviewed_on": "2026-01-01",
    }
    entry.update(overrides)
    return entry


def _with_library(entries: list):
    """Temporarily replace the cached library."""

    class _Library:
        def __enter__(self) -> None:
            self.original = principles._CACHE
            principles._CACHE = entries

        def __exit__(self, *exc: object) -> None:
            principles._CACHE = self.original

    return _Library()


def _write(tmp: Path, name: str, text: str) -> Path:
    path = tmp / name
    path.write_text(text, encoding="utf-8")
    return path


def test_missing_file_returns_empty_library():
    with tempfile.TemporaryDirectory() as tmp:
        missing = Path(tmp) / "nope.json"
        assert principles.load_principles(missing) == []


def test_empty_file_returns_empty_library():
    with tempfile.TemporaryDirectory() as tmp:
        empty = _write(Path(tmp), "empty.json", "")
        assert principles.load_principles(empty) == []
        blank = _write(Path(tmp), "blank.json", "\n  \n")
        assert principles.load_principles(blank) == []


def test_malformed_json_returns_empty_library():
    with tempfile.TemporaryDirectory() as tmp:
        broken = _write(Path(tmp), "broken.json", "[{not json,,,}]")
        assert principles.load_principles(broken) == []
        not_a_list = _write(Path(tmp), "object.json", '{"id": "x"}')
        assert principles.load_principles(not_a_list) == []


def test_malformed_entries_are_skipped_not_fatal():
    with tempfile.TemporaryDirectory() as tmp:
        mixed = _write(
            Path(tmp),
            "mixed.json",
            json.dumps(
                [
                    "not an object",
                    {"title": "no id"},
                    {"id": "  "},
                    _entry(id="ok", signals=["post_error_rush"]),
                    _entry(id="ok"),
                ]
            ),
        )
        loaded = principles.load_principles(mixed)
        assert [entry["id"] for entry in loaded] == ["ok"]


def test_load_is_cached_for_the_default_path():
    principles.clear_cache()
    first = principles.load_principles()
    assert first is principles.load_principles()
    explicit = principles.load_principles(principles.PRINCIPLES_PATH)
    assert explicit is not first or first == []


def test_shipped_library_is_signed_off():
    """Every shipped principle must carry a human sign-off.

    The library is gated on this, so an entry left at REVIEW_PENDING would be
    silently invisible in production rather than reaching a report.
    """
    principles.clear_cache()
    library = principles.load_principles()
    assert library, "the shipped library should contain exemplar entries"
    for entry in library:
        assert entry["reviewed_by"] != principles.REVIEW_PENDING, (
            f"{entry['id']} is still awaiting review"
        )
        assert entry["reviewed_on"], f"{entry['id']} has no review date"
        for field in ("signals", "phases", "motifs"):
            assert isinstance(entry[field], list)


def test_retrieval_by_signal():
    results = principles.principles_for(signals=["post_error_rush"])
    assert "post_error_rush" in [entry["id"] for entry in results]


def test_retrieval_by_signal_names_only_real_signals():
    results = principles.principles_for(signals=["time_pressure"])
    assert "time_pressure_snap_decision" in [entry["id"] for entry in results]


def test_retrieval_by_motif_accepts_label_or_key():
    by_key = principles.principles_for(signals=[], motif="hangingPiece")
    by_label = principles.principles_for(signals=[], motif="Hanging piece")
    assert "missed_loose_piece" in [entry["id"] for entry in by_key]
    assert [entry["id"] for entry in by_key] == [entry["id"] for entry in by_label]


def test_retrieval_by_motif_excludes_non_matching_motifs():
    results = principles.principles_for(signals=[], motif="fork")
    assert [entry["id"] for entry in results] == []


def test_retrieval_respects_phase():
    middlegame = principles.principles_for(
        signals=["reached_winning_position"], phase="middlegame"
    )
    opening = principles.principles_for(
        signals=["reached_winning_position"], phase="opening"
    )
    assert [entry["id"] for entry in middlegame] == ["convert_without_haste"]
    assert opening == []


def test_no_signals_and_no_motif_returns_nothing_from_shipped_library():
    assert principles.principles_for(signals=[]) == []


def test_specificity_more_signals_wins():
    broad = _entry(id="broad", signals=["post_error_rush"])
    narrow = _entry(id="narrow", signals=["post_error_rush", "time_pressure"])
    with _with_library([broad, narrow]):
        results = principles.principles_for(
            signals=["post_error_rush", "time_pressure"]
        )
        assert [entry["id"] for entry in results] == ["narrow", "broad"]


def test_specificity_motif_beats_phase_only():
    motif_entry = _entry(id="motif", signals=["post_error_rush"], motifs=["fork"])
    phase_entry = _entry(id="phase", signals=["post_error_rush"], phases=["endgame"])
    with _with_library([phase_entry, motif_entry]):
        results = principles.principles_for(
            signals=["post_error_rush"], motif="fork", phase="endgame"
        )
        assert [entry["id"] for entry in results] == ["motif", "phase"]


def test_empty_phases_and_motifs_match_anything():
    wildcard = _entry(id="wildcard", signals=["post_error_rush"])
    with _with_library([wildcard]):
        results = principles.principles_for(
            signals=["post_error_rush"], motif="skewer", phase="endgame"
        )
        assert len(results) == 1


def test_non_matching_phase_is_excluded():
    entry = _entry(id="endgame_only", signals=["post_error_rush"], phases=["endgame"])
    with _with_library([entry]):
        results = principles.principles_for(signals=["post_error_rush"], phase="opening")
        assert results == []


def test_limit_is_respected():
    entries = [
        _entry(id=f"p{index}", signals=["post_error_rush"]) for index in range(5)
    ]
    with _with_library(entries):
        assert len(principles.principles_for(signals=["post_error_rush"], limit=2)) == 2
        assert principles.principles_for(signals=["post_error_rush"], limit=0) == []


def test_unreviewed_entries_are_gated_out_but_can_be_requested():
    pending = _entry(
        id="pending",
        signals=["post_error_rush"],
        reviewed_by=principles.REVIEW_PENDING,
        reviewed_on=None,
    )
    signed = _entry(id="signed", signals=["post_error_rush"])
    with _with_library([pending, signed]):
        gated = {
            entry["id"]
            for entry in principles.principles_for(signals=["post_error_rush"])
        }
        everything = {
            entry["id"]: entry
            for entry in principles.principles_for(
                signals=["post_error_rush"], include_unreviewed=True
            )
        }
    assert gated == {"signed"}, "an unsigned principle must not reach a report"
    assert everything["pending"]["reviewed"] is False
    assert everything["signed"]["reviewed"] is True


def test_render_observed_fills_dotted_clues():
    principle = _entry(
        observed_template=(
            "You played {move} and answered {next_move.san} after "
            "{next_move.seconds_spent} second(s), with {player_clock_remaining} left."
        )
    )
    evidence = {
        "move": "22. Nxe5",
        "player_clock_remaining": 18.0,
        "next_move": {"san": "Qd4", "seconds_spent": 1.0},
    }
    assert principles.render_observed(principle, evidence) == (
        "You played 22. Nxe5 and answered Qd4 after 1 second(s), with 18 left."
    )


def test_render_observed_returns_empty_when_slot_is_missing():
    principle = _entry(
        observed_template="You had {player_clock_remaining} second(s) left."
    )
    assert principles.render_observed(principle, {"move": "22. Nxe5"}) == ""
    assert principles.render_observed(principle, {"player_clock_remaining": None}) == ""
    assert principles.render_observed(
        _entry(observed_template="Answer {next_move.seconds_spent}"), {"next_move": {}}
    ) == ""
    assert principles.render_observed(
        _entry(observed_template="{}"), {"move": "22. Nxe5"}
    ) == ""


def test_render_observed_returns_empty_without_template():
    assert principles.render_observed(_entry(observed_template=""), {"move": "x"}) == ""
    assert principles.render_observed({}, {"move": "x"}) == ""


def _engine_data() -> dict:
    return {
        "player_color": "white",
        "strength_moments": [
            {
                "move_number": 30,
                "san": "Rxd8",
                "color": "white",
                "phase": "endgame",
                "quality": "strong",
                "eval_before_pawns": 2.4,
                "eval_after_pawns": 2.9,
                "seconds_spent": 8.0,
                "clock_remaining": 210.0,
            }
        ],
        "weakness_moments": [
            {
                "move_number": 22,
                "san": "Nxe5",
                "color": "white",
                "phase": "middlegame",
                "quality": "blunder",
                "seconds_spent": 2.0,
                "clock_remaining": 18.0,
                "next_move": {"san": "Qd4", "seconds_spent": 1.0},
                "post_error_rush": True,
                "motif": "Hanging piece",
                "motif_details": "Opponent's B on c5 is undefended and capturable.",
            }
        ],
    }


def _baseline_moments(engine_data: dict) -> list:
    """The payload moments exactly as they are assembled without the library."""
    return [
        analyzer._moment_evidence(
            "strength-0", "strength", engine_data["strength_moments"][0]
        ),
        analyzer._moment_evidence(
            "weakness-0", "weakness", engine_data["weakness_moments"][0]
        ),
    ]


def test_moment_signals_read_only_real_evidence():
    moment = _engine_data()["weakness_moments"][0]
    evidence = analyzer._moment_evidence("weakness-0", "weakness", moment)
    assert analyzer._moment_signals(evidence) == [
        "post_error_rush",
        "rushed_blunders",
        "time_pressure",
    ]
    bare = analyzer._moment_evidence(
        "weakness-1", "weakness", {"move_number": 4, "san": "e4"}
    )
    assert analyzer._moment_signals(bare) == []


def test_payload_attaches_principles_when_library_is_populated():
    payload = analyzer._build_moment_payload(_engine_data())
    weakness = payload["moments"][1]
    sent = weakness["principles"]
    assert [entry["title"] for entry in sent] == [
        "Deciding on an empty tank",
        "The post-error rush",
    ]
    # Only coaching fields reach the model: no authoring metadata, and above all
    # no observed_template, which holds raw "{placeholder}" text the model could
    # otherwise echo into a report.
    allowed = set(analyzer.PRINCIPLE_PROMPT_FIELDS)
    for entry in sent:
        assert set(entry) <= allowed, f"unexpected field(s): {set(entry) - allowed}"
        assert "id" not in entry
        assert "observed_template" not in entry
        assert "{" not in str(entry.get("observed", ""))
    assert sent[0]["observed"] == (
        "You chose 22. Nxe5 with only 18 second(s) left on your clock."
    )
    strength = payload["moments"][0]
    assert [entry["title"] for entry in strength["principles"]] == [
        "Winning quietly instead of quickly"
    ]
    assert "observed" not in strength["principles"][0]


def test_payload_is_unchanged_when_library_is_empty():
    engine_data = _engine_data()
    with _with_library([]):
        empty_payload = analyzer._build_moment_payload(engine_data)
    expected = {
        "player_color": "white",
        "moments": _baseline_moments(engine_data),
    }
    assert empty_payload == expected
    assert json.dumps(empty_payload, sort_keys=True) == json.dumps(
        expected, sort_keys=True
    )
    assert all("principles" not in moment for moment in empty_payload["moments"])


def test_payload_unchanged_when_library_file_is_missing():
    original = principles.PRINCIPLES_PATH
    try:
        principles.PRINCIPLES_PATH = Path("/nonexistent/principles.json")
        principles.clear_cache()
        engine_data = _engine_data()
        payload = analyzer._build_moment_payload(engine_data)
        assert payload == {
            "player_color": "white",
            "moments": _baseline_moments(engine_data),
        }
    finally:
        principles.PRINCIPLES_PATH = original
        principles.clear_cache()


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
