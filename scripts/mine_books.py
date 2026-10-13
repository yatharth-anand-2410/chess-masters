"""Local authoring aid: mine the reference chess books into a searchable passage index.

WHAT THIS IS
------------
``mine_books.py`` is an offline, developer-only CLI that extracts, cleans,
chunks and BM25-indexes the reference chess books kept in ``./books/``. It
exists so that a human author (the product owner and his IM) can *read and
quote-search 511 pages quickly* while hand-authoring the curated principle
library that the coaching report is grounded in.

WHAT THIS DELIBERATELY IS NOT
-----------------------------
* It is **not a runtime dependency**. Nothing in ``backend/`` or ``frontend/``
  imports this module, and it must stay that way.
* It is **not runtime RAG**. We do not feed book text to the model at request
  time. "Psychology in Chess" (Krogius, 1976) is still in copyright, so
  reproducing its text inside a paid product is a legal risk we are avoiding.
  The books are *source material* for hand-written principles, never payload.
* Its output never ships and never reaches a user. Everything is written under
  ``./books/.extracted/``, which is covered by the ``books/`` rule in
  ``.gitignore``, so extracted text cannot be committed or deployed. The
  ``_assert_inside_books`` guard below enforces the location at runtime.

DEPENDENCIES
------------
Standard library + ``pypdf`` (BSD-3-Clause) only. PyMuPDF/``fitz`` is
explicitly avoided because it is AGPL-3.0 and would contaminate this
proprietary codebase. No embeddings, no numpy/faiss/rank_bm25 - BM25 is
implemented here in pure Python. No network calls; runs fully offline.

TEXT CLEANING (the main value of the tool)
------------------------------------------
These are OCR'd / print-driver scans of old chess books. Naive extraction
yields running headers, standalone page numbers, dot-leader table-of-contents
rows, diagram fragments, hyphen-broken words and long lists of moves - all of
which pollute keyword search. Cleaning is therefore done in three explicit
passes:

1. **Document-level furniture detection.** Short lines (<= 70 chars) that
   recur on many distinct pages are assumed to be running headers/footers.
   "LASKER'S MANUAL OF CHESS 25" and "26 LASKER'S MANUAL OF" are the same
   furniture with the page number in a different place, so each line is keyed
   by a normalized form (lowercased, digits collapsed to ``#``) and a key is
   treated as furniture when it appears on at least
   ``max(4, 2% of pages)`` distinct pages. A genuine prose line repeating on
   eight different pages of a 385-page book is vanishingly unlikely, whereas
   every running header does exactly that.

2. **Line-level heuristics.** Any *single* page number, roman numeral,
   dot-leader row, near-letterless fragment (fewer than three ASCII letters -
   diagram furniture, stray glyphs) is discarded. Finally a line is discarded
   as chess notation when the *ratio of notation tokens to word tokens is
   >= 0.5* (see ``_notation_ratio`` and ``NOTATION_RATIO_THRESHOLD`` for the
   full justification of the threshold).

3. **Page-level reference-matter guard.** Tables of contents and the
   subject/game indices lose their dot leaders to OCR and so survive pass 2.
   They are removed whole when the density of bare-number tokens on a page
   crosses ``PAGE_DIGIT_DENSITY_THRESHOLD`` (measured: body pages peak at
   0.14, contents/index pages start at 0.22).

Surviving lines on a page are re-joined into flowing prose, de-hyphenating
words that were broken across lines (both books are hard-wrapped in narrow
two-column layouts), before being split into sentences and grouped into
passages.

IMAGE-ONLY SCANS: THE OCR FALLBACK
----------------------------------
``Psychess (1).pdf`` (Krogius) is an image-only scan: every page is a stack of
CCITT-fax strips with no text layer, so ``pypdf`` returns an empty string for
all 126 pages. Krogius is the single most valuable source for this product - a
GM and psychologist writing about panic, time pressure and the emotional
reaction to mistakes - so leaving it blind was not acceptable.

When a PDF yields (near) zero text, ``build`` therefore falls back to OCR via
``scripts/ocr_pdf.swift``, a small helper that renders each PDF page with
PDFKit and recognises the text with Apple's Vision framework
(``VNRecognizeTextRequest``, ``.accurate``, language correction on). This is
free, offline, licence-clean and adds **no** Python dependency: macOS ships the
framework and the Swift toolchain. The helper is compiled once with
``swiftc -O`` into ``books/.extracted/.ocr/`` (gitignored, still inside
``./books/``) and reused; the per-page OCR text is cached under
``books/.extracted/.ocr_cache/`` so the expensive pass is a genuine one-time
cost. OCR text then flows through the *same* cleaning, chunking and BM25
indexing code as the text-layer book, so Krogius becomes searchable with the
same ``search`` verb and the same notation filtering.

``--no-ocr`` disables the fallback (you get the old zero-chunk warning).
``--pages A-B`` OCRs only that 1-based PDF page slice, for a quick triage run.

Two-column / two-page-spread handling. The Krogius scan is a two-page spread
per PDF page, and on some pages Vision reads across the gutter and interleaves
the two pages. ``ocr_pdf.swift`` classifies each page: it looks for a gutter -
a central x-split that column-width text blocks do not straddle - and, when it
finds one, emits column 1 top-to-bottom and then column 2, separated by a form
feed so the de-hyphenation pass cannot stitch a hyphen across the gutter.
Residual limitation: the detection is geometric and best-effort, and only a
page whose blocks form two clean vertical bands is reordered. ``build``
reports how many pages were classified two-column versus single, so a silent
regression in this logic shows up as a number rather than as garbled prose.
Measured on this scan: 123 of 126 pages classify as two-column; the three that
do not are the title page and the two forewords, whose layouts are genuinely
mixed. The OCR text is still only as good as the scan, and this scan carries
some physically overlapping "ghost" lines (roughly 2% of body lines), which no
amount of column ordering can untangle.

WHAT THIS STILL IS NOT
----------------------
OCR does not make this a runtime ingestion path, and it remains true that
Krogius is in copyright: the OCR text is authoring scratch, used to hand-write
principles. It stays inside ``./books/.extracted/`` (gitignored) and never
ships and never reaches a user.

USAGE
-----
``build`` needs ``pypdf``; ``search`` needs nothing but the standard library (the
index is plain JSON). So on this machine, use the project venv for ``build``:

    .venv/bin/python scripts/mine_books.py build                 # both books; OCR fallback for Krogius
    .venv/bin/python scripts/mine_books.py build --pages 40-44   # triage: OCR only PDF pages 40-44
    .venv/bin/python scripts/mine_books.py build --no-ocr        # text layer only, no OCR fallback
    python3 scripts/mine_books.py search "losing material panic" --limit 5 --book krogius

Equivalently for ``build``: ``PYTHONPATH=$PWD/.venv/lib/python3.14/site-packages
python3 scripts/mine_books.py build`` or an activated venv. The bare system
``python3`` has no ``pypdf``, so only ``search`` works with it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# ``pypdf`` is imported lazily inside _read_pdf_pages so that the ``search``
# verb keeps working on a machine where the extraction dependency is absent -
# the index is plain JSON and needs nothing but the standard library to read.

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "books"
OUTPUT_DIR = BOOKS_DIR / ".extracted"
INDEX_FILENAME = "index.json"

# BM25 free parameters. The classic (and, per the literature, near-universally
# robust) defaults: k1 controls term-frequency saturation, b controls
# length normalization. Tuned values are not worth the complexity at this
# corpus size.
BM25_K1 = 1.5
BM25_B = 0.75

# Passages are grouped to sit inside this character window, on sentence
# boundaries. 600-900 chars is roughly one focused paragraph - long enough to
# carry an argument, short enough that a reader can scan a hit without opening
# the PDF.
CHUNK_MIN_CHARS = 600
CHUNK_MAX_CHARS = 900

# Ratio of chess-notation tokens to word tokens at or above which a line is
# treated as a move list rather than prose.
#
# Reasoning: a prose sentence that merely *quotes* moves keeps them in the
# minority. In "After 1. e4 e5 2. Nf3 the game continues with a quiet buildup",
# only 3 of 11 word tokens are moves (0.27). A line of printed moves is the
# opposite: "1. O-R6ch. K-Kt1 2. O-Kt6ch. K-R1" is ~100% notation. Move
# numbers ("1.") are excluded from the ratio entirely because they also occur
# naturally in prose ("he had 2 rooks"), which would otherwise bias short lines
# upward.
#
# Observed on the Lasker edition: this rule discards 2857 lines, and the lines
# it discards are dominated by printed move lists and annotation move rows. The
# passages that survive are 99% below a 10% notation-token density.
NOTATION_RATIO_THRESHOLD = 0.5

# A line shorter than this many ASCII letters is diagram furniture / a stray
# glyph, not text.
MIN_LINE_LETTERS = 3

# Short-line threshold for document-level furniture detection, plus the
# minimum number of distinct pages a normalized short line must appear on.
FURNITURE_MAX_CHARS = 70
FURNITURE_MIN_PAGES = 4
FURNITURE_PAGE_FRACTION = 0.02

# Reference-matter (table of contents, analytical contents, subject/game
# indices) survives the line-level heuristics because OCR drops the dot
# leaders that would give those rows away. It is detected at *page* level by
# the density of bare-number tokens ("PAGE Abbreviations ... 14 Achievement
# ... 262"), which is exactly what those pages are made of.
#
# Threshold justification, measured on the Lasker edition: the highest
# digit-token density on any page of running prose or annotated games is 0.14
# (p.107), while the TOC/index pages start at 0.22 (p.382) and run to 0.75
# (p.17, Lasker's tournament record table). 0.18 sits in that empty valley, so
# the guard removes the whole front/back matter and zero body pages. A page
# must also carry at least REFERENCE_PAGE_MIN_CHARS of cleaned text so that
# sparse diagram pages are not classified on a handful of tokens.
PAGE_DIGIT_DENSITY_THRESHOLD = 0.18
REFERENCE_PAGE_MIN_CHARS = 200

# A sentence longer than this is split on clause boundaries (the only
# documented exception to "never split mid-sentence").
MAX_SENTENCE_CHARS = 1200

# --------------------------------------------------------------------------- #
# OCR fallback configuration (image-only scans)
# --------------------------------------------------------------------------- #

# The Swift helper lives in the repo; the compiled binary and the OCR text
# cache are build artifacts, so they live under books/.extracted/ (gitignored,
# and inside BOOKS_DIR so the _assert_inside_books guard still holds).
OCR_SWIFT_SOURCE = REPO_ROOT / "scripts" / "ocr_pdf.swift"
OCR_TOOL_DIR = OUTPUT_DIR / ".ocr"
OCR_BINARY = OCR_TOOL_DIR / "ocr_pdf"
OCR_CACHE_DIR = OUTPUT_DIR / ".ocr_cache"

# Bumping this invalidates every cached page (e.g. after changing the render
# scale or the Swift ordering logic).
OCR_CACHE_VERSION = "2"

# Render scale for the page raster. 3x was the hand-verified value that yields
# clean prose from the Krogius scan; lowering it is faster but loses small type.
OCR_RENDER_SCALE = 3.0

# A book is treated as image-only when pypdf finds text on fewer than this
# fraction of its pages. Krogius scores 0/126; Lasker scores far above it.
OCR_FALLBACK_MAX_TEXT_PAGE_FRACTION = 0.05

# Pages per Swift invocation. Batching (rather than one process per page) keeps
# the PDF parse cost amortised while still giving per-batch progress output.
OCR_BATCH_PAGES = 15

# Form feed emitted by the Swift helper between columns. It also acts as a
# de-hyphenation barrier: each column is re-flowed separately.
OCR_COLUMN_MARKER = "\x0c"

# Per-page layout annotation emitted by the Swift helper ("single" or
# "two-column"). It is carried in the page cache so the column-detection rate
# is reportable on every build, including cache-warm ones.
OCR_LAYOUT_PREFIX = "##layout "

# Book ids exposed to ``--book``. The off-topic academic paper in ./books is
# intentionally absent: it is out of scope for the principle library.
BOOK_SPECS: Tuple["BookSpec", ...] = ()


@dataclass(frozen=True)
class BookSpec:
    """A source book that participates in the authoring index."""

    book_id: str
    filename: str
    title: str
    in_copyright: bool
    text_layer_expected: bool = True
    # Printed folio = PDF page index - offset, for the main body of the book.
    # Observed in the Lasker edition at several distances (PDF p.61 prints
    # "25", PDF p.101 prints "65"), so the author can find the passage on the
    # shelf. It is an approximation: a book's front matter uses roman numerals,
    # so the offset does not apply there.
    printed_page_offset: int = 0
    # Printed pages captured by one PDF page. The Krogius scan is a two-page
    # spread per PDF page (verified: PDF p.40 prints folios 70 and 71, PDF p.60
    # prints 110 and 111, PDF p.120 prints 230 and 231 - stable across the
    # body). With pages_per_pdf_page = 2 the first folio is
    # ``2 * pdf_page - printed_page_offset`` and the spread covers two folios.
    pages_per_pdf_page: int = 1


# Defined after the dataclass so ``BOOK_SPECS`` can hold real instances.
BOOK_SPECS = (
    BookSpec(
        book_id="krogius",
        filename="Psychess (1).pdf",
        title="Psychology in Chess (Krogius, 1976)",
        in_copyright=True,
        # Verified: every page is CCITT-fax imagery with no text layer.
        text_layer_expected=False,
        # Two printed pages per PDF page (two-page spread). Verified on the
        # printed folios of PDF pages 40, 60, 100 and 120.
        pages_per_pdf_page=2,
        printed_page_offset=10,
    ),
    BookSpec(
        book_id="lasker",
        filename="Lasker's Manual of Chess.pdf",
        title="Lasker's Manual of Chess (Lasker, 1925, public domain)",
        in_copyright=False,
        printed_page_offset=36,
    ),
)

BOOK_IDS = tuple(spec.book_id for spec in BOOK_SPECS)


# --------------------------------------------------------------------------- #
# Text normalization primitives
# --------------------------------------------------------------------------- #

# Old chess books use en/em dashes for descriptive notation ("K-Kt1", "R-R3").
_DASH_RE = re.compile(r"[\u2010-\u2015\u2212\u00ad]")
_WHITESPACE_RE = re.compile(r"\s+")
_SOFT_HYPHEN = "\u00ad"

# Descriptive (English) notation, the dialect both books actually print:
# K-Kt1, R-R3, Q-Q, P-K4, RxQ, KxK, BxKt, O-O, K2. Matched after dash
# normalization, lowercasing and trailing-punctuation stripping.
#
# This edition is also set with spaces around the separators ("B x Kt",
# "P-KKt4", "Qx Bch."), so move tokens arrive split into pieces. The
# SIMPLE_NOTATION_RE pattern below therefore treats a bare piece letter ("B",
# "Kt", "P"), an optional capture/capture-suffix ("Bx", "Px") and an optional
# check suffix ("Bch", "Qch") as notation on their own. This is a deliberate
# trade-off: in a chess book a standalone "B"/"P"/"Kt" token is notation with
# overwhelming probability, and without this rule roughly a quarter of all
# move-list lines in the Lasker edition slip into the index. The suffix set is
# restricted to (x, ch, mate, 1-8) precisely so ordinary short English words
# ("by", "be", "no", "on") cannot match.
_OCR_PIECE = r"(?:kkt|kt|[kqrbnp])"
SIMPLE_NOTATION_RE = re.compile(rf"^{_OCR_PIECE}(?:x|ch|mate|[1-8])?$")
_PIECE = r"(?:kt|[kqrbnp])"
DESCRIPTIVE_NOTATION_RE = re.compile(
    r"^(?:"
    r"o-o(?:-o)?"  # castling
    rf"|{_PIECE}-{_PIECE}[1-8]?"  # K-Kt1, R-R3, Q-Q, O-R6 (Q misread as O)
    rf"|{_PIECE}x{_PIECE}[1-8]?"  # RxQ, KxK, PxP, BxKt
    rf"|{_PIECE}[1-8]"  # K2, R1
    r")(?:ch|mate)?$"
)

# Algebraic (SAN) notation: Nf3, exd5, O-O, Qb8+, Rxd1, e4, Nbd7, e8=Q.
SAN_NOTATION_RE = re.compile(
    r"^(?:"
    r"o-o(?:-o)?"
    r"|[kqrbn][a-h]?[1-8]?x?[a-h][1-8]"
    r"|[a-h]x?[a-h][1-8](?:=[qrbn])?"
    r"|[a-h][1-8]"
    r")(?:[+#])?$"
)

# Game result markers ("1-0", "0-1", "1/2-1/2") printed between moves.
RESULT_TOKEN_RE = re.compile(r"^(?:1-0|0-1|1/2-1/2|\*)$")

STANDALONE_NUMBER_RE = re.compile(r"^\d{1,4}$")
ROMAN_NUMERAL_RE = re.compile(r"^[ivxlcdm]{1,7}$")
LETTER_RE = re.compile(r"[A-Za-z]")

# Sentence boundary: whitespace following terminal punctuation, with the next
# sentence starting on a capitalized word, digit, or opening quote.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])")

# Abbreviations that must not be treated as sentence ends.
_ABBREVIATIONS = frozenset(
    {"dr", "mr", "mrs", "ms", "st", "no", "cf", "eg", "ie", "viz", "etc", "vs", "ch"}
)


class IndexMissingError(Exception):
    """The search index has not been built yet."""


# --------------------------------------------------------------------------- #
# Tokenization + notation detection
# --------------------------------------------------------------------------- #


def _strip_token_punctuation(token: str) -> str:
    """Trim wrapping punctuation that OCR attaches to a move token."""
    return token.strip(".,;:!?\"'()[]{}")


def _normalize_notation_token(token: str) -> str:
    """Lowercase and dash-normalize a token for notation matching."""
    return _DASH_RE.sub("-", token.lower())


def is_notation_token(token: str) -> bool:
    """Return True when a single token looks like a chess move.

    Only tokens containing at least one ASCII letter can be notation: bare
    numbers are excluded on purpose (see ``NOTATION_RATIO_THRESHOLD``).
    """
    if not LETTER_RE.search(token):
        return False
    stripped = _strip_token_punctuation(token)
    if not stripped:
        return False
    normalized = _normalize_notation_token(stripped)
    return bool(
        SAN_NOTATION_RE.match(normalized)
        or DESCRIPTIVE_NOTATION_RE.match(normalized)
        or SIMPLE_NOTATION_RE.match(normalized)
        or RESULT_TOKEN_RE.match(normalized)
    )


def _word_tokens(line: str) -> List[str]:
    """Tokens that count toward the notation ratio (letter-bearing only)."""
    return [token for token in line.split() if LETTER_RE.search(token)]


def _notation_ratio(line: str) -> float:
    """Fraction of a line's word tokens that are chess notation.

    Returns 0.0 for a line with no word tokens; such lines are rejected by the
    letter-count rule before the ratio is consulted.
    """
    tokens = _word_tokens(line)
    if not tokens:
        return 0.0
    notation = sum(1 for token in tokens if is_notation_token(token))
    return notation / len(tokens)


# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #


def _furniture_key(line: str) -> str:
    """Normalized key used to group running headers/footers across pages."""
    lowered = _DASH_RE.sub("-", line.lower())
    lowered = re.sub(r"\d+", "#", lowered)
    lowered = re.sub(r"[^a-z# ]+", " ", lowered)
    return _WHITESPACE_RE.sub(" ", lowered).strip()


def _is_short_furniture_candidate(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > FURNITURE_MAX_CHARS:
        return False
    return len(stripped.split()) <= 10


def detect_running_furniture(pages: Sequence[Sequence[str]], page_count: int) -> frozenset[str]:
    """Find normalized short lines that recur across many distinct pages.

    Two passes are needed because whether a line is furniture depends on the
    whole document, not the page it sits on. See the module docstring for why
    the threshold is ``max(4, 2% of pages)``.
    """
    seen_on: Dict[str, set[int]] = {}
    for page_number, lines in enumerate(pages, start=1):
        for line in lines:
            if not _is_short_furniture_candidate(line):
                continue
            key = _furniture_key(line)
            if len(key) < 4:
                continue
            seen_on.setdefault(key, set()).add(page_number)

    minimum = max(FURNITURE_MIN_PAGES, math.ceil(page_count * FURNITURE_PAGE_FRACTION))
    return frozenset(key for key, pages_seen in seen_on.items() if len(pages_seen) >= minimum)


def _is_dot_leader(line: str) -> bool:
    """Table-of-contents / index rows held together by dot leaders."""
    stripped = line.strip()
    if stripped.count(".") < 4:
        return False
    filler = sum(1 for char in stripped if char in ". \t0123456789")
    return filler / len(stripped) >= 0.6


# Tokens that carry no prose meaning on a reference page: bare numbers and the
# "&" / "." / "-" glue that index rows are built from.
_NUMERIC_TOKEN_RE = re.compile(r"^[\d&.,\-]+$")


def _digit_token_density(text: str) -> float:
    """Fraction of tokens on a page that are bare numbers, not words."""
    tokens = text.split()
    if not tokens:
        return 0.0
    numeric = sum(1 for token in tokens if _NUMERIC_TOKEN_RE.match(token))
    return numeric / len(tokens)


def is_reference_matter_page(page_text: str) -> bool:
    """True for a contents/index page, which is useless for authoring.

    See ``PAGE_DIGIT_DENSITY_THRESHOLD`` for the measured justification.
    """
    if len(page_text) < REFERENCE_PAGE_MIN_CHARS:
        return False
    return _digit_token_density(page_text) >= PAGE_DIGIT_DENSITY_THRESHOLD


def classify_line(
    line: str,
    furniture: frozenset[str],
) -> Tuple[bool, str]:
    """Decide whether a line is usable prose.

    Returns ``(keep, reason)`` where ``reason`` is a discard bucket label used
    for the build summary ("notation", "furniture", "pagenum", "dotleader",
    "fragment") or ``""`` when the line is kept.
    """
    stripped = _DASH_RE.sub("-", line.strip())
    if not stripped:
        return False, "blank"
    if STANDALONE_NUMBER_RE.match(stripped) or ROMAN_NUMERAL_RE.match(stripped.lower()):
        return False, "pagenum"
    if _is_short_furniture_candidate(stripped) and _furniture_key(stripped) in furniture:
        return False, "furniture"
    if _is_dot_leader(stripped):
        return False, "dotleader"
    if len(LETTER_RE.findall(stripped)) < MIN_LINE_LETTERS:
        return False, "fragment"
    # The single documented decision rule: a line is a move list, not prose,
    # when at least half of its word tokens are chess notation.
    if _notation_ratio(stripped) >= NOTATION_RATIO_THRESHOLD:
        return False, "notation"
    return True, ""


def join_page_lines(lines: Iterable[str]) -> str:
    """Re-flow cleaned lines into prose, undoing hard-wrap hyphenation.

    Both books are two-column and hard-wrapped, so a naive line-per-line read
    destroys words ("protec-" / "tion"). Lines are joined with a space; a
    trailing hyphen (or en/em dash) plus a lowercase continuation is stitched
    back into one word.
    """
    pieces: List[str] = []
    for raw in lines:
        line = _DASH_RE.sub("-", raw.strip())
        if not line:
            continue
        if pieces and pieces[-1].endswith("-") and line[:1].islower():
            pieces[-1] = pieces[-1][:-1] + line
        else:
            pieces.append(line)
    return _WHITESPACE_RE.sub(" ", " ".join(pieces)).replace(_SOFT_HYPHEN, "").strip()


def split_sentences(text: str) -> List[str]:
    """Split prose into sentences without breaking on common abbreviations."""
    candidates = _SENTENCE_SPLIT_RE.split(text)
    sentences: List[str] = []
    for candidate in candidates:
        sentence = candidate.strip()
        if not sentence:
            continue
        if sentences:
            previous = sentences[-1]
            tail = _strip_token_punctuation(previous.rsplit(" ", 1)[-1].lower())
            if tail in _ABBREVIATIONS:
                sentences[-1] = f"{previous} {sentence}"
                continue
        sentences.append(sentence)
    return sentences


def _split_oversized_sentence(sentence: str) -> List[str]:
    """Last-resort split for a sentence longer than ``MAX_SENTENCE_CHARS``."""
    if len(sentence) <= MAX_SENTENCE_CHARS:
        return [sentence]
    parts = re.split(r"(?<=[,;:])\s+", sentence)
    merged: List[str] = []
    for part in parts:
        if merged and len(merged[-1]) + len(part) < MAX_SENTENCE_CHARS:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return merged


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #


@dataclass
class Chunk:
    """One retrievable passage with a locator back to the printed page."""

    chunk_id: str
    book_id: str
    page_start: int
    page_end: int
    text: str

    def to_json(self) -> Dict[str, object]:
        return {
            "id": self.chunk_id,
            "book": self.book_id,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "text": self.text,
        }

    @property
    def locator(self) -> str:
        if self.page_start == self.page_end:
            return f"p.{self.page_start}"
        return f"pp.{self.page_start}-{self.page_end}"


def group_sentences(
    book_id: str,
    sentences: Sequence[Tuple[int, str]],
) -> List[Chunk]:
    """Greedily group ``(page, sentence)`` pairs into 600-900 char passages.

    Grouping is only ever done *between* sentences, so a passage never splits
    mid-sentence - the single exception being a sentence longer than
    ``MAX_SENTENCE_CHARS``, which is split on clause boundaries and documented
    in the module docstring.
    """
    chunks: List[Chunk] = []
    buffer: List[str] = []
    buffer_chars = 0
    start_page = 0
    end_page = 0

    def flush() -> None:
        nonlocal buffer, buffer_chars, start_page
        if not buffer:
            return
        text = " ".join(buffer).strip()
        if text:
            chunk_id = f"{book_id}-{len(chunks) + 1:04d}"
            chunks.append(
                Chunk(
                    chunk_id=chunk_id,
                    book_id=book_id,
                    page_start=start_page,
                    page_end=end_page,
                    text=text,
                )
            )
        buffer = []
        buffer_chars = 0
        start_page = 0

    expanded: List[Tuple[int, str]] = []
    for page, sentence in sentences:
        for part in _split_oversized_sentence(sentence):
            expanded.append((page, part))

    for page, sentence in expanded:
        if buffer and buffer_chars + len(sentence) + 1 > CHUNK_MAX_CHARS:
            flush()
        if not buffer:
            start_page = page
        buffer.append(sentence)
        end_page = page
        buffer_chars += len(sentence) + 1
        if buffer_chars >= CHUNK_MIN_CHARS:
            flush()
    flush()

    # Fold a short trailing passage into its predecessor so the last chunk is
    # not a stray sentence.
    if len(chunks) >= 2 and len(chunks[-1].text) < CHUNK_MIN_CHARS // 2:
        tail = chunks.pop()
        previous = chunks[-1]
        chunks[-1] = Chunk(
            chunk_id=previous.chunk_id,
            book_id=previous.book_id,
            page_start=previous.page_start,
            page_end=tail.page_end,
            text=f"{previous.text} {tail.text}".strip(),
        )
    return chunks


# --------------------------------------------------------------------------- #
# PDF extraction
# --------------------------------------------------------------------------- #


@dataclass
class BookExtraction:
    """Raw extraction result for one book, plus quality signals."""

    spec: BookSpec
    pages_total: int
    pages_with_text: int
    pages_failed: int
    page_texts: List[Tuple[int, str]] = field(default_factory=list)
    discard_counts: Dict[str, int] = field(default_factory=dict)
    chunks: List[Chunk] = field(default_factory=list)
    warning: Optional[str] = None
    pages_from_text_layer: int = 0
    ocr_pages: int = 0
    ocr_seconds: float = 0.0
    ocr_two_column_pages: int = 0

    @property
    def ocr_used(self) -> bool:
        return self.ocr_pages > 0

    @property
    def ocr_pages_per_minute(self) -> float:
        if self.ocr_seconds <= 0:
            return 0.0
        return self.ocr_pages * 60.0 / self.ocr_seconds

    @property
    def ocr_two_column_fraction(self) -> float:
        if self.ocr_pages <= 0:
            return 0.0
        return self.ocr_two_column_pages / self.ocr_pages


def _read_pdf_pages(pdf_path: Path) -> Tuple[int, List[Tuple[int, List[str]]], int]:
    """Extract raw lines per page. Returns (page_count, pages, failed_pages)."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "The 'build' verb needs pypdf (BSD-3-Clause). Install it with "
            "'python3 -m pip install pypdf' (PyMuPDF is deliberately avoided: AGPL-3.0)."
        ) from exc

    reader = PdfReader(str(pdf_path))
    pages: List[Tuple[int, List[str]]] = []
    failed = 0
    for number, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:  # pragma: no cover - defensive: malformed scan pages
            text = ""
            failed += 1
        pages.append((number, text.splitlines()))
    return len(reader.pages), pages, failed


