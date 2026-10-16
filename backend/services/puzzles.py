"""The tactical training catalog.

``backend/data/puzzle_catalog.json`` holds the shipped theme → Lichess link
map. This module labels those themes, explains them in one line each and can
match them against the motifs a player's own analyses recorded, so the tactics
page and the curated-study list read from one place.

Nothing here is a statistic: labels and descriptions are curated content, and
``observed_count`` is only ever the count of real motifs found in the supplied
analysis rows.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

from services import motifs, resources

_CATALOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "puzzle_catalog.json",
)

_catalog: Dict[str, List[Dict[str, object]]] = {}

#: Human labels for the catalog's camelCase keys. Anything missing is
#: humanised from the key itself.
_THEME_LABELS: Dict[str, str] = {
    "fork": "Fork",
    "pin": "Pin",
    "skewer": "Skewer",
    "hangingPiece": "Hanging Piece",
    "discoveredAttack": "Discovered Attack",
    "deflection": "Deflection",
    "intermezzo": "Intermezzo",
    "clearance": "Clearance",
    "promotion": "Promotion",
    "backRank": "Back-Rank Weakness",
    "vulnerableKing": "Vulnerable King",
    "zugzwang": "Zugzwang",
}

#: One honest line per theme — what the pattern *is*, never how often it
#: appeared.
_THEME_DESCRIPTIONS: Dict[str, str] = {
    "fork": (
        "One piece attacks two or more enemy targets at once, so the "
        "opponent can only save one of them."
    ),
    "pin": (
        "A piece is stuck in front of a more valuable one and cannot move "
        "without exposing what stands behind it."
    ),
    "skewer": (
        "The mirror of a pin: the valuable piece is attacked first, and when "
        "it moves the piece behind it is lost."
    ),
    "hangingPiece": (
        "A piece is left undefended and can simply be taken."
    ),
    "discoveredAttack": (
        "Moving one piece uncovers an attack by the piece behind it on the "
        "same line."
    ),
    "deflection": (
        "A capture or threat drags a defender away from the duty it was "
        "performing."
    ),
    "intermezzo": (
        "An in-between move is played before recapturing, taking the "
        "initiative first."
    ),
    "clearance": (
        "A piece or pawn deliberately vacates a square so another piece can "
        "use it."
    ),
    "promotion": (
        "A pawn reaches the final rank; the promotion race decides many "
        "endgames."
    ),
    "backRank": (
        "The king is trapped behind its own pawns and falls to a back-rank "
        "mate."
    ),
    "vulnerableKing": (
        "An exposed king with few flight squares is the target of a direct "
        "attack."
    ),
    "zugzwang": (
        "The side to move would rather pass: every legal move makes the "
        "position worse."
    ),
}

_alias_index_cache: Dict[str, str] = {}


def _load_catalog() -> Dict[str, List[Dict[str, object]]]:
    global _catalog
    if not _catalog:
        with open(_CATALOG_PATH, encoding="utf-8") as handle:
            _catalog = json.load(handle)
    return _catalog


def humanize_theme(key: str) -> str:
    """``hangingPiece`` → ``Hanging Piece`` (the key is a Lichess slug)."""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(key or ""))
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    words = [word for word in re.split(r"[\s_-]+", text) if word]
    return " ".join(word[:1].upper() + word[1:] for word in words)


def theme_label(key: str) -> str:
    return _THEME_LABELS.get(key) or humanize_theme(key) or key


def theme_description(key: str) -> str:
    return _THEME_DESCRIPTIONS.get(key, "")


def motif_aliases(key: str) -> List[str]:
    """Every name this motif can appear under in stored analyses.

    Engine moments carry the human label from :data:`services.motifs.
    MOTIF_LABELS` while resource links carry the Lichess slug, and
    :data:`services.resources.ALIASES` renames a few of them; the alias list
    keeps all of those pointing at one catalog theme.
    """
    aliases: List[str] = []

    def add(value: object) -> None:
        text = str(value or "").strip()
        if text and text not in aliases:
            aliases.append(text)

    add(key)
    add(motifs.MOTIF_LABELS.get(key))
    add(resources.resolve_theme(key))
    for alias, target in resources.ALIASES.items():
        if alias == key:
            add(target)
        if target == key:
            add(alias)
    return aliases


def _normalize_motif(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def _alias_index() -> Dict[str, str]:
    """``"hangingpiece" / "pin" / "backrankmate" → catalog theme key``."""
    global _alias_index_cache
    if _alias_index_cache:
        return _alias_index_cache
    index: Dict[str, str] = {}
    for key in _load_catalog():
        for alias in motif_aliases(key):
            index.setdefault(_normalize_motif(alias), key)
        index.setdefault(_normalize_motif(key), key)
    _alias_index_cache = index
    return index


def theme_for_motif(value: object) -> Optional[str]:
    """The catalog theme a stored motif label or resource theme belongs to."""
    normalized = _normalize_motif(value)
    if not normalized:
        return None
    return _alias_index().get(normalized)


def links_for_theme(key: str) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    for entry in _load_catalog().get(key) or []:
        if not isinstance(entry, Mapping):
            continue
        url = str(entry.get("url") or "").strip()
        if not url:
            continue
        links.append({"theme": str(entry.get("theme") or key), "url": url})
    return links


def primary_link(key: str) -> Optional[Dict[str, str]]:
    """The first Lichess destination for a theme, catalog first."""
    links = links_for_theme(key)
    if links:
        return links[0]
    fallback = resources.exercise_link(key)
    if fallback:
        return {"theme": str(fallback.get("theme") or key), "url": fallback["url"]}
    return None


def theme_title(key: str) -> str:
    """A human title for a training item, e.g. "Practice Pins"."""
    link = resources.exercise_link(key)
    if link and link.get("title"):
        return str(link["title"])
    return f"{theme_label(key)} Training"


def _as_dict(value: object) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def count_observed_motifs(
    rows: Optional[Sequence[Mapping[str, Any]]],
) -> Dict[str, int]:
    """Count the catalog themes named by the weakness moments of ``rows``.

    The engine writes the human motif label (``"Pin"``) when a detector fired
    and only a resource theme otherwise, so both are resolved through the alias
    index. Rows without moments contribute nothing.
    """
    counts: Dict[str, int] = {}
    for row in rows or []:
        if not isinstance(row, Mapping):
            continue
        insights = _as_dict(row.get("insights"))
        moments = insights.get("weakness_moments")
        if not isinstance(moments, list):
            continue
        for moment in moments:
            if not isinstance(moment, Mapping):
                continue
            theme = theme_for_motif(
                moment.get("motif") or moment.get("resource_theme")
            )
            if theme:
                counts[theme] = counts.get(theme, 0) + 1
    return counts


def build_tactics_catalog(
    rows: Optional[Sequence[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build the ``TacticsCatalog`` payload.

    ``rows`` are the caller's recent analyses; pass them to attach a real
    ``observed_count`` per theme, or ``None`` for the plain public catalog.
    """
    catalog = _load_catalog()
    observed = count_observed_motifs(rows) if rows is not None else {}
    themes: List[Dict[str, Any]] = []
    total_links = 0
    for key in catalog:
        links = links_for_theme(key)
        total_links += len(links)
        theme: Dict[str, Any] = {
            "key": key,
            "label": theme_label(key),
            "description": theme_description(key),
            "motif_aliases": motif_aliases(key),
            "links": links,
        }
        if rows is not None:
            theme["observed_count"] = int(observed.get(key, 0))
        themes.append(theme)
    return {"themes": themes, "total_links": total_links}


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
