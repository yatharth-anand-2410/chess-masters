"""Tests for the Gemini model fallback chain (``services/analyzer.py``).

Verifies that a provider-side overload (retryable 503) is recovered by falling
back to the next model in the chain — on the open call AND mid-stream while
nothing has been yielded yet — that partially delivered streams are never
silently restarted, that non-retryable errors raise immediately, and that a
model which just failed the whole retry cycle is skipped (cooldown) next call.

Run from the backend directory::

    python -m pytest tests/test_model_fallback.py -q
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from google.genai import errors

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import analyzer

_OVERLOAD = {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}}
_BAD_REQUEST = {"error": {"code": 400, "message": "invalid payload", "status": "INVALID_ARGUMENT"}}


class _Chunk:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeStream:
    """Async-iterable stream; optionally raises 503 after N yielded chunks."""

    def __init__(self, chunks: list[str], raise_after: int | None = None) -> None:
        self._chunks = chunks
        self._raise_after = raise_after

    def __aiter__(self):
        async def _gen():
            for index, text in enumerate(self._chunks):
                if self._raise_after is not None and index >= self._raise_after:
                    break
                yield _Chunk(text)
            if self._raise_after is not None:
                raise errors.APIError(503, _OVERLOAD, None)

        return _gen()


class _FakeResponse:
    def __init__(self, text: str = '{"moments": []}') -> None:
        self.text = text

    def __aiter__(self):
        return _FakeStream([self.text]).__aiter__()


class _FakeModels:
    def __init__(self, fail_codes: dict[str, int], midstream: dict[str, int] | None = None) -> None:
        self.fail_codes = fail_codes
        self.midstream = midstream or {}  # model -> chunks to yield before 503
        self.calls: list[str] = []

    def _maybe_fail(self, model: str) -> None:
        self.calls.append(model)
        code = self.fail_codes.get(model)
        if code is not None:
            body = _OVERLOAD if code in (429, 503) else _BAD_REQUEST
            raise errors.APIError(code, body, None)

    async def generate_content_stream(self, *, model, contents, config):
        self._maybe_fail(model)
        if model in self.midstream:
            raise_after = self.midstream[model]
            return _FakeStream(["part-1", "part-2"], raise_after=raise_after)
        return _FakeStream(["streamed"])

    async def generate_content(self, *, model, contents, config):
        self._maybe_fail(model)
        return _FakeResponse()


class _FakeClient:
    def __init__(self, fail_codes: dict[str, int], midstream: dict[str, int] | None = None) -> None:
        self.models = _FakeModels(fail_codes, midstream)
        self.aio = type("Aio", (), {"models": self.models})()


async def _collect(gen):
    out = []
    async for item in gen:
        out.append(item)
    return out


@pytest.fixture(autouse=True)
def _isolated_state(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_FALLBACK_MODELS", raising=False)
    analyzer._model_cooldown_until.clear()

    async def _instant(_seconds):
        return None

    monkeypatch.setattr(analyzer.asyncio, "sleep", _instant)
    yield
    analyzer._model_cooldown_until.clear()


def test_chain_uses_defaults_and_env_override(monkeypatch):
    assert analyzer._model_chain() == [
        analyzer.DEFAULT_MODEL,
        *analyzer.DEFAULT_FALLBACK_MODELS,
    ]
    monkeypatch.setenv("GEMINI_MODEL", "primary-x")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "backup-1, backup-2 ,primary-x")
    assert analyzer._model_chain() == ["primary-x", "backup-1", "backup-2"]
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "none")
    assert analyzer._model_chain() == ["primary-x"]


def test_is_retryable_accepts_status_strings_and_messages():
    assert analyzer._is_retryable(errors.APIError(503, _OVERLOAD, None))
    assert analyzer._is_retryable(errors.APIError(429, {}, None))
    weird = errors.APIError(500, _OVERLOAD, None)
    weird.status = "UNAVAILABLE"
    assert analyzer._is_retryable(weird)
    message_only = errors.APIError(500, {}, None)
    message_only.message = "This model is currently experiencing high demand"
    assert analyzer._is_retryable(message_only)
    assert not analyzer._is_retryable(errors.APIError(400, {}, None))


def test_open_time_overload_falls_back():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 503})
    chunks = asyncio.run(_collect(analyzer._stream_with_fallback(client, "contents")))
    assert chunks == ["streamed"]

    calls = client.models.calls
    primary_calls = [c for c in calls if c == analyzer.DEFAULT_MODEL]
    # initial attempt + _PRIMARY_MAX_RETRIES retries, then the fallback wins.
    assert len(primary_calls) == analyzer._PRIMARY_MAX_RETRIES + 1
    assert calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[0]
    assert analyzer.DEFAULT_MODEL in analyzer._model_cooldown_until


def test_midstream_overload_before_first_chunk_falls_back():
    # 503 raised on the first chunk fetch, before any text was yielded.
    client = _FakeClient({}, midstream={analyzer.DEFAULT_MODEL: 0})
    chunks = asyncio.run(_collect(analyzer._stream_with_fallback(client, "contents")))
    assert chunks == ["streamed"]
    assert client.models.calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[0]


def test_partially_delivered_stream_is_not_restarted():
    # One chunk yielded, then 503: the error must propagate (no fallback
    # retry that would duplicate content already sent to the client).
    client = _FakeClient({}, midstream={analyzer.DEFAULT_MODEL: 1})
    with pytest.raises(errors.APIError):
        asyncio.run(_collect(analyzer._stream_with_fallback(client, "contents")))
    assert client.models.calls == [analyzer.DEFAULT_MODEL]


def test_cooldown_skips_failed_model_on_next_call():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 503})
    asyncio.run(_collect(analyzer._stream_with_fallback(client, "first")))
    client.models.calls.clear()

    asyncio.run(_collect(analyzer._stream_with_fallback(client, "second")))
    assert analyzer.DEFAULT_MODEL not in client.models.calls
    assert client.models.calls == [analyzer.DEFAULT_FALLBACK_MODELS[0]]


def test_non_retryable_error_raises_without_fallback():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 400})
    with pytest.raises(errors.APIError):
        asyncio.run(_collect(analyzer._stream_with_fallback(client, "contents")))
    assert client.models.calls == [analyzer.DEFAULT_MODEL]


def test_all_models_failing_still_raises_last_error():
    client = _FakeClient(
        {model: 503 for model in (analyzer.DEFAULT_MODEL, *analyzer.DEFAULT_FALLBACK_MODELS)}
    )
    with pytest.raises(errors.APIError):
        asyncio.run(_collect(analyzer._stream_with_fallback(client, "contents")))
    assert client.models.calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[-1]


def test_describe_moments_falls_back_and_stays_fail_soft(monkeypatch):
    monkeypatch.setattr(
        analyzer, "_build_moment_payload", lambda engine_data: {"moments": [{"id": "w0"}]}
    )

    # Primary overloaded: the call should still reach a fallback model.
    client = _FakeClient({analyzer.DEFAULT_MODEL: 503})
    asyncio.run(analyzer.describe_moments(client, {}))
    assert client.models.calls[0] == analyzer.DEFAULT_MODEL
    assert client.models.calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[0]

    # Every model overloaded: fail-soft ({}), never raise.
    analyzer._model_cooldown_until.clear()
    bad_client = _FakeClient(
        {model: 503 for model in (analyzer.DEFAULT_MODEL, *analyzer.DEFAULT_FALLBACK_MODELS)}
    )
    assert asyncio.run(analyzer.describe_moments(bad_client, {})) == {}
    assert bad_client.models.calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[-1]
