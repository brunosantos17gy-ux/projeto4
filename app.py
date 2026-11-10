import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="CyberSentinel API", version="1.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Limite simples por IP para evitar gasto indevido de créditos da API.
RATE_LIMIT = int(os.getenv("CHAT_RATE_LIMIT", "20"))  # mensagens
RATE_WINDOW = 60  # segundos
_hits: dict[str, deque] = defaultdict(deque)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    scenario: Optional[str] = Field(default="INC-2026-001", max_length=40)
    context: Optional[str] = Field(default="", max_length=6000)


# Provedores de IA. Todos, exceto a xAI, usam o formato "chat/completions" (compatível com OpenAI).
# Os nomes de modelos gratuitos mudam com o tempo: use LLM_MODEL no .env para sobrescrever.
PROVIDERS = {
    "xai": {"label": "Grok (xAI)", "url": "https://api.x.ai/v1/responses", "key": "XAI_API_KEY", "model": "grok-4.7", "kind": "responses"},
    "groq": {"label": "Groq", "url": "https://api.groq.com/openai/v1/chat/completions", "key": "GROQ_API_KEY", "model": "openai/gpt-oss-120b", "kind": "chat"},
    "gemini": {"label": "Gemini", "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "key": "GEMINI_API_KEY", "model": "gemini-2.5-flash", "kind": "chat"},
    "openrouter": {"label": "OpenRouter", "url": "https://openrouter.ai/api/v1/chat/completions", "key": "OPENROUTER_API_KEY", "model": "google/gemma-4-31b-it:free", "kind": "chat"},
    "ollama": {"label": "Ollama (local)", "url": "http://localhost:11434/v1/chat/completions", "key": None, "model": "llama3.2", "kind": "chat"},
}


def active_provider() -> Optional[str]:
    """Escolhe o provedor: LLM_PROVIDER explícito, ou o primeiro que tiver chave no .env."""
    chosen = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if chosen in PROVIDERS:
        cfg = PROVIDERS[chosen]
        return chosen if (cfg["key"] is None or os.getenv(cfg["key"])) else None
    for name in ("xai", "groq", "gemini", "openrouter"):
        if os.getenv(PROVIDERS[name]["key"]):
            return name
    return None


def get_model(provider: Optional[str] = None) -> str:
    provider = provider or active_provider() or "xai"
    return os.getenv("LLM_MODEL") or (os.getenv("XAI_MODEL") if provider == "xai" else None) or PROVIDERS[provider]["model"]


def rate_limited(client_id: str) -> bool:
    now = time.time()
    q = _hits[client_id]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/status")
def status():
    prov = active_provider()
    return {
        "ok": True,
        "ai_configured": prov is not None,
        "provider": prov,
        "provider_label": PROVIDERS[prov]["label"] if prov else None,
        "model": get_model(prov) if prov else None,
        "mode": "ai" if prov else "simulated",
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request):
    client_id = request.client.host if request.client else "local"
    if rate_limited(client_id):
        return JSONResponse(
            status_code=429,
            content={"mode": "error", "reply": "Muitas mensagens em pouco tempo. Aguarde alguns segundos."},
        )

    prov = active_provider()
    if not prov:
        return {"mode": "simulated", "reply": local_reply(payload.message, payload.scenario)}
    cfg = PROVIDERS[prov]

    system_prompt = (
        "Você é o CyberSentinel, um instrutor de resposta a incidentes de segurança. "
        "Ajude um estudante em um laboratório acadêmico totalmente fictício. "
        "Analise somente os dados fornecidos, diferencie fatos de hipóteses, "
        "priorize preservação de evidências, contenção proporcional, erradicação e recuperação. "
        "Não afirme que ações foram executadas. Não forneça instruções para invadir sistemas, "
        "roubar credenciais, persistir ou ocultar atividades. Responda em português brasileiro, "
        "com clareza, em até 110 palavras, em 2 ou 3 parágrafos curtos, em texto simples: "
        "NÃO use markdown, asteriscos, títulos, tabelas ou listas numeradas longas."
    )
    user_content = (
        f"Cenário: {payload.scenario}\n"
        f"Contexto do laboratório: {payload.context}\n"
        f"Pergunta do analista: {payload.message}"
    )
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}]
    headers = {"Authorization": f"Bearer {os.getenv(cfg['key'])}"} if cfg["key"] else {}
    # Modelos com raciocínio gastam tokens "pensando"; 1500 evita resposta vazia.
    if cfg["kind"] == "responses":
        body = {"model": get_model(prov), "input": messages, "max_output_tokens": 1500}
    else:
        body = {"model": get_model(prov), "messages": messages, "max_tokens": 1500}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(cfg["url"], headers=headers, json=body)
            response.raise_for_status()
            data = response.json()
            reply = extract_text(data) if cfg["kind"] == "responses" else extract_chat_text(data)
            if not reply:
                raise ValueError("A API retornou uma resposta sem texto.")
            return {"mode": "ai", "provider": prov, "reply": clean_markdown(reply)}
    except httpx.HTTPStatusError as exc:
        # Não repassa o corpo bruto da resposta ao navegador (veja o terminal para detalhes).
        code = exc.response.status_code
        print(f"[CyberSentinel] {cfg['label']} HTTP {code}: {exc.response.text[:300]}")
        hint = {
            400: "Requisição recusada: confira a chave e o nome do modelo (LLM_MODEL).",
            401: "Chave inválida.",
            403: "Chave sem permissão para este modelo.",
            404: "Modelo não encontrado. Confira LLM_MODEL.",
            429: "Limite de uso atingido. Aguarde um pouco ou confira os créditos.",
        }.get(code, "Erro no serviço.")
        return {"mode": "error", "reply": f"{cfg['label']} retornou HTTP {code}. {hint}"}
    except httpx.ConnectError:
        extra = " Verifique se o Ollama está aberto." if prov == "ollama" else ""
        return {"mode": "error", "reply": f"Não consegui conectar a {cfg['label']}.{extra}"}
    except Exception as exc:
        return {"mode": "error", "reply": f"Não foi possível consultar a IA: {str(exc)[:200]}"}


