# CyberSentinel — Simulador de Incidentes (v1.1)

Central de operações de segurança (SOC) **totalmente simulada** para treinamento: 5 cenários fictícios, análise de logs, decisão, avaliação por critérios, gráfico de desempenho, relatório em PDF e assistente de IA (Groq, Gemini, OpenRouter, Ollama ou Grok — opcional).

## Executar no Windows
```powershell
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # opcional: coloque XAI_API_KEY=... no .env
uvicorn app:app --reload
```
Acesse http://127.0.0.1:8000. Sem chave, o chat usa respostas locais por cenário.

## IA gratuita (opcional)
Edite o `.env` e preencha **uma** chave: `GROQ_API_KEY` (console.groq.com), `GEMINI_API_KEY` (aistudio.google.com) ou `OPENROUTER_API_KEY` (openrouter.ai). Todos têm plano gratuito sem cartão. Também funciona `XAI_API_KEY` (Grok, pago) ou `LLM_PROVIDER=ollama` (IA local no seu PC). Reinicie o servidor; o topo da tela mostra o provedor conectado. Se o modelo padrão deixar de existir, defina `LLM_MODEL`.

## Testes
```powershell
pip install pytest
python -m pytest -q tests
```

## Roteiro de demonstração (≈ 5 min)
1. **Visão geral**: mostre o feed de eventos ao vivo e a fila de 5 incidentes.
2. **INC-2026-001**: abra, leia os logs, pergunte ao Sentinel AI "qual a prioridade?".
3. Escolha **apagar os registros** de propósito → nota 0 por falha crítica (mostra o critério de evidências).
4. Clique em **Tentar novamente** e escolha a opção correta → barras por critério.
5. **INC-2026-005 (ransomware)**: a melhor resposta é *conter primeiro* — mostra que a decisão depende do contexto.
6. **Histórico**: gráfico de evolução, média por critério e **Relatório (PDF)** (use "Salvar como PDF" na impressão).

## Avaliação
Quatro critérios: evidências (30%), análise (30%), contenção (25%), registro (15%). Ações destrutivas ou de ignorar o alerta zeram a nota.

## Segurança e escopo
Todos os dados são fictícios. Nada é executado em redes ou servidores reais. As chaves de IA ficam só no backend (`.env`); o chat tem limite de 20 mensagens/min por IP (`CHAT_RATE_LIMIT`).

## Estrutura
- `app.py` — API FastAPI, chat local e integração xAI (Responses API)
- `static/scenarios.js` — cenários, rubrica e eventos do feed
- `static/app.js` — interface, avaliação, gráfico, relatório
- `tests/test_api.py` — testes do backend
