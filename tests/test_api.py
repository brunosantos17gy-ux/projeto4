import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
import pytest
from fastapi.testclient import TestClient

import app as cs

client = TestClient(cs.app)


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    cs._hits.clear()
    for v in ("XAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "LLM_PROVIDER", "LLM_MODEL", "XAI_MODEL"):
        monkeypatch.delenv(v, raising=False)


def test_home_and_static():
    assert client.get("/").status_code == 200
    assert client.get("/static/app.js").status_code == 200


def test_status_simulated():
    d = client.get("/api/status").json()
    assert d["mode"] == "simulated" and d["ai_configured"] is False


def test_status_with_key(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-teste")
    d = client.get("/api/status").json()
    assert d["mode"] == "ai" and d["provider"] == "xai" and d["model"] == "grok-4.7"


def test_chat_validation():
    assert client.post("/api/chat", json={"message": ""}).status_code == 422
    assert client.post("/api/chat", json={"message": "x" * 2001}).status_code == 422


def test_local_reply_is_scenario_aware():
    a = cs.local_reply("qual a prioridade?", "INC-2026-001")
    b = cs.local_reply("qual a prioridade?", "INC-2026-002")
    assert a != b and "DNS" in b


def test_priority_question_not_matched_as_ip():
    # "principal" contém "ip": não pode cair na resposta sobre IP
    r = cs.local_reply("qual a prioridade principal?", "INC-2026-001")
    assert "IP de origem" not in r


def test_unknown_scenario_falls_back():
    assert cs.local_reply("oi", "INC-XXXX")


def test_extract_text_joins_with_real_newline():
    data = {"output": [{"type": "reasoning"}, {"type": "message", "content": [
        {"type": "output_text", "text": "linha 1"}, {"type": "output_text", "text": "linha 2"}]}]}
    assert cs.extract_text(data) == "linha 1\nlinha 2"


class FakeResp:
    def __init__(self, code=200, body=None):
        self.status_code, self._b = code, body or {}
        self.text = "segredo-interno"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("x", request=None, response=self)

    def json(self):
        return self._b


def fake_client(resp):
    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            C.sent = k["json"]
            return resp
    return C


def test_grok_success(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-teste")
    body = {"output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}]}
    C = fake_client(FakeResp(200, body))
    monkeypatch.setattr(cs.httpx, "AsyncClient", C)
    r = client.post("/api/chat", json={"message": "oi"}).json()
    assert r == {"mode": "ai", "provider": "xai", "reply": "ok"}
    assert "temperature" not in C.sent and C.sent["max_output_tokens"] >= 1000


def test_grok_http_error_does_not_leak_body(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-teste")
    monkeypatch.setattr(cs.httpx, "AsyncClient", fake_client(FakeResp(404)))
    r = client.post("/api/chat", json={"message": "oi"}).json()
    assert r["mode"] == "error" and "404" in r["reply"] and "segredo-interno" not in r["reply"]


def test_grok_empty_reply_is_error(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-teste")
    monkeypatch.setattr(cs.httpx, "AsyncClient", fake_client(FakeResp(200, {"output": []})))
    assert client.post("/api/chat", json={"message": "oi"}).json()["mode"] == "error"


def test_rate_limit(monkeypatch):
    monkeypatch.setattr(cs, "RATE_LIMIT", 3)
    codes = [client.post("/api/chat", json={"message": "oi"}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def chat_body(text):
    return {"choices": [{"message": {"content": text}}]}


@pytest.mark.parametrize("env,provider", [("GROQ_API_KEY", "groq"), ("GEMINI_API_KEY", "gemini"), ("OPENROUTER_API_KEY", "openrouter")])
def test_free_providers_chat_completions(monkeypatch, env, provider):
    monkeypatch.setenv(env, "chave-teste")
    C = fake_client(FakeResp(200, chat_body("resposta livre")))
    monkeypatch.setattr(cs.httpx, "AsyncClient", C)
    r = client.post("/api/chat", json={"message": "oi"}).json()
    assert r == {"mode": "ai", "provider": provider, "reply": "resposta livre"}
    assert "messages" in C.sent and "input" not in C.sent


def test_llm_model_override(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("LLM_MODEL", "meu-modelo")
    assert client.get("/api/status").json()["model"] == "meu-modelo"


def test_ollama_needs_no_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    assert client.get("/api/status").json()["provider"] == "ollama"


def test_explicit_provider_without_key_falls_back(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    assert client.get("/api/status").json()["mode"] == "simulated"


def test_chat_completions_empty_is_error(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(cs.httpx, "AsyncClient", fake_client(FakeResp(200, {"choices": []})))
    assert client.post("/api/chat", json={"message": "oi"}).json()["mode"] == "error"


def test_clean_markdown():
    raw = "**Prioridade**: veja os logs.\n\n## Passos\n- Preservar `logs`\n* Conter a conta\n\n\n\nFim *importante*."
    out = cs.clean_markdown(raw)
    assert "*" not in out.replace("• ", "") and "#" not in out and "`" not in out
    assert out.startswith("Prioridade: veja os logs.") and "• Preservar logs" in out and "\n\n\n" not in out


def test_provider_reply_is_cleaned(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(cs.httpx, "AsyncClient", fake_client(FakeResp(200, chat_body("**Olá** mundo"))))
    assert client.post("/api/chat", json={"message": "oi"}).json()["reply"] == "Olá mundo"
