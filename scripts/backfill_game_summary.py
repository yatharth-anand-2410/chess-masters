"""Bring stored ``analyses.game_summary`` rows up to the current metrics.

Run from the repo root with the backend's Supabase service credentials::

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        .venv/bin/python scripts/backfill_game_summary.py            # dry run
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        .venv/bin/python scripts/backfill_game_summary.py --apply    # write

For every completed analysis:

* rows with a stored replay are recomputed under ``telemetry.METRIC_VERSION``
  (Lichess winning-chance grading, Lichess game accuracy, true ACPL, the
  player's own blunder counts) from the evaluations already stored. No engine
  run, no estimates: see ``telemetry.upgrade_game_summary``;
* rows without a replay keep their metrics and version, and only gain the date
  the game was played when the PGN header carries one.

Rows that are already current are skipped, so re-running is safe. The dry run
prints what would change and writes nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from services import db, extractor, telemetry  # noqa: E402

PAGE_SIZE = 200
COLUMNS = "id,user_id,pgn,game_summary,replay"


def _rows() -> Iterator[Dict[str, Any]]:
    """Every completed analysis, oldest first, one page at a time."""
    url, _key = db._config()
    offset = 0
    while True:
        response = db._get(
            f"{url}/rest/v1/analyses",
            params={
                "select": COLUMNS,
                "status": "eq.completed",
                "order": "created_at.asc,id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
            headers=db._service_headers(),
            timeout=db.TIMEOUT,
        )
        response.raise_for_status()
        page = response.json()
        yield from page
        if len(page) < PAGE_SIZE:
            return
        offset += PAGE_SIZE


def _date_only(summary: Dict[str, Any], pgn: Optional[str]) -> Optional[Dict[str, Any]]:
    """A summary that only gains its play date, or ``None`` if nothing changes."""
    if summary.get("played_at") or not pgn:
        return None
    played_at = extractor.parse_game_metadata(pgn)["started_at"]
    if not played_at:
        return None
    return {**summary, "played_at": played_at}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--apply", action="store_true", help="write the changes (default: dry run)"
    )
    args = parser.parse_args()

    if not db.configured():
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        return 2

    seen = upgraded = dated = skipped = 0
    for row in _rows():
        seen += 1
        summary = row.get("game_summary")
        if not isinstance(summary, dict):
            # 0017_backfill_game_summary.sql owns rows with no summary at all.
            skipped += 1
            continue
        new_summary = telemetry.upgrade_game_summary(summary, row.get("replay"), row.get("pgn"))
        kind = "upgrade"
        if new_summary is None:
            new_summary = _date_only(summary, row.get("pgn"))
            kind = "date"
        if new_summary is None:
            skipped += 1
            continue

        if kind == "upgrade":
            upgraded += 1
            print(
                f"{row['id']}: accuracy {summary.get('accuracy')} -> "
                f"{new_summary.get('accuracy')}, blunders "
                f"{(summary.get('quality') or {}).get('blunder')} -> "
                f"{new_summary['quality']['blunder']}, acpl -> {new_summary.get('acpl')}, "
                f"played_at -> {new_summary.get('played_at')}"
            )
        else:
            dated += 1
            print(f"{row['id']}: played_at -> {new_summary['played_at']}")

        if args.apply:
            db.update_analysis(
                str(row["user_id"]), str(row["id"]), {"game_summary": new_summary}
            )

    mode = "Applied" if args.apply else "Dry run (nothing written)"
    print(
        f"\n{mode}: {seen} completed rows, {upgraded} recomputed to metric "
        f"version {telemetry.METRIC_VERSION}, {dated} given a play date only, "
        f"{skipped} unchanged."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
