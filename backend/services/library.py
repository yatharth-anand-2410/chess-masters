"""The coach's study library: a committed curation overlay joined with Lichess.

Two layers, no database:

``backend/data/study_library.json``
    The *curation* layer, edited by hand (or by
    ``scripts/sync_study_library.py``). It says which motif or coach group each
    study teaches, which studies to hide, and the order to present them in.
    Titles are kept here only as a fallback for the no-token case.

``GET /api/study/by/{owner}`` (see :mod:`services.studies`)
    The *content* layer: every study the account owns, private and unlisted
    included, fetched live and cached in memory. A study that is not in the
    overlay yet still appears — as unfiled — so new work is never invisible.

Vocabulary rule: a study may only point at a slug from
``backend/data/lichess_themes.json`` (all of which exist at
``lichess.org/training/<slug>``) or at a coach group with no external link. A
study that matches neither is *unfiled* — never silently dropped, never
labelled with a link that might 404.
"""

from __future__ import annotations

import json
import os
import re
import threading
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set

from services import resources, studies

_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)
_OVERLAY_PATH = os.path.join(_DATA_DIR, "study_library.json")
_THEMES_PATH = os.path.join(_DATA_DIR, "lichess_themes.json")

#: The bucket for a study whose curation is still undecided.
UNFILED_GROUP = "unfiled"
_UNFILED_LABEL = "Unfiled"
_UNFILED_DESCRIPTION = (
    "Studies that have not been assigned a theme yet. They are listed so new "
    "work is never invisible — assign a theme in backend/data/study_library.json."
)

#: How many studies a free account can open. Paid tiers open the whole library.
FREE_STUDY_LIMIT = max(0, int(os.environ.get("LIBRARY_FREE_STUDY_LIMIT", "2")))

_load_lock = threading.Lock()
_overlay_cache: Optional[Dict[str, Any]] = None
_vocab_cache: Optional[Dict[str, Dict[str, str]]] = None


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


def clear_caches() -> None:
    """Forget the overlay and vocabulary files. Tests call this after patching."""
    global _overlay_cache, _vocab_cache
    with _load_lock:
        _overlay_cache = None
        _vocab_cache = None


def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def overlay() -> Dict[str, Any]:
    """The curation overlay, empty when the file is missing or unreadable."""
    global _overlay_cache
    with _load_lock:
        if _overlay_cache is None:
            data = _read_json(_OVERLAY_PATH)
            entries = data.get("studies")
            data["studies"] = entries if isinstance(entries, list) else []
            groups = data.get("groups")
            data["groups"] = groups if isinstance(groups, dict) else {}
            _overlay_cache = data
        return _overlay_cache


def vocabulary() -> Dict[str, Dict[str, str]]:
    """``slug -> {slug, label, description}`` for every speakable Lichess theme."""
    global _vocab_cache
    with _load_lock:
        if _vocab_cache is None:
            index: Dict[str, Dict[str, str]] = {}
            for entry in _read_json(_THEMES_PATH).get("themes") or []:
                if not isinstance(entry, Mapping):
                    continue
                slug = str(entry.get("slug") or "").strip()
                if not slug:
                    continue
                index[slug] = {
                    "slug": slug,
                    "label": str(entry.get("label") or slug).strip(),
                    "description": str(entry.get("description") or "").strip(),
                    # Umbrella themes ("endgame", "opening"): real slugs worth
                    # curating against, but far too vague to suggest from a name.
                    "generic": bool(entry.get("generic")),
                }
            _vocab_cache = index
        return _vocab_cache


def known_theme(slug: str) -> bool:
    return str(slug or "").strip() in vocabulary()


# ---------------------------------------------------------------------------
# Name → theme suggestion
# ---------------------------------------------------------------------------


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    # "mate"/"mating" and "make"/"making" must land on one key; the trailing
    # "e" carries no meaning once the suffix is gone.
    return word.rstrip("e") or word


_NUMBER_WORDS = {
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
}


def _tokens(text: str) -> List[str]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(text or ""))
    keys: List[str] = []
    for part in re.split(r"[^A-Za-z0-9]+", spaced):
        if not part:
            continue
        lowered = part.lower()
        keys.append(_NUMBER_WORDS.get(lowered, _stem(lowered)))
    return keys


