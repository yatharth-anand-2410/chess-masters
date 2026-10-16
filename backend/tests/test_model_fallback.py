"""Tests for the Gemini model fallback chain (``services/analyzer.py``).

Verifies that a provider-side overload (retryable 503) on the primary model
transparently falls back to the next model in the chain, that non-retryable
errors are raised immediately, and that a model which just failed the whole
retry cycle is skipped (cooldown) on the next call.

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


class _Chunk:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeResponse:
    def __init__(self, text: str = "ok") -> None:
        self.text = text

    def __aiter__(self):
        async def _gen():
            yield _Chunk(self.text)

        return _gen()


class _FakeModels:
    def __init__(self, fail_codes: dict[str, int]) -> None:
        self.fail_codes = fail_codes
        self.calls: list[str] = []

    def _maybe_fail(self, model: str) -> None:
        self.calls.append(model)
        code = self.fail_codes.get(model)
        if code is not None:
            raise errors.APIError(code, {"error": {"message": "overloaded"}}, None)

    async def generate_content_stream(self, *, model, contents, config):
        self._maybe_fail(model)
        return _FakeResponse("streamed")

    async def generate_content(self, *, model, contents, config):
        self._maybe_fail(model)
        return _FakeResponse('{"moments": []}')


class _FakeClient:
    def __init__(self, fail_codes: dict[str, int]) -> None:
        self.models = _FakeModels(fail_codes)
        self.aio = type("Aio", (), {"models": self.models})()


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


def test_open_stream_falls_back_when_primary_overloaded():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 503})
    response = asyncio.run(analyzer._open_stream(client, "contents"))
    assert response is not None

    calls = client.models.calls
    primary_calls = [c for c in calls if c == analyzer.DEFAULT_MODEL]
    # initial attempt + _PRIMARY_MAX_RETRIES retries, then the fallback wins.
    assert len(primary_calls) == analyzer._PRIMARY_MAX_RETRIES + 1
    assert calls[-1] == analyzer.DEFAULT_FALLBACK_MODELS[0]
    assert analyzer.DEFAULT_MODEL in analyzer._model_cooldown_until


def test_cooldown_skips_failed_model_on_next_call():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 503})
    asyncio.run(analyzer._open_stream(client, "first"))
    client.models.calls.clear()

    asyncio.run(analyzer._open_stream(client, "second"))
    assert analyzer.DEFAULT_MODEL not in client.models.calls
    assert client.models.calls == [analyzer.DEFAULT_FALLBACK_MODELS[0]]


def test_non_retryable_error_raises_without_fallback():
    client = _FakeClient({analyzer.DEFAULT_MODEL: 400})
    with pytest.raises(errors.APIError):
        asyncio.run(analyzer._open_stream(client, "contents"))
    assert client.models.calls == [analyzer.DEFAULT_MODEL]


def test_all_models_failing_still_raises_last_error():
    client = _FakeClient(
        {model: 503 for model in (analyzer.DEFAULT_MODEL, *analyzer.DEFAULT_FALLBACK_MODELS)}
    )
    with pytest.raises(errors.APIError):
        asyncio.run(analyzer._open_stream(client, "contents"))
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
