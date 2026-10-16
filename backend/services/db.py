"""Supabase persistence + token verification.

The backend authenticates the caller by validating their access token against
the GoTrue endpoint, then uses the service-role secret to read/write the
user's own rows. Ownership is always enforced with ``user_id`` filters.

Two things keep this module fast enough to sit on every page load:

* Every call goes through a thread-local ``requests.Session``. Supabase lives in
  a different region than this service, so a fresh TCP+TLS handshake per query
  used to cost ~200ms on its own; reusing the connection removes it.
* ``get_user_from_token`` caches a verified token for a short TTL, so the 5-9
  authenticated requests a page fires do not each pay for a GoTrue round trip.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

TIMEOUT = 12

_local = threading.local()

#: A pooled connection older than this is dropped before reuse. Supabase's edge
#: closes idle keep-alives, and a request sent down a dead socket surfaces as a
#: connection error; reconnecting costs one handshake, failing costs the page.
SESSION_IDLE_RESET_SECONDS = 45.0


def _session(fresh: bool = False) -> requests.Session:
    """One keep-alive session per worker thread (``requests`` is not reentrant).

    ``fresh=True`` closes the pooled connection first: writes use it so a retry
    can never be needed on a non-idempotent request.
    """
    session: Optional[requests.Session] = getattr(_local, "session", None)
    last_used = float(getattr(_local, "last_used", 0.0))
    if (
        session is None
        or fresh
        or (time.monotonic() - last_used) > SESSION_IDLE_RESET_SECONDS
    ):
        if session is not None:
            session.close()
        session = requests.Session()
        session.headers["User-Agent"] = "AI-Chess-Game-Analyzer/1.0 (backend)"
        # Reads may be repeated safely; writes keep the default (no) retries so a
        # lost response can never double-charge a credit or duplicate a row.
        retry = Retry(
            total=2,
            connect=2,
            read=2,
            status=0,
            backoff_factor=0.15,
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _local.session = session
    _local.last_used = time.monotonic()
    return session


def _get(url: str, **kwargs: Any) -> requests.Response:
    return _session().get(url, **kwargs)


def _post(url: str, **kwargs: Any) -> requests.Response:
    return _session(fresh=True).post(url, **kwargs)


def _patch(url: str, **kwargs: Any) -> requests.Response:
    return _session(fresh=True).patch(url, **kwargs)


FREE_ANALYSIS_LIMIT = 5
PAID_ANALYSIS_LIMIT = 100
GUEST_ANALYSIS_LIMIT = 1

KNOWN_NON_PAID_STATUSES = {"pending", "halted", "cancelled", "completed", "expired"}

# Subscription tiers (0015_billing_plan_tier.sql). The tier is stored on the
# usage row so coach-only features can require the Master Coach plan.
PLAN_TIER_FREE = "free"
PLAN_TIER_STUDENT = "student"
PLAN_TIER_COACH = "coach"
PLAN_TIERS = (PLAN_TIER_FREE, PLAN_TIER_STUDENT, PLAN_TIER_COACH)

# History/list reads must stay light: the `pgn`, `replay`, `report_markdown` and
# `insights` payloads are only fetched when a caller actually reads one game.
# `replay_available` (generated in 0014_game_telemetry.sql) tells the UI whether
# the replay endpoint can serve the row, and the detail read keeps `pgn` so old
# games stay playable.
#: Metadata only — what the history list, the home "recent analyses" rail and the
#: batch list render. A full coaching report is 5-15 KB, so selecting it for 50
#: rows used to move megabytes just to show dates and openings.
ANALYSIS_LIST_COLUMNS = (
    "id,user_id,platform,game_url,game_id,username,player_color,player_name,"
    "opening_name,eco,result,status,error_message,created_at,completed_at,"
    "batch_id,student_id,replay_available,student:students(display_name)"
)

#: Derived views (progress, curated studies, tactics) read the stored telemetry
#: but never the rendered report.
ANALYSIS_TELEMETRY_COLUMNS = ANALYSIS_LIST_COLUMNS + ",insights,game_summary"

ANALYSIS_DETAIL_COLUMNS = (
    "id,user_id,platform,game_url,game_id,username,player_color,player_name,pgn,"
    "opening_name,eco,result,report_markdown,insights,status,error_message,"
    "created_at,completed_at,batch_id,student_id,game_summary,replay_available,"
    "student:students(display_name)"
)

#: Batch list rows: the batch report body is only read on /batch/{id}.
BATCH_LIST_COLUMNS = (
    "id,user_id,platform,username,game_count,status,error_message,created_at,"
    "completed_at,student_id"
)


def _period_end_in_future(value: Any) -> bool:
    if not value:
        return False
    if isinstance(value, datetime):
        end = value
    else:
        try:
            end = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return False
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return end > datetime.now(timezone.utc)


def is_paid_plan(plan: str, status: str, period_end: Any = None) -> bool:
    """Option B gating: paused or period-end-cancelled plans keep access until
    the paid period ends."""
    if plan != "paid":
        return False
    if status in {"authenticated", "active"}:
        return True
    if status in {"paused", "cancelled"}:
        return _period_end_in_future(period_end)
    return status not in KNOWN_NON_PAID_STATUSES


class AuthError(Exception):
    """Raised when a bearer token is invalid, expired, or missing."""


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return url, key


def configured() -> bool:
    url, key = _config()
    return bool(url and key)


def _service_headers() -> Dict[str, str]:
    _url, key = _config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _user_headers(token: str) -> Dict[str, str]:
    _url, key = _config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {token}",
    }


def _telemetry_check(response: requests.Response) -> None:
    """Turn a missing-telemetry-column failure into a setup hint.

    PostgREST answers 400 with code 42703 while 0014_game_telemetry.sql has not
    been run yet; surfacing the hint here means the failure reads as a setup
    step instead of a mystery 500 in the logs.
    """
    if response.status_code == 400 and "42703" in response.text:
        raise AuthError(
            "Game telemetry is not deployed. Run migration "
            "0014_game_telemetry.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()


def _plan_tier_check(response: requests.Response) -> None:
    """Turn a missing plan-tier-column failure into a setup hint (0015)."""
    if response.status_code == 400 and "42703" in response.text:
        raise AuthError(
            "Plan tiers are not deployed. Run migration "
            "0015_billing_plan_tier.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()


#: Verified tokens are cached for this long. A page load makes 5-9 authenticated
#: calls with the same bearer token; without the cache each one paid a ~200ms
#: GoTrue round trip. The TTL bounds how long a revoked token keeps working.
AUTH_CACHE_TTL_SECONDS = float(os.environ.get("AUTH_CACHE_TTL_SECONDS", "90"))
AUTH_CACHE_MAX_ENTRIES = 512

_auth_cache: "OrderedDict[str, Tuple[float, Dict[str, Any]]]" = OrderedDict()
_auth_cache_lock = threading.Lock()


def _auth_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_user(token: str) -> Optional[Dict[str, Any]]:
    if AUTH_CACHE_TTL_SECONDS <= 0:
        return None
    key = _auth_cache_key(token)
    now = time.monotonic()
    with _auth_cache_lock:
        entry = _auth_cache.get(key)
        if entry is None:
            return None
        expires_at, user = entry
        if expires_at <= now:
            _auth_cache.pop(key, None)
            return None
        _auth_cache.move_to_end(key)
        return user


def _remember_user(token: str, user: Dict[str, Any]) -> None:
    if AUTH_CACHE_TTL_SECONDS <= 0:
        return
    key = _auth_cache_key(token)
    with _auth_cache_lock:
        _auth_cache[key] = (time.monotonic() + AUTH_CACHE_TTL_SECONDS, user)
        _auth_cache.move_to_end(key)
        while len(_auth_cache) > AUTH_CACHE_MAX_ENTRIES:
            _auth_cache.popitem(last=False)


def forget_token(token: str) -> None:
    """Drop one cached verification (used when upstream rejects the token)."""
    with _auth_cache_lock:
        _auth_cache.pop(_auth_cache_key(token), None)


def get_user_from_token(token: str) -> Dict[str, Any]:
    """Resolve the caller from their bearer token, with a short-lived cache.

    Cache misses still hit GoTrue; invalid or expired tokens are never cached,
    so revocation is honoured as soon as the entry's TTL lapses.
    """
    url, _key = _config()
    if not token:
        raise AuthError("Missing authentication token.")
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    cached = _cached_user(token)
    if cached is not None:
        return cached
    try:
        response = _get(
            f"{url}/auth/v1/user",
            headers=_user_headers(token),
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise AuthError(f"Could not reach the auth service: {exc}") from exc
    if response.status_code != 200:
        forget_token(token)
        raise AuthError("Invalid or expired authentication token.")
    user = response.json()
    if not user.get("id"):
        raise AuthError("Invalid authentication token.")
    _remember_user(token, user)
    return user


def create_analysis(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    payload = {"user_id": user_id, **data}
    response = _post(
        f"{url}/rest/v1/analyses",
        json=payload,
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def update_analysis(user_id: str, analysis_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/analyses",
        params={"id": f"eq.{analysis_id}", "user_id": f"eq.{user_id}"},
        json=updates,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def get_analysis(user_id: str, analysis_id: str) -> Optional[Dict[str, Any]]:
    """One full report row: keeps ``pgn`` (old games stay playable) but never
    the heavy ``replay`` payload — that has its own endpoint."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": ANALYSIS_DETAIL_COLUMNS,
            "id": f"eq.{analysis_id}",
            "user_id": f"eq.{user_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _telemetry_check(response)
    rows = response.json()
    return rows[0] if rows else None