def suggest_theme(name: str) -> Optional[str]:
    """The theme a study's own name claims, or ``None``.

    Matching is exact on stemmed words, so ``Pins`` finds ``pin`` and
    ``Mate in two`` finds ``mateIn2``, while ``Compass for Endgame`` does not
    find ``fork``. A label may also be matched by its leading words, which is
    how ``X-RAY`` finds ``X-Ray Attack``.

    This only ever *suggests*: the overlay's explicit choice wins, and an
    unmatched name stays unfiled rather than being given a link on a guess.
    """
    candidates: List[Tuple[int, List[str], str]] = []
    for slug, meta in vocabulary().items():
        if meta.get("generic"):
            continue
        for label in (meta.get("label") or "", slug):
            tokens = _tokens(label)
            if not tokens:
                continue
            # The whole label is always evidence; a *leading* part of a longer
            # label needs at least two words, so "x ray" finds X-Ray Attack
            # while a lone "knight" never finds Knight Endgame.
            candidates.append((len(tokens), tokens, slug))
            for length in range(2, len(tokens)):
                candidates.append((length, tokens[:length], slug))
    candidates.sort(key=lambda item: -item[0])

    name_tokens = _tokens(name)
    if not name_tokens:
        return None
    for length, tokens, slug in candidates:
        if length > len(name_tokens):
            continue
        for start in range(len(name_tokens) - length + 1):
            if name_tokens[start : start + length] == tokens:
                return slug
    return None


# ---------------------------------------------------------------------------
# Joining the two layers
# ---------------------------------------------------------------------------


def _overlay_entry(study_id: str) -> Dict[str, Any]:
    for entry in overlay().get("studies") or []:
        if isinstance(entry, Mapping) and str(entry.get("id") or "") == study_id:
            return dict(entry)
    return {}


def group_meta(key: str) -> Dict[str, Any]:
    """Label, kind and training link for a group key (theme or coach group)."""
    cleaned = str(key or "").strip() or UNFILED_GROUP
    if cleaned == UNFILED_GROUP:
        return {
            "key": UNFILED_GROUP,
            "label": _UNFILED_LABEL,
            "description": _UNFILED_DESCRIPTION,
            "kind": "unfiled",
            "training_url": None,
        }
    meta = vocabulary().get(cleaned)
    if meta:
        return {
            "key": cleaned,
            "label": meta["label"],
            "description": meta["description"],
            "kind": "lichess",
            "training_url": _training_url(cleaned),
        }
    declared = (overlay().get("groups") or {}).get(cleaned)
    if isinstance(declared, Mapping):
        return {
            "key": cleaned,
            "label": str(declared.get("label") or _humanize(cleaned)),
            "description": str(declared.get("description") or "").strip(),
            "kind": "coach",
            "training_url": None,
        }
    # A theme outside the vocabulary that the resource catalog still knows:
    # the phase fallbacks and the mixed-training bucket are real links, and
    # recommending them beats recommending nothing.
    link = resources.exercise_link(cleaned)
    resolved = str((link or {}).get("theme") or "")
    if link and resolved == cleaned and link.get("url"):
        return {
            "key": cleaned,
            "label": str(link.get("title") or _humanize(cleaned)),
            "description": "",
            "kind": "lichess",
            "training_url": str(link["url"]),
        }
    return {
        "key": cleaned,
        "label": _humanize(cleaned),
        "description": "",
        "kind": "coach",
        "training_url": None,
    }


def _training_url(slug: str) -> str:
    """The drill URL for a vocabulary slug.

    ``resources.exercise_link()`` falls back to mixed training for a theme it
    does not know, which would point at the wrong drill. Only trust it when it
    resolved the theme we asked for; otherwise build the link, because every
    slug in the vocabulary file is a real Lichess theme.
    """
    link = resources.exercise_link(slug)
    url = str((link or {}).get("url") or "")
    if link and str(link.get("theme") or "") == slug and url:
        return url
    return f"https://lichess.org/training/{slug}"


def _humanize(key: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(key or ""))
    words = [word for word in re.split(r"[\s_-]+", spaced) if word]
    return " ".join(word[:1].upper() + word[1:] for word in words) or key