def extract_book(
    spec: BookSpec,
    *,
    allow_ocr: bool = True,
    page_range: Optional[Tuple[int, int]] = None,
) -> BookExtraction:
    """Extract, clean and chunk one book end to end.

    ``page_range`` (1-based, inclusive) restricts the **OCR fallback** to that
    slice so a human can triage a scan cheaply. It is ignored for books that
    already have a usable text layer, so it can never silently build a partial
    index for a good book.
    """
    pdf_path = BOOKS_DIR / spec.filename
    if not pdf_path.exists():
        raise FileNotFoundError(f"Missing source PDF: {pdf_path}")

    page_count, raw_pages, failed = _read_pdf_pages(pdf_path)
    line_lists = [lines for _, lines in raw_pages]
    text_layer_pages = sum(1 for lines in line_lists if any(line.strip() for line in lines))

    ocr_pages = 0
    ocr_seconds = 0.0
    ocr_two_column = 0
    warning: Optional[str] = None

    if _is_image_only_scan(text_layer_pages, page_count):
        if not allow_ocr:
            warning = (
                "image-only PDF (no text layer): pypdf extracted no text and the OCR "
                "fallback was disabled with --no-ocr, so this book contributes 0 chunks."
            )
        else:
            ocr = _ocr_book_pages(spec, pdf_path, page_count, page_range)
            raw_pages = ocr.raw_pages
            ocr_pages = ocr.pages_ocr
            ocr_seconds = ocr.seconds
            ocr_two_column = ocr.two_column_pages
            if page_range is not None and ocr_pages:
                span = f"{page_range[0]}-{page_range[1]}"
                warning = (
                    f"PARTIAL OCR: only PDF pages {span} were OCR'd (--pages), so this "
                    "index covers a slice of the book, not the whole scan."
                )

    line_lists = [lines for _, lines in raw_pages]
    pages_with_text = sum(1 for lines in line_lists if any(line.strip() for line in lines))
    furniture = detect_running_furniture(line_lists, page_count)

    discards: Dict[str, int] = {}
    sentences: List[Tuple[int, str]] = []
    page_texts: List[Tuple[int, str]] = []
    for page_number, lines in raw_pages:
        # OCR output splits a page into columns on the form feed; a text-layer
        # page is a single segment. Each segment is re-flowed on its own so a
        # hyphen at the foot of column 1 is not stitched onto column 2.
        kept_segments: List[List[str]] = []
        for segment in _split_columns(lines):
            kept: List[str] = []
            for line in segment:
                keep, reason = classify_line(line, furniture)
                if keep:
                    kept.append(line)
                elif reason and reason != "blank":
                    discards[reason] = discards.get(reason, 0) + 1
            if kept:
                kept_segments.append(kept)
        page_text = " ".join(join_page_lines(segment) for segment in kept_segments).strip()
        if not page_text:
            continue
        if is_reference_matter_page(page_text):
            discards["reference_page"] = discards.get("reference_page", 0) + 1
            continue
        page_texts.append((page_number, page_text))
        for sentence in split_sentences(page_text):
            if len(sentence) >= 20:
                sentences.append((page_number, sentence))

    result = BookExtraction(
        spec=spec,
        pages_total=page_count,
        pages_with_text=pages_with_text,
        pages_failed=failed,
        page_texts=page_texts,
        discard_counts=discards,
        warning=warning,
        pages_from_text_layer=text_layer_pages,
        ocr_pages=ocr_pages,
        ocr_seconds=ocr_seconds,
        ocr_two_column_pages=ocr_two_column,
    )
    result.chunks = group_sentences(spec.book_id, sentences)

    if pages_with_text == 0 and result.warning is None:
        result.warning = (
            "image-only PDF (no text layer) and OCR produced nothing; this book "
            "contributes 0 chunks."
        )
    if spec.in_copyright:
        note = "IN COPYRIGHT - hand-author principles from this source; never ship its text."
        result.warning = f"{result.warning} {note}".strip() if result.warning else note
    return result