def get_analysis_replay(
    user_id: str, analysis_id: str
) -> Optional[Dict[str, Any]]:
    """The stored replay payload for one owned analysis, or ``None``.

    Kept separate from :func:`get_analysis` so the review read never pays for
    the move-by-move JSON.
    """
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "id,replay,replay_available",
            "id": f"eq.{analysis_id}",
            "user_id": f"eq.{user_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _telemetry_check(response)
    rows = response.json()
    return rows[0] if rows else None


def list_analyses(
    user_id: str,
    limit: int = 50,
    standalone: bool = False,
    mine: bool = False,
    columns: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List one account's analyses.

    ``columns`` defaults to :data:`ANALYSIS_LIST_COLUMNS` (metadata only). The
    derived views that need the stored telemetry pass
    :data:`ANALYSIS_TELEMETRY_COLUMNS`; nothing here ever selects the rendered
    report body.
    """
    url, _key = _config()
    params = {
        "select": columns or ANALYSIS_LIST_COLUMNS,
        "user_id": f"eq.{user_id}",
        "status": "neq.failed",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if standalone:
        params["batch_id"] = "is.null"
    if mine:
        # The coach's own games: analyses that are not tagged to a student.
        params["student_id"] = "is.null"
    response = _get(
        f"{url}/rest/v1/analyses",
        params=params,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _telemetry_check(response)
    return response.json()


#: The lifetime analysed-game count drives the psychology unlock badge. It only
#: changes when an analysis completes (which forgets the entry below), so the
#: extra PostgREST round trip per usage read is unnecessary.
_LIFETIME_COUNT_TTL_SECONDS = 300.0
_lifetime_counts: Dict[str, Tuple[float, int]] = {}
_lifetime_counts_lock = threading.Lock()


def count_completed_analyses(user_id: str) -> int:
    """Lifetime count of successfully analyzed games (standalone + batch)."""
    now = time.monotonic()
    with _lifetime_counts_lock:
        cached = _lifetime_counts.get(user_id)
        if cached is not None and cached[0] > now:
            return cached[1]

    count = _fetch_completed_analyses_count(user_id)
    with _lifetime_counts_lock:
        _lifetime_counts[user_id] = (time.monotonic() + _LIFETIME_COUNT_TTL_SECONDS, count)
        while len(_lifetime_counts) > AUTH_CACHE_MAX_ENTRIES:
            _lifetime_counts.pop(next(iter(_lifetime_counts)))
    return count


def forget_lifetime_count(user_id: str) -> None:
    """Called when an analysis completes so the badge moves immediately."""
    with _lifetime_counts_lock:
        _lifetime_counts.pop(user_id, None)


def _fetch_completed_analyses_count(user_id: str) -> int:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "id",
            "user_id": f"eq.{user_id}",
            "status": "eq.completed",
            "limit": "1",
        },
        headers={
            **_service_headers(),
            "Prefer": "count=exact",
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    content_range = response.headers.get("Content-Range", "")
    if "/" not in content_range:
        return 0
    try:
        return int(content_range.rsplit("/", 1)[-1])
    except ValueError:
        return 0


def create_batch(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/analysis_batches",
        json={"user_id": user_id, **data},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def update_batch(user_id: str, batch_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/analysis_batches",
        params={"id": f"eq.{batch_id}", "user_id": f"eq.{user_id}"},
        json=updates,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def get_batch(user_id: str, batch_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_batches",
        params={
            "select": "*",
            "id": f"eq.{batch_id}",
            "user_id": f"eq.{user_id}",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def list_batches(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Batch summaries for the history rails — never the batch report body."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_batches",
        params={
            "select": BATCH_LIST_COLUMNS,
            "user_id": f"eq.{user_id}",
            "status": "neq.failed",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def list_analyses_by_batch(user_id: str, batch_id: str) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "batch_id": f"eq.{batch_id}",
            "order": "created_at.asc",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def add_message(user_id: str, analysis_id: str, role: str, content: str) -> Dict[str, Any]:
    url, _key = _config()
    payload = {
        "user_id": user_id,
        "analysis_id": analysis_id,
        "role": role,
        "content": content,
    }
    response = _post(
        f"{url}/rest/v1/analysis_messages",
        json=payload,
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def list_messages(analysis_id: str) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_messages",
        params={
            "select": "*",
            "analysis_id": f"eq.{analysis_id}",
            "order": "created_at.asc",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def upsert_review(
    user_id: str,
    rating: int,
    comment: Optional[str],
    display_name: Optional[str],
) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/reviews",
        params={"on_conflict": "user_id"},
        json={
            "user_id": user_id,
            "rating": rating,
            "comment": comment,
            "display_name": display_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            **_service_headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def list_reviews(limit: int = 200) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/reviews",
        params={
            "select": "id,user_id,rating,comment,display_name,created_at,updated_at",
            "order": "rating.desc,created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def get_user_review(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/reviews",
        params={"select": "*", "user_id": f"eq.{user_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_review_stats() -> Dict[str, Any]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/review_stats",
        params={"select": "*"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {"review_count": 0, "average_rating": None}
    return rows[0]


def get_usage(user_id: str) -> Dict[str, Any]:
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = _get(
        f"{url}/rest/v1/account_usage",
        params={"select": "*", "user_id": f"eq.{user_id}"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return {
            "plan": "free",
            "plan_tier": PLAN_TIER_FREE,
            "analyses_used": 0,
            "free_analysis_limit": FREE_ANALYSIS_LIMIT,
            "paid_analysis_limit": PAID_ANALYSIS_LIMIT,
            "subscription_status": "inactive",
            "current_period_end": None,
            "usage_period_end": None,
        }
    row = rows[0]
    return {
        "plan": row.get("plan", "free"),
        "plan_tier": row.get("plan_tier", PLAN_TIER_FREE),
        "analyses_used": row.get("analyses_used", 0),
        "free_analysis_limit": row.get("free_analysis_limit", FREE_ANALYSIS_LIMIT),
        "paid_analysis_limit": row.get("paid_analysis_limit", PAID_ANALYSIS_LIMIT),
        "subscription_status": row.get("subscription_status", "inactive"),
        "current_period_end": row.get("current_period_end"),
        "usage_period_end": row.get("usage_period_end"),
    }


def is_coach_plan(user_id: str) -> bool:
    """True when the account is on the coach tier with paid access left.

    Coach mode and share items are gated on this rather than on the paid flag
    alone: a Pro Student subscription keeps every analysis feature but does not
    unlock student rosters. A lapsed or paused-past-period coach account loses
    the tier even though the stored ``plan_tier`` column keeps its last value.
    """
    usage = get_usage(user_id)
    tier = str(usage.get("plan_tier") or PLAN_TIER_FREE).strip().lower()
    if tier != PLAN_TIER_COACH:
        return False
    return is_paid_plan(
        str(usage.get("plan", "free")),
        str(usage.get("subscription_status", "inactive")),
        usage.get("current_period_end"),
    )


def get_current_subscription(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "status": "in.(created,pending,authenticated,active,paused)",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_subscription_by_customer_id(customer_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "razorpay_customer_id": f"eq.{customer_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def create_subscription(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/billing_subscriptions",
        json={"user_id": user_id, **data},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else {}


def get_subscription(user_id: str, subscription_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "razorpay_subscription_id": f"eq.{subscription_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_subscription_by_razorpay_id(subscription_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_subscriptions",
        params={"select": "*", "razorpay_subscription_id": f"eq.{subscription_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def get_latest_subscription(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_subscriptions",
        params={
            "select": "*",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def update_subscription(subscription_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/billing_subscriptions",
        params={"razorpay_subscription_id": f"eq.{subscription_id}"},
        json=updates,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def set_paid_access(
    user_id: str,
    paid: bool,
    status: str,
    period_end: Any = None,
    *,
    plan_tier: Optional[str] = None,
    paid_analysis_limit: Optional[int] = None,
) -> None:
    """Store the account's paid state, tier and per-period quota.

    ``plan_tier`` (``student``/``coach``) and ``paid_analysis_limit`` come from
    the subscription that is being activated; both are optional so callers that
    only flip the paid flag keep working. The tier is only written when access
    is granted — a lapsed subscription keeps the last tier on the row for
    billing history, while :func:`is_coach_plan` still refuses the feature.
    """
    url, _key = _config()
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "plan": "paid" if paid else "free",
        "subscription_status": status,
        "current_period_end": period_end,
    }
    if paid and plan_tier:
        payload["plan_tier"] = plan_tier
    if paid_analysis_limit is not None:
        payload["paid_analysis_limit"] = int(paid_analysis_limit)
    response = _post(
        f"{url}/rest/v1/account_usage",
        params={"on_conflict": "user_id"},
        json=payload,
        headers={**_service_headers(), "Prefer": "resolution=merge-duplicates"},
        timeout=TIMEOUT,
    )
    _plan_tier_check(response)


def reset_analysis_usage(user_id: str) -> None:
    """Start a fresh counting period, e.g. right after a paid upgrade."""
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/account_usage",
        params={"user_id": f"eq.{user_id}"},
        json={"analyses_used": 0, "updated_at": datetime.now(timezone.utc).isoformat()},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def record_invoice(user_id: str, data: Dict[str, Any]) -> bool:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/billing_invoices",
        json={"user_id": user_id, **data},
        headers={**_service_headers(), "Prefer": "return=minimal"},
        timeout=TIMEOUT,
    )
    if response.status_code == 409:
        return False
    response.raise_for_status()
    return True


def list_invoices_db(user_id: str, limit: int = 12) -> List[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/billing_invoices",
        params={
            "select": "razorpay_invoice_id,status,amount,currency,paid_at,short_url",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return [
        {
            "id": row.get("razorpay_invoice_id"),
            "status": row.get("status"),
            "amount": row.get("amount"),
            "currency": row.get("currency"),
            "paid_at": row.get("paid_at"),
            "short_url": row.get("short_url"),
        }
        for row in response.json()
    ]


def record_webhook_event(event_id: str, event_type: str, payload: Dict[str, Any]) -> bool:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/billing_webhook_events",
        json={"razorpay_event_id": event_id, "event_type": event_type, "payload": payload},
        headers={**_service_headers(), "Prefer": "return=minimal"},
        timeout=TIMEOUT,
    )
    if response.status_code == 409:
        return False
    response.raise_for_status()
    return True


def consume_analysis_credit(user_id: str) -> Dict[str, Any]:
    """Atomically consume one analysis credit via the SQL function.

    Returns the jsonb payload from ``consume_analysis_credit``, e.g.
    ``{"allowed": true, "plan": "free", "analyses_used": 1, "free_analysis_limit": 2}``.
    Paid plans consume from ``paid_analysis_limit`` (per billing cycle) and
    return ``{"allowed": false, "plan": "paid", "limit_reached": true, ...}``
    when exhausted. The caller decides how to respond when ``allowed`` is false.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = _post(
        f"{url}/rest/v1/rpc/consume_analysis_credit",
        json={"p_user_id": user_id},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Quota function is not deployed. Run migration 0002_account_usage.sql "
            "in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()


def consume_guest_analysis(
    ip: str, daily_limit: int = GUEST_ANALYSIS_LIMIT
) -> Dict[str, Any]:
    """Atomically consume the guest trial for an anonymous IP address.

    Returns the jsonb payload from ``consume_guest_analysis``, e.g.
    ``{"allowed": true, "analyses_used": 1, "limit": 1}``. The counter resets
    after a rolling 24-hour window. Missing IPs are refused so the trial can
    never fail open.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    if not ip:
        return {"allowed": False, "analyses_used": 0, "limit": daily_limit}
    response = _post(
        f"{url}/rest/v1/rpc/consume_guest_analysis",
        json={"p_ip": ip, "p_daily_limit": daily_limit},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Guest quota function is not deployed. Run migration "
            "0011_guest_trial.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()


def claim_guest_trial(user_id: str) -> Dict[str, Any]:
    """Count the guest trial against a new account's free analyses once.

    Idempotent: the SQL function marks ``guest_trial_claimed`` and never
    deducts more than one credit for the same account.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = _post(
        f"{url}/rest/v1/rpc/claim_guest_trial",
        json={"p_user_id": user_id},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Guest trial function is not deployed. Run migration "
            "0011_guest_trial.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()


def consume_analysis_credits(user_id: str, count: int) -> Dict[str, Any]:
    """Atomically consume ``count`` credits for a multi-game batch.

    All-or-nothing: when the account cannot cover the whole batch the function
    returns ``{"allowed": false, "remaining": r, ...}`` without incrementing.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = _post(
        f"{url}/rest/v1/rpc/consume_analysis_credits",
        json={"p_user_id": user_id, "p_count": count},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Batch quota function is not deployed. Run migration "
            "0008_multi_game_batches.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()


def refund_analysis_credits(user_id: str, count: int = 1) -> Dict[str, Any]:
    """Return credits consumed by analyses that failed before completing.

    Failed analyses are not charged, so every failure path gives the consumed
    credit(s) back via the ``refund_analysis_credits`` SQL function.
    """
    url, _key = _config()
    if not configured():
        raise AuthError("Supabase is not configured on the server.")
    response = _post(
        f"{url}/rest/v1/rpc/refund_analysis_credits",
        json={"p_user_id": user_id, "p_count": count},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    if response.status_code == 404:
        raise AuthError(
            "Refund function is not deployed. Run migration "
            "0009_refund_failed_analyses.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()
    return response.json()


# ---------------------------------------------------------------------------
# Coach mode: profiles, student rosters, and share links (0012_coach_mode.sql).
# ---------------------------------------------------------------------------

def _coach_check(response: requests.Response) -> None:
    """Shared response check for coach-mode tables.

    PostgREST answers 404 (missing table) or 400 with code 42703 (missing
    column) while the coach-mode migrations have not been run yet; surfacing
    the hint here means the failure reads as a setup step instead of a mystery
    500 in the logs.
    """
    if response.status_code == 404 or (
        response.status_code == 400 and "42703" in response.text
    ):
        raise AuthError(
            "Coach mode is not deployed. Run migrations 0012_coach_mode.sql "
            "and 0013_batch_student.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()


def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/user_profiles",
        params={"select": "*", "user_id": f"eq.{user_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def upsert_user_profile(user_id: str, role: str) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/user_profiles",
        params={"on_conflict": "user_id"},
        json={
            "user_id": user_id,
            "role": role,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            **_service_headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else {}


def create_student(coach_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/students",
        json={"coach_id": coach_id, **data},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else {}


def list_students(coach_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:
    url, _key = _config()
    params = {
        "select": "*",
        "coach_id": f"eq.{coach_id}",
        "order": "created_at.desc",
    }
    if not include_archived:
        params["archived_at"] = "is.null"
    response = _get(
        f"{url}/rest/v1/students",
        params=params,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def get_student(coach_id: str, student_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/students",
        params={
            "select": "*",
            "id": f"eq.{student_id}",
            "coach_id": f"eq.{coach_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def update_student(coach_id: str, student_id: str, updates: Dict[str, Any]) -> None:
    url, _key = _config()
    payload = {**updates, "updated_at": datetime.now(timezone.utc).isoformat()}
    response = _patch(
        f"{url}/rest/v1/students",
        params={"id": f"eq.{student_id}", "coach_id": f"eq.{coach_id}"},
        json=payload,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)


def list_analyses_by_student(
    user_id: str, student_id: str, limit: int = 100
) -> List[Dict[str, Any]]:
    """Analyses the coach ran for one student, newest first.

    Failed runs are hidden, matching the main history list: the credits were
    refunded and there is nothing to read.

    The projection carries the same per-game telemetry the player history has
    (``game_summary``, ``insights``, ``username``) so the student progress
    surface can compute real numbers, while ``pgn`` stays out to keep the list
    light.
    """
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": (
                "id,platform,game_id,game_url,username,player_color,player_name,"
                "opening_name,eco,result,status,error_message,insights,"
                "game_summary,created_at,batch_id"
            ),
            "user_id": f"eq.{user_id}",
            "student_id": f"eq.{student_id}",
            "status": "neq.failed",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def list_batches_by_student(
    user_id: str, student_id: str, limit: int = 100
) -> List[Dict[str, Any]]:
    """Multi-game reports the coach ran for one student, newest first."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_batches",
        params={
            "select": (
                "id,platform,username,game_count,status,error_message,"
                "created_at,completed_at"
            ),
            "user_id": f"eq.{user_id}",
            "student_id": f"eq.{student_id}",
            "status": "neq.failed",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def list_public_batches(student_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Completed multi-game reports for a share page listing."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_batches",
        params={
            "select": "id,platform,game_count,created_at",
            "student_id": f"eq.{student_id}",
            "status": "eq.completed",
            "report_markdown": "not.is.null",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def get_batch_for_student(
    student_id: str, batch_id: str
) -> Optional[Dict[str, Any]]:
    """Service-side batch lookup for the public share endpoints.

    Mirrors :func:`get_analysis_for_student`: the caller must already hold a
    valid share token that resolves to ``student_id``.
    """
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analysis_batches",
        params={
            "select": "*",
            "id": f"eq.{batch_id}",
            "student_id": f"eq.{student_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def list_student_activity(coach_id: str, student_ids: List[str]) -> List[Dict[str, Any]]:
    """Per-student analysis activity for the roster: counts and last game.

    One query for the whole roster, then aggregated in Python. Returns the raw
    rows (student_id, created_at, result) so the shape stays cheap to extend.
    """
    if not student_ids:
        return []
    url, _key = _config()
    ids = ",".join(student_ids)
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "student_id,created_at,result",
            "user_id": f"eq.{coach_id}",
            "student_id": f"in.({ids})",
            "order": "created_at.desc",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def get_analysis_for_student(
    student_id: str, analysis_id: str
) -> Optional[Dict[str, Any]]:
    """Service-side lookup used by public share endpoints.

    The caller must already hold a valid share token that resolves to
    ``student_id``; filtering by both columns means a token can never reveal an
    analysis from another student.
    """
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "*",
            "id": f"eq.{analysis_id}",
            "student_id": f"eq.{student_id}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def get_student_by_id(student_id: str) -> Optional[Dict[str, Any]]:
    """Service-side student lookup (public endpoints hold no coach id)."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/students",
        params={"select": "*", "id": f"eq.{student_id}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def list_public_analyses(student_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Completed analyses with a written report, for the share page listing.

    Batch games carry completed analyses but no individual report, so they are
    filtered out here — every row on the shared page is readable.
    """
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/analyses",
        params={
            "select": (
                "id,platform,game_id,game_url,player_color,opening_name,eco,"
                "result,created_at"
            ),
            "student_id": f"eq.{student_id}",
            "status": "eq.completed",
            "report_markdown": "not.is.null",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    return response.json()


def create_share_link(coach_id: str, student_id: str) -> Dict[str, Any]:
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/share_links",
        json={"coach_id": coach_id, "student_id": student_id},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else {}


def get_active_share_link(coach_id: str, student_id: str) -> Optional[Dict[str, Any]]:
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/share_links",
        params={
            "select": "*",
            "coach_id": f"eq.{coach_id}",
            "student_id": f"eq.{student_id}",
            "revoked_at": "is.null",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def revoke_share_links(coach_id: str, student_id: str) -> None:
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/share_links",
        params={
            "coach_id": f"eq.{coach_id}",
            "student_id": f"eq.{student_id}",
            "revoked_at": "is.null",
        },
        json={"revoked_at": datetime.now(timezone.utc).isoformat()},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)


def get_share_link(token: str) -> Optional[Dict[str, Any]]:
    """Service-side lookup for public share endpoints."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/share_links",
        params={"select": "*", "token": f"eq.{token}", "limit": "1"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)
    rows = response.json()
    return rows[0] if rows else None


def touch_share_link(token: str) -> None:
    """Best-effort view counter for the coach's "viewed N times" hint."""
    url, _key = _config()
    existing = get_share_link(token)
    if not existing:
        return
    response = _patch(
        f"{url}/rest/v1/share_links",
        params={"token": f"eq.{token}"},
        json={
            "view_count": int(existing.get("view_count", 0) or 0) + 1,
            "last_viewed_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _coach_check(response)


# ---------------------------------------------------------------------------
# Share items: no-sign-in study / tactic links (0016_share_items.sql).
# ---------------------------------------------------------------------------

SHARE_ITEM_COLUMNS = (
    "token,coach_id,student_id,kind,item_key,title,subtitle,url,"
    "view_count,last_viewed_at,revoked_at,created_at"
)


def _share_items_check(response: requests.Response) -> None:
    """Turn a missing share-items table into a setup hint (0016)."""
    if response.status_code == 404 or (
        response.status_code == 400 and "42703" in response.text
    ):
        raise AuthError(
            "Share items are not deployed. Run migration "
            "0016_share_items.sql in the Supabase SQL Editor."
        )
    response.raise_for_status()


def create_share_item(coach_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Store one coach-authored share: a study or a tactic theme."""
    url, _key = _config()
    response = _post(
        f"{url}/rest/v1/share_items",
        json={"coach_id": coach_id, **data},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    _share_items_check(response)
    rows = response.json()
    return rows[0] if rows else {}


def list_share_items(
    coach_id: str,
    student_id: Optional[str] = None,
    include_revoked: bool = False,
) -> List[Dict[str, Any]]:
    """The coach's share items, newest first.

    ``student_id`` narrows the list to items handed to one student; ``None``
    returns every item the coach owns, including the ones attached to no
    student ("anyone with the link"). Revoked items stay out unless asked for.
    """
    url, _key = _config()
    params = {
        "select": SHARE_ITEM_COLUMNS,
        "coach_id": f"eq.{coach_id}",
        "order": "created_at.desc",
    }
    if student_id:
        params["student_id"] = f"eq.{student_id}"
    if not include_revoked:
        params["revoked_at"] = "is.null"
    response = _get(
        f"{url}/rest/v1/share_items",
        params=params,
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _share_items_check(response)
    return response.json()


def get_share_item(token: str) -> Optional[Dict[str, Any]]:
    """Service-side lookup for the public share endpoint."""
    url, _key = _config()
    response = _get(
        f"{url}/rest/v1/share_items",
        params={
            "select": SHARE_ITEM_COLUMNS,
            "token": f"eq.{token}",
            "limit": "1",
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _share_items_check(response)
    rows = response.json()
    return rows[0] if rows else None


def revoke_share_item(coach_id: str, token: str) -> bool:
    """Revoke one share item. Idempotent: already-revoked rows stay revoked.

    Returns ``True`` when this call closed a still-active link.
    """
    url, _key = _config()
    response = _patch(
        f"{url}/rest/v1/share_items",
        params={
            "coach_id": f"eq.{coach_id}",
            "token": f"eq.{token}",
            "revoked_at": "is.null",
        },
        json={"revoked_at": datetime.now(timezone.utc).isoformat()},
        headers={**_service_headers(), "Prefer": "return=representation"},
        timeout=TIMEOUT,
    )
    _share_items_check(response)
    rows = response.json()
    return bool(rows)


def touch_share_item(token: str) -> Optional[int]:
    """Bump the view counter and return the new count (``None`` if unknown)."""
    url, _key = _config()
    existing = get_share_item(token)
    if not existing:
        return None
    view_count = int(existing.get("view_count", 0) or 0) + 1
    response = _patch(
        f"{url}/rest/v1/share_items",
        params={"token": f"eq.{token}"},
        json={
            "view_count": view_count,
            "last_viewed_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    _share_items_check(response)
    return view_count