def _study_entry(
    study_id: str,
    *,
    title: str,
    group: str,
    order: int,
    updated_at: Optional[int],
    known: bool,
) -> Dict[str, Any]:
    meta = group_meta(group)
    return {
        "id": study_id,
        "title": title,
        "group": group,
        "group_label": meta["label"],
        "group_kind": meta["kind"],
        "source_url": f"https://lichess.org/study/{study_id}",
        "updated_at": updated_at,
        "order": order,
        "indexed": known,
    }


def _order_of(entry: Mapping[str, Any], fallback: int) -> int:
    value = entry.get("order")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    return int(value)


def is_library_study(study_id: str) -> bool:
    """True when this deployment's library knows this study.

    The curation overlay is the gate of record, so a library study is gated
    even before Lichess is consulted. The live index only extends the gate, for
    a study the coach added and ``scripts/sync_study_library.py`` has not been
    run against yet; if that read fails the overlay still decides, which keeps
    public study imports working through a Lichess outage.

    Anything else — any public Lichess study — is not this library's business.
    """
    cleaned = str(study_id or "").strip()
    if not cleaned:
        return False
    for entry in overlay().get("studies") or []:
        if isinstance(entry, Mapping) and str(entry.get("id") or "").strip() == cleaned:
            return True
    owner = str(overlay().get("owner") or os.environ.get("LICHESS_STUDY_OWNER") or "").strip()
    if not (owner and studies.lichess_configured()):
        return False
    try:
        return any(row.get("id") == cleaned for row in studies.list_owner_studies(owner))
    except studies.StudyError:
        return False


def anonymous_library(tier: str = "free") -> Dict[str, Any]:
    """The library as an anonymous visitor may see it: nothing.

    The coach's studies are private, so an empty shape is returned rather than
    a scrubbed one — there is no safe subset of a private library to show, and
    an empty list can never leak a title by accident.
    """
    return {
        "configured": studies.lichess_configured(),
        "owner": None,
        "tier": tier,
        "free_limit": FREE_STUDY_LIMIT,
        "latest_study_update": None,
        "total_studies": 0,
        "locked_count": 0,
        "unlocked_ids": [],
        "hidden_count": 0,
        "missing_from_index": [],
        "groups": [],
        "studies": [],
    }


