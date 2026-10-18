"""Refresh ``backend/data/study_library.json`` from the live Lichess index.

Run from the repo root::

    LICHESS_TOKEN=... python scripts/sync_study_library.py --check   # report only
    LICHESS_TOKEN=... python scripts/sync_study_library.py           # write

The overlay is the *curation* layer: which motif or coach group each study
teaches, which studies to hide, and the order to present them in. This script
never overwrites a curation decision. It refreshes titles, adds studies Lichess
knows about that the overlay has not seen (as unfiled, so they are visible for
review), and reports overlay entries Lichess did not return.

A study whose name already names a theme gets that theme suggested on creation
only when ``--suggest`` is passed; without it a new study lands unfiled, which
is the honest default — an auto-matched name is evidence, not a decision.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from services import library, studies  # noqa: E402

OVERLAY_PATH = ROOT / "backend" / "data" / "study_library.json"

_HEADER = (
    "The coach's study library: which motif or coach group each Lichess study "
    "teaches. Maintained by scripts/sync_study_library.py — run it after adding "
    "studies on Lichess. 'group' may be a slug from data/lichess_themes.json "
    "(any slug there opens at lichess.org/training/<slug>) or a key declared in "
    "'groups' below, which carries no external link. Titles are a fallback for "
    "when the live index is unreachable; the live name always wins."
)

_DEFAULT_GROUPS = {
    "weakSquares": {
        "label": "Weak Squares",
        "description": "Colour complexes, holes and outposts: how a square becomes permanently weak, and how to occupy or trade into it.",
    },
    "spaceAdvantage": {
        "label": "Space Advantage",
        "description": "What extra space actually buys, and how to convert it before the opponent catches up.",
    },
    "pawnPlay": {
        "label": "Pawn Play",
        "description": "Pawn structure, breaks, passed pawns and the plans that follow from them.",
    },
    "pieceActivity": {
        "label": "Piece Activity",
        "description": "Getting every piece to a square where it does something: the Happy Pieces series.",
    },
    "trading": {
        "label": "Trading & Captures",
        "description": "When a trade helps and when it hands the opponent the game: choosing what to exchange.",
    },
    "endgamePlay": {
        "label": "Endgame Play",
        "description": "Converting winning endgames, and the technique that turns an advantage into a result.",
    },
    "matePatterns": {
        "label": "Mate Patterns",
        "description": "The mating nets and piece combinations worth knowing by heart, and how to prepare them.",
    },
    "attack": {
        "label": "Attacking Play",
        "description": "Choosing a target and building the attack before the opponent can organise a defence.",
    },
    "blocking": {
        "label": "Blocking",
        "description": "Blocking checks and lines: when interposing a piece is the only move that holds.",
    },
    "quizzes": {
        "label": "Test Yourself",
        "description": "Positions with no stored solution — they are meant to be solved cold, or discussed with a coach.",
    },
    "fundamentals": {
        "label": "Fundamentals",
        "description": "Rules, checks and the basics everything else is built on.",
    },
}


def _load(path: Path) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _existing_entries(data: dict) -> dict:
    entries: dict = {}
    for entry in data.get("studies") or []:
        if isinstance(entry, dict) and str(entry.get("id") or "").strip():
            entries[str(entry["id"])] = entry
    return entries


def sync(owner: str, *, suggest: bool, check: bool) -> int:
    if not studies.lichess_configured():
        print("LICHESS_TOKEN is not set: only public studies would be listed.")
    try:
        live = studies.list_owner_studies(owner, use_cache=False)
    except studies.StudyError as exc:
        print(f"Lichess refused the study list: {exc}")
        return 2

    data = _load(OVERLAY_PATH)
    existing = _existing_entries(data)
    live_ids = {row["id"] for row in live}

    entries = []
    new_ids = []
    for row in live:
        study_id = row["id"]
        entry = dict(existing.get(study_id) or {})
        entry["id"] = study_id
        entry["title"] = row.get("name") or entry.get("title") or f"Study {study_id}"
        if "group" not in entry:
            if "motif" in entry:
                entry["group"] = entry.pop("motif")
            elif suggest:
                guessed = library.suggest_theme(entry["title"])
                if guessed:
                    entry["group"] = guessed
        if "hidden" in entry and not entry["hidden"]:
            entry.pop("hidden")
        if not entry.get("title"):
            entry.pop("title")
        entries.append(entry)
        if study_id not in existing:
            new_ids.append(study_id)

    # A study the index no longer returns is kept, not deleted: it may be
    # temporarily unlisted, or the token may be pointed at the wrong account.
    # The library reports it as missing from the index instead.
    orphaned = sorted(set(existing) - live_ids)
    for study_id in orphaned:
        entries.append(dict(existing[study_id]))

    entries.sort(key=lambda item: (int(item.get("order") or 0), item["title"].lower(), item["id"]))
    unfiled = [
        item for item in entries if not item.get("group") and not item.get("hidden")
    ]

    print(f"owner          : {owner}")
    print(f"live studies   : {len(live)}")
    print(f"overlay entries: {len(entries)}")
    print(f"new studies    : {len(new_ids)}")
    for study_id in new_ids:
        item = next(entry for entry in entries if entry["id"] == study_id)
        print(f"    + {study_id}  {item['title']!r}")
    print(f"unfiled        : {len(unfiled)}")
    for item in unfiled:
        print(f"    ? {item['id']}  {item['title']!r}")
    print(f"hidden         : {sum(1 for item in entries if item.get('hidden'))}")
    if orphaned:
        print(f"not in the index ({len(orphaned)}): {', '.join(orphaned)}")

    if check:
        print("\n--check: nothing written.")
        return 0

    groups = dict(_DEFAULT_GROUPS)
    for key, value in (data.get("groups") or {}).items():
        if isinstance(value, dict):
            groups[key] = value

    payload = {
        "_comment": _HEADER,
        "owner": owner,
        "groups": groups,
        "studies": entries,
    }
    OVERLAY_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nwrote {OVERLAY_PATH.relative_to(ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--owner",
        default=os.environ.get("LICHESS_STUDY_OWNER") or "",
        help="Lichess account that owns the studies (default: $LICHESS_STUDY_OWNER)",
    )
    parser.add_argument(
        "--suggest",
        action="store_true",
        help="auto-match a new study's name to a theme instead of leaving it unfiled",
    )
    parser.add_argument(
        "--check", action="store_true", help="report only; never write the file"
    )
    args = parser.parse_args()

    owner = args.owner.strip() or str(_load(OVERLAY_PATH).get("owner") or "").strip()
    if not owner:
        print("No owner: pass --owner or set LICHESS_STUDY_OWNER.")
        return 2
    return sync(owner, suggest=args.suggest, check=args.check)


if __name__ == "__main__":
    raise SystemExit(main())
