"""Curated coaching-principle library: loader and deterministic retrieval.

``data/principles.json`` is a small, hand-authored and human-reviewed library of
chess coaching principles. It is original wording written for this product; the
books listed in ``concept_source`` are only bibliographic references for where an
idea came from and are never quoted, shipped or served.

The library is data, not code. ``principles.json`` is optional: a missing, empty
or malformed file degrades to an empty library and the coaching report is written
exactly as it was before, so the file can be edited or pulled without a code
change.

Retrieval is deterministic lookups only — no embeddings and no fuzzy search:

* an entry whose ``signals`` is non-empty only applies when at least one supplied
  signal is in that list, so a signal query with nothing supplied matches nothing;
* an entry whose ``motifs`` is non-empty only applies when the supplied motif is
  in that list — a missing motif never selects a motif-specific principle;
* an entry whose ``phases`` is non-empty only applies when the supplied phase is
  in that list; an omitted phase leaves that constraint unevaluated;
* an entry with an empty ``motifs`` or ``phases`` list matches anything.

Entries that apply are ranked by specificity: more matched signals first, then a
matched motif, then a matched phase, then how many keys the entry declares.
"""

from __future__ import annotations

import json
import logging
import string
from collections.abc import Mapping as MappingABC
from pathlib import Path
from typing import Dict, List, Mapping, Optional, Sequence, Set, Tuple

from services import motifs

logger = logging.getLogger("uvicorn.error")

PRINCIPLES_PATH: Path = (
    Path(__file__).resolve().parent.parent / "data" / "principles.json"
)

REVIEW_PENDING = "PENDING"

_LIST_FIELDS = ("signals", "phases", "motifs")
_TEXT_FIELDS = ("title", "observed_template", "mechanism", "rule", "concept_source")

SIGNAL_WEIGHT = 4
MOTIF_WEIGHT = 3
PHASE_WEIGHT = 2
DECLARED_SIGNAL_WEIGHT = 1

_CACHE: Optional[List[Dict[str, object]]] = None

_MOTIF_KEYS = {key.lower(): key for key in motifs.MOTIF_LABELS}
_MOTIF_LABELS = {label.lower(): key for key, label in motifs.MOTIF_LABELS.items()}


def normalize_motif(value: Optional[str]) -> Optional[str]:
    """Map a motif theme key or a display label to the theme key.

    ``motifs.MOTIF_LABELS`` carries both the keys used by the detection code
    (``hangingPiece``) and the labels shown in the UI ("Hanging piece"). The
    library stores keys, so labels coming from the engine payload are folded
    onto them; unknown values are passed through untouched.
    """
    if not value:
        return None
    token = str(value).strip()
    if not token:
        return None
    for table in (_MOTIF_KEYS, _MOTIF_LABELS):
        found = table.get(token.lower())
        if found:
            return found
    return token


def load_principles(path: Optional[Path] = None) -> List[Dict[str, object]]:
    """Return the curated principles, or ``[]`` when the library is unusable.

    The result is cached per process for the default path. A missing, unreadable,
    non-JSON or non-list file logs a warning and yields an empty library instead
    of raising, so a bad library can never take the server down. Individual
    malformed entries are skipped for the same reason.
    """
    global _CACHE

    if path is None and _CACHE is not None:
        return _CACHE

    target = Path(path) if path is not None else PRINCIPLES_PATH
    principles = _read_principles(target)
    if path is None:
        _CACHE = principles
    return principles


def clear_cache() -> None:
    """Drop the cached library so the next load re-reads the file."""
    global _CACHE
    _CACHE = None


def _read_principles(target: Path) -> List[Dict[str, object]]:
    try:
        raw = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(
            "Principle library not found at %s; coaching runs without it", target
        )
        return []
    except OSError as exc:
        logger.warning("Principle library %s could not be read: %s", target, exc)
        return []

    if not raw.strip():
        logger.warning(
            "Principle library %s is empty; coaching runs without it", target
        )
        return []

    try:
        data = json.loads(raw)
    except ValueError as exc:
        logger.warning("Principle library %s is not valid JSON: %s", target, exc)
        return []

    if not isinstance(data, list):
        logger.warning("Principle library %s must be a list of entries", target)
        return []

    principles: List[Dict[str, object]] = []
    seen: set = set()
    for index, item in enumerate(data):
        entry = _normalize_entry(item)
        if entry is None:
            logger.warning(
                "Skipping malformed principle at index %s in %s", index, target
            )
            continue
        principle_id = str(entry["id"])
        if principle_id in seen:
            logger.warning(
                "Skipping duplicate principle id %r in %s", principle_id, target
            )
            continue
        seen.add(principle_id)
        principles.append(entry)
    return principles


def _normalize_entry(item: object) -> Optional[Dict[str, object]]:
    if not isinstance(item, dict):
        return None
    principle_id = item.get("id")
    if not isinstance(principle_id, str) or not principle_id.strip():
        return None

    entry: Dict[str, object] = {"id": principle_id.strip()}
    for field in _TEXT_FIELDS:
        value = item.get(field)
        entry[field] = value.strip() if isinstance(value, str) else ""
    for field in _LIST_FIELDS:
        entry[field] = _string_list(item.get(field))
    entry["motifs"] = [
        normalized
        for normalized in (normalize_motif(value) for value in entry["motifs"])
        if normalized
    ]
    entry["phases"] = [value.lower() for value in entry["phases"]]

    reviewed_by = item.get("reviewed_by")
    signed_off = isinstance(reviewed_by, str) and bool(reviewed_by.strip())
    entry["reviewed_by"] = reviewed_by.strip() if signed_off else REVIEW_PENDING
    reviewed_on = item.get("reviewed_on")
    entry["reviewed_on"] = (
        reviewed_on if isinstance(reviewed_on, str) and reviewed_on.strip() else None
    )
    return entry


