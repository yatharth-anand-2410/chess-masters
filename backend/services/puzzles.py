from __future__ import annotations

import json
import os
from typing import Dict, List

_CATALOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "puzzle_catalog.json",
)

_catalog: Dict[str, List[Dict[str, object]]] = {}


def _load_catalog() -> Dict[str, List[Dict[str, object]]]:
    global _catalog
    if not _catalog:
        with open(_CATALOG_PATH, encoding="utf-8") as handle:
            _catalog = json.load(handle)
    return _catalog


def puzzles_for_theme(theme: str, limit: int = 3) -> List[Dict[str, object]]:
    if not theme:
        return []
    catalog = _load_catalog()
    entries = catalog.get(theme)
    if not entries:
        entries = [
            {
                "theme": theme,
                "url": f"https://lichess.org/training/{theme}",
            }
        ]
    return [dict(entry) for entry in entries[:limit]]