def build_library(
    *,
    owner: Optional[str] = None,
    tier: str = "free",
    observed: Optional[Mapping[str, int]] = None,
    free_limit: Optional[int] = None,
    include_hidden: bool = False,
    fresh_index: bool = True,
) -> Dict[str, Any]:
    """Join the overlay with the live index into the payload the UI renders.

    ``observed`` is the caller's own motif counts (``{theme: count}``), used to
    spend the free tier on the studies that answer their real leaks. ``tier``
    decides whether anything is locked at all: ``free`` locks everything beyond
    ``free_limit`` studies, ``student``/``coach`` lock nothing.

    ``fresh_index=False`` skips the live Lichess index entirely and builds from
    the committed overlay. A report read (a single game's study links, a
    progress plan) must never wait on a list request to Lichess, and the
    overlay already carries every title it needs.

    ``free_limit`` defaults to :data:`FREE_STUDY_LIMIT` at call time rather than
    import time, so the deployment setting is read when a request is served.
    """
    if free_limit is None:
        free_limit = FREE_STUDY_LIMIT
    overlay_data = overlay()
    configured = studies.lichess_configured()
    resolved_owner = (
        str(owner or overlay_data.get("owner") or "").strip()
        or str(os.environ.get("LICHESS_STUDY_OWNER") or "").strip()
    )

    live: List[Dict[str, Any]] = []
    if fresh_index and configured and resolved_owner:
        try:
            live = studies.list_owner_studies(resolved_owner)
        except studies.StudyError:
            live = []
    live_by_id = {str(row["id"]): row for row in live if row.get("id")}

    entries: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    hidden_ids: List[str] = []

    # 1. Everything the overlay curates, live metadata first.
    for fallback_order, entry in enumerate(overlay_data.get("studies") or []):
        if not isinstance(entry, Mapping):
            continue
        study_id = str(entry.get("id") or "").strip()
        if not study_id or study_id in seen:
            continue
        seen.add(study_id)
        if bool(entry.get("hidden")) and not include_hidden:
            hidden_ids.append(study_id)
            continue
        live_row = live_by_id.get(study_id) or {}
        title = str(live_row.get("name") or entry.get("title") or "").strip()
        if not title:
            title = f"Study {study_id}"
        group = str(entry.get("group") or entry.get("motif") or "").strip()
        if not group:
            group = suggest_theme(title) or UNFILED_GROUP
        entries.append(
            _study_entry(
                study_id,
                title=title,
                group=group,
                order=_order_of(entry, fallback_order),
                updated_at=live_row.get("updated_at"),
                known=study_id in live_by_id,
            )
        )

    # 2. Studies Lichess knows about that the overlay has not seen yet.
    for fallback_order, row in enumerate(live):
        study_id = str(row.get("id") or "").strip()
        if not study_id or study_id in seen:
            continue
        seen.add(study_id)
        title = str(row.get("name") or "").strip() or f"Study {study_id}"
        entries.append(
            _study_entry(
                study_id,
                title=title,
                group=suggest_theme(title) or UNFILED_GROUP,
                order=1000 + fallback_order,
                updated_at=row.get("updated_at"),
                known=True,
            )
        )

    entries.sort(key=lambda item: (item["order"], item["title"].lower(), item["id"]))

    missing_from_index = [item["id"] for item in entries if not item["indexed"]]

    unlocked = _unlocked_ids(entries, observed or {}, tier, free_limit)
    for item in entries:
        item["locked"] = bool(unlocked is not None and item["id"] not in unlocked)

    groups: List[Dict[str, Any]] = []
    for key in dict.fromkeys(item["group"] for item in entries):
        meta = group_meta(key)
        members = [item for item in entries if item["group"] == key]
        meta = {**meta, "count": len(members), "order": min(item["order"] for item in members)}
        if meta["kind"] == "lichess":
            meta["observed_count"] = int((observed or {}).get(key, 0))
        groups.append(meta)
    # The group the player is worst at leads, then the coach's curated order,
    # with the unfiled bucket last.
    groups.sort(
        key=lambda meta: (
            -int(meta.get("observed_count") or 0),
            1 if meta["kind"] == "unfiled" else 0,
            int(meta.get("order") or 0),
            meta["label"].lower(),
        )
    )

    locked_count = sum(1 for item in entries if item["locked"])
    latest_update = None
    if live:
        newest = max(int(row.get("updated_at") or 0) for row in live)
        latest_update = newest or None

    return {
        "configured": configured,
        "owner": resolved_owner or None,
        "tier": tier,
        "free_limit": free_limit,
        "latest_study_update": latest_update,
        "total_studies": len(entries),
        "locked_count": locked_count,
        "unlocked_ids": sorted(unlocked) if unlocked is not None else [],
        "hidden_count": len(hidden_ids),
        "missing_from_index": missing_from_index,
        "groups": groups,
        "studies": entries,
    }


def _unlocked_ids(
    entries: Sequence[Mapping[str, Any]],
    observed: Mapping[str, int],
    tier: str,
    free_limit: int,
) -> Optional[Set[str]]:
    """The studies this caller can open, or ``None`` for "everything"."""
    if str(tier or "").strip().lower() in {"student", "coach", "paid"}:
        return None
    if free_limit <= 0:
        return set()

    ranked = sorted(
        observed.items(), key=lambda item: (-int(item[1]), str(item[0]))
    )
    unlocked: Set[str] = set()
    # Spend the free tier on the leaks the player actually has.
    for theme, count in ranked:
        if len(unlocked) >= free_limit:
            break
        if int(count) <= 0:
            continue
        for item in entries:
            if len(unlocked) >= free_limit:
                break
            if item["group"] == theme and item["id"] not in unlocked:
                unlocked.add(item["id"])
                break
    # Nothing to personalise from yet: open the first studies in the library.
    for item in entries:
        if len(unlocked) >= free_limit:
            break
        if item["group"] == UNFILED_GROUP:
            continue
        unlocked.add(item["id"])
    return unlocked


def unlocked_study_ids(library: Mapping[str, Any]) -> Optional[Set[str]]:
    """The study ids this caller may open; ``None`` means the whole library."""
    if not library.get("locked_count"):
        return None
    return set(library.get("unlocked_ids") or [])