# --------------------------------------------------------------------------- #
# OCR fallback for image-only scans (macOS Vision via a compiled Swift helper)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class OcrRunner:
    """How to invoke ``scripts/ocr_pdf.swift``.

    ``prefix`` is a compiled binary when ``swiftc`` is available, otherwise the
    Swift interpreter (slower, recompiles each run). The binary path lives
    under ``./books/`` so the write guard still holds.
    """

    prefix: Tuple[str, ...]
    compiled: bool


def _is_image_only_scan(text_layer_pages: int, page_count: int) -> bool:
    """True when pypdf found text on (near) none of the pages."""
    if page_count <= 0:
        return False
    threshold = max(1, math.ceil(page_count * OCR_FALLBACK_MAX_TEXT_PAGE_FRACTION))
    return text_layer_pages < threshold


def _find_executable(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    candidate = Path("/usr/bin") / name
    return str(candidate) if candidate.exists() else None


def _resolve_ocr_runner() -> OcrRunner:
    """Compile the Swift helper once (cached) or fall back to the interpreter."""
    if not OCR_SWIFT_SOURCE.exists():
        raise RuntimeError(f"Missing OCR helper source: {OCR_SWIFT_SOURCE}")

    swiftc = _find_executable("swiftc")
    if swiftc:
        source_mtime = OCR_SWIFT_SOURCE.stat().st_mtime
        if not OCR_BINARY.exists() or OCR_BINARY.stat().st_mtime < source_mtime:
            _assert_inside_books(OCR_TOOL_DIR)
            OCR_TOOL_DIR.mkdir(parents=True, exist_ok=True)
            proc = subprocess.run(
                [swiftc, "-O", "-suppress-warnings", str(OCR_SWIFT_SOURCE), "-o", str(OCR_BINARY)],
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0 or not OCR_BINARY.exists():
                raise RuntimeError(
                    "Failed to compile scripts/ocr_pdf.swift with swiftc:\n"
                    f"{proc.stderr.strip()[-2000:]}"
                )
        return OcrRunner(prefix=(str(OCR_BINARY),), compiled=True)

    swift = _find_executable("swift")
    if swift:
        return OcrRunner(prefix=(swift, str(OCR_SWIFT_SOURCE)), compiled=False)

    raise RuntimeError(
        "No Swift toolchain found. The OCR fallback needs macOS with the Xcode "
        "command line tools ('swiftc'). Install them with 'xcode-select --install', "
        "or re-run with --no-ocr to skip the fallback."
    )


def _split_columns(lines: Sequence[str]) -> List[List[str]]:
    """Split raw OCR lines into columns on the form-feed sentinel.

    A text-layer page has no sentinel and yields a single segment, so this is a
    no-op for books that do not need OCR.
    """
    segments: List[List[str]] = [[]]
    for line in lines:
        # NOTE: compare the raw line. str.strip() removes the form feed itself
        # (it is considered whitespace), so a stripped comparison never matches.
        if line == OCR_COLUMN_MARKER:
            segments.append([])
            continue
        segments[-1].append(line)
    non_empty = [segment for segment in segments if any(item.strip() for item in segment)]
    return non_empty or [[]]


_OCR_PAGE_MARKER_RE = re.compile(r"^=== page (\d+) ===$")


def _parse_ocr_output(stdout: str) -> Dict[int, List[str]]:
    """Map the helper's ``=== page N ===`` output back to page numbers.

    Split on ``"\\n"`` rather than ``str.splitlines()`` on purpose: Python
    treats the form feed used as the column sentinel as a line boundary, so
    ``splitlines()`` would silently discard it.
    """
    pages: Dict[int, List[str]] = {}
    current: Optional[int] = None
    for raw_line in stdout.split("\n"):
        line = raw_line[:-1] if raw_line.endswith("\r") else raw_line
        marker = _OCR_PAGE_MARKER_RE.match(line.strip())
        if marker:
            current = int(marker.group(1))
            pages.setdefault(current, [])
            continue
        if current is not None:
            pages[current].append(line)
    return pages


def _ocr_cache_dir(pdf_path: Path) -> Path:
    """Cache directory keyed by the scan and the OCR toolchain version.

    The Swift source is keyed by content, not mtime, so copying the repo or
    switching git branches does not needlessly invalidate 126 pages of OCR.
    """
    stat = pdf_path.stat()
    swift_digest = hashlib.sha256(OCR_SWIFT_SOURCE.read_bytes()).hexdigest()[:12]
    digest = hashlib.sha256(
        "|".join(
            [
                str(pdf_path.name),
                str(stat.st_size),
                str(int(stat.st_mtime)),
                swift_digest,
                str(OCR_RENDER_SCALE),
                OCR_CACHE_VERSION,
            ]
        ).encode("utf-8")
    ).hexdigest()[:12]
    return OCR_CACHE_DIR / f"{pdf_path.stem}-{digest}"


def _consecutive_runs(pages: Sequence[int], max_run: int) -> List[List[int]]:
    """Group sorted page numbers into runs of at most ``max_run`` pages."""
    runs: List[List[int]] = []
    for page in sorted(pages):
        if runs and page == runs[-1][-1] + 1 and len(runs[-1]) < max_run:
            runs[-1].append(page)
        else:
            runs.append([page])
    return runs


@dataclass
class OcrResult:
    """Outcome of the OCR fallback for one book."""

    raw_pages: List[Tuple[int, List[str]]]
    pages_ocr: int
    seconds: float
    two_column_pages: int


def _extract_layout(lines: List[str]) -> Tuple[List[str], Optional[str]]:
    """Separate the ``##layout`` annotation from a page's text lines."""
    layout: Optional[str] = None
    kept: List[str] = []
    for line in lines:
        if line.startswith(OCR_LAYOUT_PREFIX):
            layout = line[len(OCR_LAYOUT_PREFIX) :].strip()
        else:
            kept.append(line)
    return kept, layout


def _ocr_book_pages(
    spec: BookSpec,
    pdf_path: Path,
    page_count: int,
    page_range: Optional[Tuple[int, int]],
) -> OcrResult:
    """OCR the pages of an image-only scan, reusing the on-disk page cache.

    Returns the full per-page line lists (so page numbering matches the PDF),
    the number of pages that actually came from OCR, the OCR wall time and how
    many pages the column detector classified as two-column.
    """
    runner = _resolve_ocr_runner()
    mode = "compiled binary" if runner.compiled else "swift interpreter"
    print(f"  OCR fallback         : {mode} ({OCR_SWIFT_SOURCE.name}, scale {OCR_RENDER_SCALE})")

    cache_dir = _ocr_cache_dir(pdf_path)
    _assert_inside_books(cache_dir)

    if page_range is not None:
        first = max(1, page_range[0])
        last = min(page_count, page_range[1])
        targets = list(range(first, last + 1))
    else:
        targets = list(range(1, page_count + 1))

    cached: Dict[int, List[str]] = {}
    layouts: Dict[int, Optional[str]] = {}
    missing: List[int] = []
    for page in targets:
        cache_file = cache_dir / f"page-{page:04d}.txt"
        if cache_file.exists():
            # Split on "\n" (not splitlines) so the column sentinel survives.
            raw_lines = cache_file.read_text(encoding="utf-8").split("\n")
            cached[page], layouts[page] = _extract_layout(raw_lines)
        else:
            missing.append(page)

    if cached:
        print(f"  OCR cache            : {len(cached)} page(s) reused from {cache_dir.name}")
    else:
        print(f"  OCR cache            : cold (first run on this scan)")

    seconds = 0.0
    for run in _consecutive_runs(missing, OCR_BATCH_PAGES):
        start_index = run[0] - 1
        command = [
            *runner.prefix,
            str(pdf_path),
            str(start_index),
            str(len(run)),
            f"{OCR_RENDER_SCALE}",
            "auto",
        ]
        began = time.monotonic()
        try:
            proc = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=max(300, 40 * len(run)),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"OCR timed out on pages {run[0]}-{run[-1]}. Re-run, or triage with "
                f"--pages {run[0]}-{min(run[0] + 9, run[-1])}."
            ) from exc
        elapsed = time.monotonic() - began
        seconds += elapsed
        if proc.returncode != 0:
            raise RuntimeError(
                f"OCR failed on pages {run[0]}-{run[-1]} (exit {proc.returncode}):\n"
                f"{proc.stderr.strip()[-1000:]}"
            )
        parsed = _parse_ocr_output(proc.stdout)
        for page in run:
            lines, layout = _extract_layout(parsed.get(page, []))
            layouts[page] = layout
            cached[page] = lines
            cache_file = cache_dir / f"page-{page:04d}.txt"
            body = "\n".join(lines)
            if layout:
                body = f"{OCR_LAYOUT_PREFIX}{layout}\n{body}"
            _write_text(cache_file, body)
        print(
            f"  OCR pages {run[0]:>4}-{run[-1]:<4}      : {len(run):>3} page(s) in "
            f"{elapsed:5.1f}s ({len(run) * 60.0 / elapsed:4.1f} pages/min)"
        )

    raw_pages = [(page, cached.get(page, [])) for page in range(1, page_count + 1)]
    two_column = sum(1 for page in targets if layouts.get(page) == "two-column")
    return OcrResult(
        raw_pages=raw_pages,
        pages_ocr=len(targets),
        seconds=seconds,
        two_column_pages=two_column,
    )


# --------------------------------------------------------------------------- #
# BM25 (pure standard library)
# --------------------------------------------------------------------------- #

_TOKEN_RE = re.compile(r"[a-z][a-z']+")
_STOPWORDS = frozenset(
    """
    a an and are as at be been but by for from had has have he her his i if in into
    is it its of on or our so that the their them then there these they this to was
    we were what when which who will with would you your not no than too very can
    only such also more most some any all do does did being over under about
    """.split()
)


def tokenize(text: str) -> List[str]:
    """Lowercase word tokens with a small stopword list - no stemming."""
    return [token for token in _TOKEN_RE.findall(text.lower()) if token not in _STOPWORDS]


@dataclass
class SearchHit:
    chunk: Chunk
    score: float


class BM25Index:
    """Okapi BM25 over the chunk collection, implemented from scratch.

    A dependency-free implementation is deliberate: numpy/faiss/rank_bm25 and
    any embedding model are out of scope for an authoring aid that has to run
    offline and never ship.
    """

    def __init__(self, chunks: Sequence[Chunk]) -> None:
        self.chunks: List[Chunk] = list(chunks)
        self.documents: List[List[str]] = [tokenize(chunk.text) for chunk in self.chunks]
        self.doc_lengths: List[int] = [len(tokens) for tokens in self.documents]
        self.avg_length: float = (
            sum(self.doc_lengths) / len(self.doc_lengths) if self.doc_lengths else 0.0
        )
        self.term_frequencies: List[Dict[str, int]] = []
        document_frequency: Dict[str, int] = {}
        for tokens in self.documents:
            counts: Dict[str, int] = {}
            for token in tokens:
                counts[token] = counts.get(token, 0) + 1
            self.term_frequencies.append(counts)
            for token in counts:
                document_frequency[token] = document_frequency.get(token, 0) + 1
        total = len(self.chunks)
        self.idf: Dict[str, float] = {
            term: math.log(1.0 + (total - frequency + 0.5) / (frequency + 0.5))
            for term, frequency in document_frequency.items()
        }

    def _score(self, index: int, query_tokens: Sequence[str]) -> float:
        counts = self.term_frequencies[index]
        length = self.doc_lengths[index] or 1
        score = 0.0
        for token in query_tokens:
            frequency = counts.get(token, 0)
            if not frequency:
                continue
            idf = self.idf.get(token, 0.0)
            denominator = frequency + BM25_K1 * (1.0 - BM25_B + BM25_B * length / (self.avg_length or 1.0))
            score += idf * (frequency * (BM25_K1 + 1.0)) / denominator
        return score

    def search(
        self,
        query: str,
        limit: int = 5,
        book_id: Optional[str] = None,
    ) -> List[SearchHit]:
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        scored: List[SearchHit] = []
        for index, chunk in enumerate(self.chunks):
            if book_id and chunk.book_id != book_id:
                continue
            score = self._score(index, query_tokens)
            if score > 0.0:
                scored.append(SearchHit(chunk=chunk, score=score))
        scored.sort(key=lambda hit: (-hit.score, hit.chunk.book_id, hit.chunk.page_start))
        return scored[:limit]


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #


def _assert_inside_books(path: Path) -> None:
    """Hard guarantee that nothing is ever written outside ./books/."""
    resolved = path.resolve()
    if not resolved.is_relative_to(BOOKS_DIR.resolve()):
        raise RuntimeError(f"Refusing to write outside {BOOKS_DIR}: {resolved}")


def _write_text(path: Path, content: str) -> None:
    _assert_inside_books(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def index_path() -> Path:
    return OUTPUT_DIR / INDEX_FILENAME


def load_index() -> Dict[str, object]:
    path = index_path()
    if not path.exists():
        raise IndexMissingError(
            f"No index found at {path}.\n"
            "Run 'python3 scripts/mine_books.py build' first to extract and index the books."
        )
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _chunks_from_index(payload: Dict[str, object]) -> List[Chunk]:
    raw_chunks = payload.get("chunks", [])
    chunks: List[Chunk] = []
    if not isinstance(raw_chunks, list):
        return chunks
    for item in raw_chunks:
        if not isinstance(item, dict):
            continue
        chunks.append(
            Chunk(
                chunk_id=str(item.get("id", "")),
                book_id=str(item.get("book", "")),
                page_start=int(item.get("page_start", 0)),
                page_end=int(item.get("page_end", 0)),
                text=str(item.get("text", "")),
            )
        )
    return chunks


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _book_title(book_id: str) -> str:
    for spec in BOOK_SPECS:
        if spec.book_id == book_id:
            return spec.title
    return book_id


def _printed_page_hint(book_id: str, locator: str) -> str:
    """Translate a PDF page locator into the book's printed folio, roughly."""
    for spec in BOOK_SPECS:
        if spec.book_id == book_id and spec.printed_page_offset:
            match = re.search(r"(\d+)", locator)
            if match:
                pdf_page = int(match.group(1))
                first = pdf_page * spec.pages_per_pdf_page - spec.printed_page_offset
                if first > 0:
                    if spec.pages_per_pdf_page > 1:
                        last = first + spec.pages_per_pdf_page - 1
                        return f" (≈ printed pp.{first}-{last})"
                    return f" (≈ printed p.{first})"
    return ""


def run_build(allow_ocr: bool = True, page_range: Optional[Tuple[int, int]] = None) -> int:
    """Extract + clean + chunk + index every source book; write the artifacts."""
    print(f"Source books : {BOOKS_DIR}")
    print(f"Output dir   : {OUTPUT_DIR}")
    print(f"OCR fallback : {'enabled' if allow_ocr else 'disabled (--no-ocr)'}")
    if page_range is not None:
        print(f"OCR slice    : PDF pages {page_range[0]}-{page_range[1]} only (--pages)")
    print()

    _assert_inside_books(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_chunks: List[Chunk] = []
    book_summaries: List[Dict[str, object]] = []

    for spec in BOOK_SPECS:
        print(f"[{spec.book_id}] extracting {spec.filename} ...")
        try:
            extraction = extract_book(spec, allow_ocr=allow_ocr, page_range=page_range)
        except (RuntimeError, FileNotFoundError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        all_chunks.extend(extraction.chunks)

        reference_pages = extraction.discard_counts.get("reference_page", 0)
        line_discards = {
            reason: count
            for reason, count in extraction.discard_counts.items()
            if reason != "reference_page"
        }
        discarded_total = sum(line_discards.values())
        print(f"  pages read           : {extraction.pages_total}")
        print(f"  pages with text      : {extraction.pages_with_text}")
        if extraction.ocr_used:
            if extraction.ocr_seconds > 0:
                throughput = f"{extraction.ocr_pages_per_minute:.1f} pages/min, settled"
            else:
                throughput = "all reused from cache, no OCR run needed"
            print(f"  pages from OCR       : {extraction.ocr_pages} ({throughput})")
            print(
                f"  column detection     : {extraction.ocr_two_column_pages}/"
                f"{extraction.ocr_pages} OCR pages read as two-column "
                f"({extraction.ocr_two_column_fraction * 100:.0f}%); the rest were "
                f"emitted in Vision's own order"
            )
        if extraction.pages_failed:
            print(f"  pages failed to parse: {extraction.pages_failed}")
        print(f"  chunks kept          : {len(extraction.chunks)}")
        print(f"  lines discarded      : {discarded_total} ({_format_discards(line_discards)})")
        print(f"  contents/index pages : {reference_pages} skipped as reference matter")
        if extraction.warning:
            print(f"  WARNING              : {extraction.warning}")
        if spec.printed_page_offset:
            if spec.pages_per_pdf_page > 1:
                print(
                    f"  locator/hint         : locators are PDF pages; each PDF page holds "
                    f"{spec.pages_per_pdf_page} printed pages (spread), printed folio ≈ "
                    f"{spec.pages_per_pdf_page} × PDF page - {spec.printed_page_offset}"
                )
            else:
                print(
                    f"  locator offset       : locators are PDF pages; printed page ≈ PDF page "
                    f"- {spec.printed_page_offset}"
                )

        txt_path = OUTPUT_DIR / f"{spec.book_id}.txt"
        _write_text(txt_path, _render_book_text(extraction))
        print(f"  text output          : {txt_path}")
        print()

        book_summaries.append(
            {
                "id": spec.book_id,
                "title": spec.title,
                "source": str(Path("books") / spec.filename),
                "in_copyright": spec.in_copyright,
                "pages_total": extraction.pages_total,
                "pages_with_text": extraction.pages_with_text,
                "pages_from_text_layer": extraction.pages_from_text_layer,
                "pages_from_ocr": extraction.ocr_pages,
                "ocr_seconds": round(extraction.ocr_seconds, 1),
                "ocr_pages_per_minute": round(extraction.ocr_pages_per_minute, 1),
                "ocr_two_column_pages": extraction.ocr_two_column_pages,
                "lines_discarded": extraction.discard_counts,
                "chunks_kept": len(extraction.chunks),
                "warning": extraction.warning,
            }
        )

    payload = {
        "version": 1,
        "generated_by": "scripts/mine_books.py",
        "note": (
            "Authoring-only artifact. GITIGNORED. In-copyright source text: never ship, "
            "never serve at runtime. See scripts/mine_books.py docstring."
        ),
        "bm25": {"k1": BM25_K1, "b": BM25_B, "threshold_notation_ratio": NOTATION_RATIO_THRESHOLD},
        "chunking": {"min_chars": CHUNK_MIN_CHARS, "max_chars": CHUNK_MAX_CHARS},
        "books": book_summaries,
        "chunk_count": len(all_chunks),
        "chunks": [chunk.to_json() for chunk in all_chunks],
    }
    _write_text(index_path(), json.dumps(payload, ensure_ascii=False, indent=2))

    print(f"index built  : {index_path()}")
    print(f"total chunks : {len(all_chunks)}")
    if not all_chunks:
        print("No chunks were produced. Check the warnings above.")
        return 1
    return 0


def _format_discards(counts: Dict[str, int]) -> str:
    if not counts:
        return "none"
    ordered = sorted(counts.items(), key=lambda item: -item[1])
    return ", ".join(f"{reason}={count}" for reason, count in ordered)


def _render_book_text(extraction: BookExtraction) -> str:
    provenance = (
        f"# pages from OCR: {extraction.ocr_pages} "
        f"(Apple Vision via scripts/ocr_pdf.swift)\n"
        if extraction.ocr_used
        else ""
    )
    header = (
        f"# {extraction.spec.title}\n"
        f"# source: books/{extraction.spec.filename}\n"
        f"# NOTE: authoring-only extraction. GITIGNORED, never shipped, never served.\n"
        f"{provenance}"
        f"# cleaning: notation_ratio>={NOTATION_RATIO_THRESHOLD}, running-header detection, "
        f"de-hyphenation, dot-leader and page-number removal, reference-matter page removal\n\n"
    )
    body: List[str] = []
    for page_number, page_text in extraction.page_texts:
        body.append(f"\n===== PAGE {page_number} =====\n{page_text}\n")
    return header + "".join(body)


def run_search(query: str, limit: int, book_id: Optional[str]) -> int:
    """Load the index if present, rank passages, print them with locators."""
    try:
        payload = load_index()
    except IndexMissingError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    chunks = _chunks_from_index(payload)
    if not chunks:
        print("ERROR: the index is empty. Re-run 'python3 scripts/mine_books.py build'.", file=sys.stderr)
        return 2

    index = BM25Index(chunks)
    hits = index.search(query, limit=limit, book_id=book_id)

    scope = f"book={book_id}" if book_id else "all books"
    print(f'query: "{query}"  ({scope}, {len(chunks)} chunks indexed)')
    if book_id and not any(chunk.book_id == book_id for chunk in chunks):
        print(f"NOTE: no chunks exist for book '{book_id}' (see build warnings).")
    print()

    if not hits:
        print("No passages matched. Try different wording.")
        return 0

    for rank, hit in enumerate(hits, start=1):
        chunk = hit.chunk
        print(f"[{rank}] {chunk.book_id} {chunk.locator}  score={hit.score:.2f}  id={chunk.chunk_id}")
        print(f"    {_book_title(chunk.book_id)}{_printed_page_hint(chunk.book_id, chunk.locator)}")
        print(_wrap(chunk.text))
        print()
    return 0


def _wrap(text: str, width: int = 100, indent: str = "    ") -> str:
    words = text.split()
    lines: List[str] = []
    current = ""
    for word in words:
        if current and len(current) + len(word) + 1 > width:
            lines.append(indent + current)
            current = word
        else:
            current = f"{current} {word}".strip()
    if current:
        lines.append(indent + current)
    return "\n".join(lines)


def parse_page_range(text: str) -> Tuple[int, int]:
    """Parse a 1-based PDF page slice: ``"40"`` or ``"40-44"``."""
    match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", text)
    if not match:
        raise argparse.ArgumentTypeError(f"expected 'A' or 'A-B' (1-based pages), got {text!r}")
    first = int(match.group(1))
    last = int(match.group(2)) if match.group(2) else first
    if first < 1 or last < first:
        raise argparse.ArgumentTypeError(f"invalid page range {text!r}: need 1 <= A <= B")
    return first, last


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mine_books.py",
        description="Offline authoring aid: extract, clean, chunk and BM25-index the reference chess books.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser_ = subparsers.add_parser("build", help="extract + clean + chunk + index the books")
    build_parser_.add_argument(
        "--no-ocr",
        action="store_true",
        help="disable the OCR fallback for image-only scans (Krogius then yields 0 chunks)",
    )
    build_parser_.add_argument(
        "--pages",
        type=parse_page_range,
        metavar="A-B",
        help="OCR only this 1-based PDF page slice (triage); books with a text layer are unaffected",
    )

    search_parser = subparsers.add_parser("search", help="rank passages against the built index")
    search_parser.add_argument("query", help="free-text query, e.g. \"losing material panic\"")
    search_parser.add_argument("--limit", type=int, default=5, help="number of passages to print (default 5)")
    search_parser.add_argument("--book", choices=list(BOOK_IDS), help="restrict to one source book")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "build":
        return run_build(allow_ocr=not args.no_ocr, page_range=args.pages)
    if args.command == "search":
        if args.limit < 1:
            print("ERROR: --limit must be at least 1.", file=sys.stderr)
            return 2
        return run_search(args.query, args.limit, args.book)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
