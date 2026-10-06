from __future__ import annotations

import threading
from typing import Dict, Optional

import requests

DEFAULT_USER_AGENT = "AI-Chess-Game-Analyzer/1.0 (chess game coaching tool)"

_local = threading.local()


def _session() -> requests.Session:
    session: Optional[requests.Session] = getattr(_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers["User-Agent"] = DEFAULT_USER_AGENT
        _local.session = session
    return session


def get(
    url: str,
    params: Optional[Dict[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    allow_redirects: bool = True,
) -> requests.Response:
    return _session().get(
        url,
        params=params,
        headers=headers,
        timeout=timeout,
        allow_redirects=allow_redirects,
    )


def head(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    allow_redirects: bool = False,
) -> requests.Response:
    return _session().head(
        url,
        headers=headers,
        timeout=timeout,
        allow_redirects=allow_redirects,
    )
