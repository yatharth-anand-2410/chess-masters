"""Shared harness for the backend suite.

Every test module here promises an offline run, and three of them are live by
design (they assert against lichess.org directly). Without a guard the suite
would also inherit whatever ``LICHESS_TOKEN`` and ``SUPABASE_*`` values live in
``backend/.env`` — which turns a unit test into a call against a real account
and its private study library. That is the one thing a test must never do.

So by default:

* outbound HTTP through ``services.http`` is refused, loudly;
* the study library reports no Lichess token, so it is built from the committed
  curation file only.

Set ``LIVE_TESTS=1`` to allow real requests, which is what the smoke tests in
``smoke_test.py`` need; they skip themselves when it is unset.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import http as http_module  # noqa: E402
from services import studies  # noqa: E402

LIVE_TESTS = os.environ.get("LIVE_TESTS", "").strip() not in {"", "0", "false"}


def _blocked(*args: Any, **kwargs: Any) -> Any:
    target = args[0] if args else kwargs.get("url", "?")
    raise AssertionError(
        "This suite runs offline, but a test reached the network: "
        f"{target} — patch the transport it uses, or run with LIVE_TESTS=1."
    )


@pytest.fixture(autouse=True)
def offline_http(monkeypatch: pytest.MonkeyPatch) -> None:
    if LIVE_TESTS:
        return
    monkeypatch.setattr(http_module, "get", _blocked)
    monkeypatch.setattr(http_module, "head", _blocked)


@pytest.fixture(autouse=True)
def no_live_study_index(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's LICHESS_TOKEN must not make the suite read a real account.

    Tests that exercise the live index patch this back on themselves.
    """
    monkeypatch.setattr(studies, "lichess_configured", lambda: False)