def curated_cover(library: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    """``group -> first study``, the lookup the curated list uses."""
    cover: Dict[str, Dict[str, Any]] = {}
    for item in library.get("studies") or []:
        group = str(item.get("group") or "")
        if group and group != UNFILED_GROUP and group not in cover:
            cover[group] = item
    return cover


def known_group(key: str) -> bool:
    """True when the library has words of its own for this key.

    A theme it does not know is not a Lichess theme and not a declared coach
    group — a report's pseudo-theme such as ``rushedMove`` (a clock habit, not
    a pattern) — so callers can fall back to the report's own wording instead
    of humanising an internal key.
    """
    cleaned = str(key or "").strip()
    if not cleaned:
        return False
    return cleaned in vocabulary() or cleaned in (overlay().get("groups") or {})


def _brief(study: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "id": study.get("id"),
        "title": study.get("title"),
        "source_url": study.get("source_url"),
        "locked": bool(study.get("locked")),
    }


def theme_coverage(
    built: Mapping[str, Any], theme: str, *, limit: int = 3
) -> Dict[str, Any]:
    """What the library has for one theme: its words, its drill and its studies.

    Works for a theme the library files studies under *and* for one it has
    nothing for — the engine names eighteen themes and the coach will never
    have a study for all of them, so "no study yet, here is the Lichess drill"
    is a first-class answer rather than a gap.
    """
    key = str(theme or "").strip().lower()
    meta = group_meta(key)
    studies = [
        item
        for item in built.get("studies") or []
        if str(item.get("group") or "") == key
    ]
    locked = sum(1 for item in studies if item.get("locked"))
    return {
        "theme": key,
        "label": meta["label"],
        "description": meta["description"],
        "kind": meta["kind"],
        "training_url": meta["training_url"],
        "study_count": len(studies),
        "locked_count": locked,
        "studies": [_brief(item) for item in studies[:limit]],
    }


def practice_plan(
    built: Mapping[str, Any],
    observed: Mapping[str, int],
    *,
    limit: int = 6,
) -> List[Dict[str, Any]]:
    """The caller's recurring leaks, each joined with the work that answers it.

    Ordered by how often the leak actually cost them points, so the first entry
    is the one worth their next hour. A theme with no study of its own is still
    listed, carrying its Lichess drill instead: the student learns what to
    practise either way, and the coach can see which themes their library does
    not cover yet.

    ``observed`` counts are the engine's own motif counts — the same numbers the
    tactics catalogue and the curated list already use, never an estimate.
    """
    plan: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    ranked = sorted(
        ((str(theme).strip().lower(), int(count)) for theme, count in observed.items()),
        key=lambda item: (-item[1], item[0]),
    )
    for theme, count in ranked:
        if count <= 0 or not theme or theme in seen:
            continue
        seen.add(theme)
        entry = theme_coverage(built, theme)
        entry["observed_count"] = count
        plan.append(entry)
        if len(plan) >= max(0, limit):
            break
    return plan


def attach_curated_studies(
    curated: Iterable[Dict[str, Any]], built: Mapping[str, Any]
) -> List[Dict[str, Any]]:
    """Dress each curated item with the library's answer to that motif.

    A leak always carries the theme's own words and drill link, so the card
    explains the pattern instead of only naming it. When the coach's library
    teaches it, the card points at *their* study and says how many studies the
    theme holds; when it does not, the Lichess training link stands, which is
    the honest answer rather than an empty promise.
    """
    cover = curated_cover(built)
    results: List[Dict[str, Any]] = []
    for item in curated:
        motif = str(item.get("motif") or "").strip()
        if not motif:
            results.append(item)
            continue
        coverage = theme_coverage(built, motif)
        enriched = {
            **item,
            "theme_label": coverage["label"],
            "theme_description": coverage["description"],
            "training_url": coverage["training_url"],
            "study_count": coverage["study_count"],
            "locked_count": coverage["locked_count"],
        }
        study = cover.get(motif)
        if study:
            enriched = {
                **enriched,
                "study_id": study["id"],
                "study_title": study["title"],
                "source_url": study["source_url"],
                "locked": bool(study.get("locked")),
            }
        results.append(enriched)
    return results