def _string_list(value: object) -> List[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def principles_for(
    *,
    signals: Sequence[str],
    motif: Optional[str] = None,
    phase: Optional[str] = None,
    limit: int = 2,
    include_unreviewed: bool = False,
) -> List[Dict[str, object]]:
    """Select the principles that apply to one position, most specific first.

    ``signals`` are the psychology signal names present for the position,
    ``motif`` is a motif theme key or label and ``phase`` is one of
    ``opening``/``middlegame``/``endgame``. Entries are returned as copies with a
    boolean ``reviewed`` flag. Nothing is raised for bad input: an entry that
    cannot be ranked is simply left out.

    Review gate: an entry whose ``reviewed_by`` is still ``REVIEW_PENDING`` is
    excluded, so unreviewed coaching cannot reach a report. Tests and the dev
    harness set ``include_unreviewed=True`` to exercise unsigned entries.
    """
    supplied_signals = {
        str(value).strip() for value in signals or [] if str(value).strip()
    }
    wanted_motif = normalize_motif(motif)
    wanted_phase = str(phase).strip().lower() if phase else None

    ranked: List[Dict[str, object]] = []
    scores: Dict[str, int] = {}
    for entry in load_principles():
        if not include_unreviewed and not is_reviewed(entry):
            continue
        if not _applies(entry, supplied_signals, wanted_motif, wanted_phase):
            continue
        principle_id = str(entry["id"])
        ranked.append(entry)
        scores[principle_id] = _specificity(
            entry, supplied_signals, wanted_motif, wanted_phase
        )

    ranked.sort(key=lambda entry: (-scores[str(entry["id"])], str(entry["id"])))
    return [with_review_flag(entry) for entry in ranked[: max(0, int(limit))]]


def _applies(
    entry: Mapping[str, object],
    signals: Set[str],
    motif: Optional[str],
    phase: Optional[str],
) -> bool:
    entry_signals = set(entry["signals"])
    if entry_signals and not (entry_signals & signals):
        return False
    entry_motifs = set(entry["motifs"])
    if entry_motifs and (motif is None or motif not in entry_motifs):
        return False
    entry_phases = set(entry["phases"])
    if entry_phases and phase is not None and phase not in entry_phases:
        return False
    return True


def _specificity(
    entry: Mapping[str, object],
    signals: Set[str],
    motif: Optional[str],
    phase: Optional[str],
) -> int:
    entry_signals = set(entry["signals"])
    score = SIGNAL_WEIGHT * len(entry_signals & signals)
    if motif and motif in entry["motifs"]:
        score += MOTIF_WEIGHT
    if phase and phase in entry["phases"]:
        score += PHASE_WEIGHT
    score += DECLARED_SIGNAL_WEIGHT * min(len(entry_signals), 3)
    return score


def is_reviewed(entry: Mapping[str, object]) -> bool:
    """True when a human has signed this entry off.

    ``REVIEW_PENDING`` is the sentinel for "not yet reviewed"; anything else in
    ``reviewed_by`` counts as a sign-off. Used both to flag entries and to gate
    them, so a principle can never reach a report without passing review.
    """
    return str(entry.get("reviewed_by") or REVIEW_PENDING).strip() != REVIEW_PENDING


def with_review_flag(entry: Mapping[str, object]) -> Dict[str, object]:
    """Copy an entry and expose whether a human has signed it off."""
    return {**entry, "reviewed": is_reviewed(entry)}


def render_observed(
    principle: Mapping[str, object], evidence: Mapping[str, object]
) -> str:
    """Fill an ``observed_template`` from real evidence, or return ``""``.

    Placeholders are the evidence keys emitted by the moment payload, including
    dotted paths into nested evidence such as ``{next_move.seconds_spent}``. A
    template that references anything the evidence does not carry (or carries as
    ``None``) renders to an empty string, so a half-filled sentence with an
    invented figure can never reach the model.
    """
    template = principle.get("observed_template")
    if not isinstance(template, str) or not template.strip():
        return ""
    try:
        return _EvidenceFormatter().vformat(template, (), dict(evidence))
    except (KeyError, IndexError, ValueError, TypeError):
        return ""


class _EvidenceFormatter(string.Formatter):
    """Formatter whose fields are evidence lookups, not attribute lookups.

    Plain ``str.format`` treats ``{next_move.seconds_spent}`` as an attribute
    access, which nested evidence dictionaries do not support. Here the whole
    dotted path is walked as mapping keys, and anything missing raises so the
    caller can return an empty sentence instead of a half-filled one.
    """

    def get_field(
        self,
        field_name: str,
        args: Tuple[object, ...],
        kwargs: Mapping[str, object],
    ) -> Tuple[str, str]:  # type: ignore[override]
        current: object = kwargs
        for part in str(field_name).split("."):
            if not isinstance(current, MappingABC) or part not in current:
                raise KeyError(field_name)
            current = current[part]
        if current is None:
            raise KeyError(field_name)
        return _format_evidence_value(current), str(field_name)


def _format_evidence_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)