def clean_markdown(text: str) -> str:
    """Remove símbolos de markdown que o chat não renderiza (**negrito**, # títulos, `código`)."""
    text = re.sub(r"```[a-zA-Z]*\n?", "", text).replace("```", "")
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text, flags=re.S)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    text = re.sub(r"(?m)^\s*[*\-•]\s+", "• ", text)
    text = re.sub(r"(?<!\w)\*(\S[^*\n]*?)\*(?!\w)", r"\1", text)
    text = text.replace("`", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_chat_text(data: dict) -> str:
    try:
        return (data["choices"][0]["message"].get("content") or "").strip()
    except (KeyError, IndexError, TypeError, AttributeError):
        return ""


def extract_text(data: dict) -> str:
    parts = [
        part.get("text", "")
        for item in data.get("output", [])
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text"
    ]
    return "\n".join(parts).strip()


# Respostas locais (modo demonstração) por cenário.
LOCAL = {
    "INC-2026-001": {
        "prioridade": "A prioridade é confirmar se o login administrativo foi legítimo. Preserve os logs, verifique origem e horário do acesso e, se houver comprometimento, revogue sessões e redefina a credencial.",
        "log": "Há falhas repetidas seguidas de um login bem-sucedido na conta administrativa e de um alerta de privilégio. Isso sugere possível força bruta com êxito, mas ainda é hipótese: correlacione com o histórico da conta.",
        "origem": "O IP de origem é um indicador, não prova. Compare com o histórico de acessos da conta, reputação e outros eventos do mesmo horário. Neste laboratório, todos os endereços são fictícios.",
        "acao": "Valide o alerta e preserve evidências primeiro. Se o acesso for confirmado como indevido, contenha conta e sessão, avalie o impacto e ative MFA.",
        "padrao": "Trate o alerta como suspeito: correlacione logs, valide a legitimidade do acesso, determine o escopo e documente cada decisão.",
    },
    "INC-2026-002": {
        "prioridade": "Identifique qual processo gera as consultas DNS na WS-014 e para onde vão. O volume é um indicador, não confirmação de malware; evite concluir antes de correlacionar.",
        "log": "Os logs mostram repetição de consultas, um domínio novo e uma conexão de saída pendente. Isso é compatível com comunicação automatizada, mas também com software legítimo mal configurado.",
        "origem": "A origem é a estação 10.0.0.24 (WS-014). Verifique o processo, o usuário logado e o histórico da máquina antes de qualquer contenção.",
        "acao": "Colete evidências (DNS, processo, tráfego) e só então avalie restringir a comunicação de forma temporária e proporcional.",
        "padrao": "Correlacione DNS, processo responsável, destino e linha do tempo. Registre hipóteses antes de classificar o incidente.",
    },
    "INC-2026-003": {
        "prioridade": "Confirme se a mudança na regra do FW-02 foi autorizada. A porta 8443 liberada fora da janela cria exposição potencial que precisa ser avaliada.",
        "log": "A regra foi alterada e salva sem solicitação de mudança agendada. Sucesso técnico não significa autorização: consulte a trilha de auditoria.",
        "origem": "O autor aparece como admin-local. Confirme com o responsável e compare a configuração atual com o baseline.",
        "acao": "Valide com quem fez a mudança e, se não houver autorização, faça rollback controlado e documentado.",
        "padrao": "Compare a configuração com o baseline, confirme autoria e autorização e avalie a exposição criada.",
    },
    "INC-2026-004": {
        "prioridade": "Há 3 cliques e um envio de formulário nos logs do proxy, então credenciais podem estar expostas. Priorize identificar quem clicou, revogar sessões e redefinir senhas, guardando uma cópia da mensagem.",
        "log": "A mensagem foi entregue a 12 caixas, houve acesso ao domínio suspeito e um POST logo depois. O POST é o indício mais importante: sugere envio de dados em um formulário falso.",
        "origem": "O remetente e o domínio são indicadores. Verifique os cabeçalhos (SPF, DKIM, DMARC) e pesquise se o domínio aparece em outros eventos. Todos os endereços aqui são fictícios.",
        "acao": "Remova a mensagem das caixas depois de preservar uma cópia, bloqueie o domínio no proxy e redefina as credenciais de quem interagiu.",
        "padrao": "Preserve a mensagem original, identifique quem clicou e quem enviou dados, e contenha as contas afetadas.",
    },
    "INC-2026-005": {
        "prioridade": "A taxa de alterações está crescendo, então o tempo é crítico: isole o FS-01 da rede mantendo-o ligado para preservar memória e logs. Depois investigue o processo e verifique outros hosts.",
        "log": "Renomeação em massa, nova extensão e um processo desconhecido gravando no compartilhamento formam um padrão compatível com cifragem maliciosa. Ainda é hipótese a ser confirmada.",
        "origem": "Identifique o processo e a conta que o executa no EDR e verifique de onde veio o acesso. Ainda não há dados para afirmar o vetor de entrada.",
        "acao": "Isole o servidor da rede sem desligar, acione o plano de resposta, valide a integridade do último backup (02:00) e só restaure após entender a causa.",
        "padrao": "Contenha a propagação primeiro, preserve evidências voláteis, verifique outros hosts e valide os backups antes de restaurar.",
    },
}

TOPICS = [
    ("prioridade", r"priorid|primeir|come[cç]o|o que fa[cç]o|agir|foco"),
    ("log", r"\blogs?\b|registro|evento|evid[eê]ncia"),
    ("origem", r"\bip\b|origem|endere[cç]o|quem|autor"),
    ("acao", r"conter|conten[cç][aã]o|isolar|bloquear|revogar|a[cç][aã]o|resposta|decis"),
]


def local_reply(message: str, scenario: Optional[str] = None) -> str:
    answers = LOCAL.get(scenario or "", LOCAL["INC-2026-001"])
    text = message.lower()
    for key, pattern in TOPICS:
        if re.search(pattern, text):
            return answers[key]
    return answers["padrao"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
