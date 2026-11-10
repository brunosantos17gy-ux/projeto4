// CyberSentinel v1.1 — dados em scenarios.js (carregado antes deste arquivo).
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const KEY = "cs_history";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loadHistory() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveHistory() { try { localStorage.setItem(KEY, JSON.stringify(completed.slice(0, 50))); } catch {} }

let completed = loadHistory();
let currentKey = "brute_force";
let investigations = 0;
let apiMode = "simulated";
let providerTag = "LOCAL";
let feedPaused = false;
let feedTotal = 0;
let answered = false;

const keys = Object.keys(SCENARIOS);
const sevClass = (s) => ({ "CRÍTICO": "high", "ALTO": "high", "MÉDIO": "medium", "BAIXO": "low" }[s] || "low");
const isDone = (id) => completed.some((r) => r.id === id);
const lastScore = (id) => (completed.find((r) => r.id === id) || {}).score;

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------- Navegação ---------- */
function showView(view) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const labels = { overview: "Visão geral", investigation: "Investigações", history: "Histórico", about: "Sobre o laboratório" };
  $("#breadcrumb").textContent = labels[view] || "Visão geral";
  if (view === "history") renderHistory();
  window.scrollTo(0, 0);
}
$$("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
$("#start-incident").addEventListener("click", () => {
  const next = keys.find((k) => !isDone(SCENARIOS[k].id)) || keys[0];
  startScenario(next);
});

/* ---------- Visão geral ---------- */
function renderIncidents() {
  $("#incident-list").innerHTML = keys.map((k) => {
    const s = SCENARIOS[k], c = sevClass(s.severity), done = isDone(s.id), sc = lastScore(s.id);
    return `<div class="incident-card ${done ? "subdued" : ""}">
      <div class="severity-bar ${c}"></div>
      <div class="incident-main">
        <div class="incident-title"><span class="severity-pill ${c}-pill">${s.severity}</span><span class="mono muted">${s.id}</span>
          ${done ? `<span class="done-tag">RESOLVIDO · ${sc}/100</span>` : `<span class="incident-time">${s.ago}</span>`}</div>
        <h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p>
        <div class="incident-meta"><span>⌁ ${esc(s.category)}</span><span>▣ ${esc(s.asset)}</span><span>◷ ${esc(s.facts[s.facts.length - 1][1])}</span></div>
      </div>
      <button class="icon-btn" data-open="${k}" title="Investigar" aria-label="Investigar ${esc(s.id)}">↗</button>
    </div>`;
  }).join("");
  $$("[data-open]").forEach((b) => b.addEventListener("click", () => startScenario(b.dataset.open)));
  $("#panel-count").textContent = `Exibindo ${keys.length} alertas demonstrativos`;
}

function updateStats() {
  const avg = completed.length ? Math.round(completed.reduce((a, b) => a + b.score, 0) / completed.length) : null;
  const active = keys.filter((k) => !isDone(SCENARIOS[k].id)).length;
  $("#metric-active").textContent = String(active).padStart(2, "0");
  $("#nav-active-count").textContent = String(active).padStart(2, "0");
  $("#metric-investigations").textContent = String(investigations).padStart(2, "0");
  $("#metric-score").textContent = avg === null ? "—" : avg;
  $("#ring-score").textContent = avg === null ? "—" : avg;
  $("#completed-count").textContent = completed.length;
  $("#best-score").textContent = completed.length ? Math.max(...completed.map((x) => x.score)) + "/100" : "—";
  $(".score-ring").style.background = avg === null
    ? "conic-gradient(#23405b 0 100%,#1a2a3c 0)"
    : `conic-gradient(#42bd91 0 ${avg}%,#1a2a3c ${avg}% 100%)`;
  $(".score-caption").textContent = avg === null
    ? "Sua pontuação aparecerá após concluir uma simulação."
    : `Média de ${completed.length} simulaç${completed.length === 1 ? "ão" : "ões"} registrada${completed.length === 1 ? "" : "s"}.`;
  renderIncidents();
}

/* ---------- Feed de eventos simulados ---------- */
function pushFeedEvent() {
  if (feedPaused) return;
  const [lvl, msg, who, ip] = FEED_POOL[Math.floor(Math.random() * FEED_POOL.length)];
  const list = $("#feed-list");
  const row = document.createElement("div");
  row.className = "feed-row new";
  const t = new Date().toLocaleTimeString("pt-BR");
  row.innerHTML = `<span class="mono muted">${t}</span><span class="feed-lvl lvl-${lvl.toLowerCase()}">${lvl}</span><span class="feed-msg">${esc(msg)}</span><span class="mono muted">${esc(who)} · ${esc(ip)}</span>`;
  list.prepend(row);
  while (list.children.length > 8) list.lastChild.remove();
  setTimeout(() => row.classList.remove("new"), 600);
  feedTotal++;
  $("#feed-count").textContent = `${feedTotal} eventos`;
}
$("#feed-toggle").addEventListener("click", () => {
  feedPaused = !feedPaused;
  $("#feed-toggle").textContent = feedPaused ? "▶ Retomar" : "❚❚ Pausar";
  $(".live-feed .live-tag").classList.toggle("paused", feedPaused);
});

/* ---------- Investigação ---------- */
function startScenario(key, navigate = true) {
  currentKey = key; answered = false;
  const s = SCENARIOS[key], c = sevClass(s.severity);
  $("#scenario-title").textContent = s.title;
  $("#scenario-id").textContent = s.id;
  $("#scenario-description").textContent = s.description;
  const pill = $("#scenario-severity");
  pill.className = `severity-pill ${c}-pill`; pill.textContent = `SEVERIDADE ${s.severity}`;
  $("#fact-grid").innerHTML = s.facts.map(([a, b]) => `<div><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join("");
  $("#log-rows").innerHTML = s.logs.map(([time, source, event, result]) => {
    const cls = result === "NEGADO" ? "log-fail" : result === "SUCESSO" ? "log-success" : "log-warn";
    return `<tr><td class="mono">${esc(time)}</td><td class="mono">${esc(source)}</td><td>${esc(event)}</td><td><span class="${cls}">${esc(result)}</span></td></tr>`;
  }).join("");
  $(".count-tag", $("#view-investigation")).textContent = `${String(s.logs.length).padStart(2, "0")} EVENTOS`;
  $("#decision-list").innerHTML = s.choices.map(([value, title, desc], i) =>
    `<label class="decision-option"><input type="radio" name="decision" value="${value}"><span class="option-letter">${"ABCD"[i]}</span><span><b>${esc(title)}</b><small>${esc(desc)}</small></span></label>`).join("");
  $$('input[name="decision"]').forEach((input) => input.addEventListener("change", () => {
    $("#submit-decision").disabled = false;
    $("#decision-hint").textContent = "Decisão selecionada. Registre para receber a avaliação.";
  }));
  $("#submit-decision").disabled = true;
  $("#decision-hint").textContent = "Selecione uma alternativa para registrar sua decisão.";
  $("#evaluation").classList.add("hidden"); $("#evaluation").classList.remove("bad");
  $("#chat-messages").innerHTML = "";
  addMessage("bot", `Estamos analisando: ${s.title}. Posso ajudar a interpretar as evidências e discutir uma resposta adequada. O que deseja investigar?`);
  $("#chat-mode-tag").textContent = providerTag;
  if (navigate) { investigations++; showView("investigation"); }
  updateStats();
}

function renderEvaluation(result, choice) {
  const { score, criteria, critical, text } = result;
  const ev = $("#evaluation");
  ev.classList.remove("hidden"); ev.classList.toggle("bad", score < 50);
  const title = critical ? "⚠ Falha crítica de procedimento" : score >= 70 ? "✓ Decisão bem fundamentada" : score >= 50 ? "◈ Decisão parcialmente adequada" : "⚠ Decisão inadequada";
  const bars = CRITERIA.map(([k, label]) => `<div class="crit"><div class="crit-top"><span>${label}</span><b>${criteria[k]}</b></div><div class="crit-bar"><i style="width:${criteria[k]}%"></i></div></div>`).join("");
  const nextKey = keys.find((k) => !isDone(SCENARIOS[k].id));
  ev.innerHTML = `<h3>${title}</h3><p>${esc(text)}</p>
    <div class="crit-grid">${bars}</div>
    <div class="score-line">PONTUAÇÃO NESTA ETAPA: ${score}/100${critical ? " · NOTA ZERADA POR FALHA CRÍTICA" : ""}</div>
    <div class="eval-actions"><button class="btn btn-secondary" id="retry">↺ Tentar novamente</button>
      ${nextKey ? `<button class="btn btn-primary" id="next-scenario">Próximo incidente →</button>` : `<button class="btn btn-primary" id="to-history">Ver desempenho →</button>`}</div>`;
  $("#retry").addEventListener("click", () => startScenario(currentKey, false));
  const n = $("#next-scenario"); if (n) n.addEventListener("click", () => startScenario(nextKey));
  const h = $("#to-history"); if (h) h.addEventListener("click", () => showView("history"));
  ev.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#submit-decision").addEventListener("click", () => {
  if (answered) return;
  const selected = $('input[name="decision"]:checked'); if (!selected) return;
  const s = SCENARIOS[currentKey];
  const result = evaluate(s, selected.value);
  answered = true;
  const title = (s.choices.find((c) => c[0] === selected.value) || [])[1] || selected.value;
  completed.unshift({ id: s.id, key: currentKey, title: s.title, score: result.score, criteria: result.criteria, critical: result.critical, choice: title, date: new Date().toLocaleString("pt-BR"), ts: Date.now() });
  saveHistory();
  $$('input[name="decision"]').forEach((i) => (i.disabled = true));
  $("#submit-decision").disabled = true;
  $("#decision-hint").textContent = "Avaliação concluída.";
  renderEvaluation(result, selected.value);
  updateStats(); toast("Avaliação registrada no histórico.");
});

/* ---------- Histórico, gráfico e relatório ---------- */
function chartSvg() {
  const pts = completed.slice(0, 12).reverse();
  if (pts.length < 2) return '<div class="chart-empty">Conclua ao menos 2 simulações para ver o gráfico de evolução.</div>';
  const W = 640, H = 170, L = 34, R = 12, T = 12, B = 22;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join("");
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4" class="${p.score >= 70 ? "ok" : p.score >= 50 ? "mid" : "bad"}"><title>${esc(p.id)} · ${p.score}/100</title></circle>`).join("");
  const labels = pts.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.id.slice(-3))}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução das pontuações">${grid}<path d="${line}" class="line"/>${dots}${labels}</svg>`;
}
function criteriaAverages() {
  const withC = completed.filter((r) => r.criteria);
  if (!withC.length) return "";
  return CRITERIA.map(([k, label]) => {
    const avg = Math.round(withC.reduce((a, r) => a + r.criteria[k], 0) / withC.length);
    return `<div class="crit"><div class="crit-top"><span>${label}</span><b>${avg}</b></div><div class="crit-bar"><i style="width:${avg}%"></i></div></div>`;
  }).join("");
}
function renderHistory() {
  $("#history-chart").innerHTML = chartSvg();
  $("#history-criteria").innerHTML = criteriaAverages() || '<div class="chart-empty">As médias por critério aparecem após a primeira simulação.</div>';
  const el = $("#history-list");
  $("#export-report").disabled = !completed.length;
  if (!completed.length) {
    el.innerHTML = '<div class="empty-state"><span>◷</span><b>Nenhuma simulação concluída</b><small>Conclua um incidente para visualizar seu histórico aqui.</small></div>';
    return;
  }
  el.innerHTML = completed.map((x) => `<div class="history-row"><div class="history-score">${x.score}<small style="font-size:8px;color:#77889d">/100</small></div><div><b>${esc(x.title)}</b><small>${esc(x.id)} · decisão: ${esc(x.choice)}${x.critical ? " · FALHA CRÍTICA" : ""}</small></div><time>${esc(x.date)}</time></div>`).join("");
}
$("#clear-history").addEventListener("click", () => {
  if (confirm("Deseja apagar o histórico salvo neste navegador?")) {
    completed = []; try { localStorage.removeItem(KEY); } catch {}
    updateStats(); renderHistory(); toast("Histórico limpo.");
  }
});
$("#export-report").addEventListener("click", () => {
  if (!completed.length) return;
  const avg = Math.round(completed.reduce((a, b) => a + b.score, 0) / completed.length);
  const rows = completed.slice().reverse().map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.choice)}</td><td><b>${r.score}</b>${r.critical ? " (falha crítica)" : ""}</td></tr>`).join("");
  $("#print-report").innerHTML = `<h1>CyberSentinel — Relatório de desempenho</h1>
    <p>Gerado em ${esc(new Date().toLocaleString("pt-BR"))} · Ambiente de treinamento com dados fictícios</p>
    <p><b>Simulações:</b> ${completed.length} &nbsp; <b>Média:</b> ${avg}/100 &nbsp; <b>Melhor:</b> ${Math.max(...completed.map((x) => x.score))}/100</p>
    <h2>Evolução</h2>${chartSvg()}<h2>Média por critério</h2>${criteriaAverages()}
    <h2>Decisões registradas</h2><table><thead><tr><th>Data</th><th>Incidente</th><th>Título</th><th>Decisão</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table>`;
  window.print();
});
$("#export-logs").addEventListener("click", () => {
  const s = SCENARIOS[currentKey];
  const csv = ["horario,origem,evento,resultado", ...s.logs.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${s.id}-evidencias.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast("Evidências exportadas em CSV.");
});

/* ---------- Chat ---------- */
function addMessage(role, text) {
  const div = document.createElement("div"); div.className = `chat-msg ${role}`;
  const name = document.createElement("span"); name.textContent = role === "bot" ? "Sentinel AI" : "Você";
  const p = document.createElement("p"); p.textContent = text; div.append(name, p);
  const box = $("#chat-messages"); box.append(div); box.scrollTop = box.scrollHeight;
  return div;
}
let chatBusy = false;
async function sendChat(message) {
  message = message.trim(); if (!message || chatBusy) return;
  chatBusy = true; $("#chat-input").value = "";
  addMessage("user", message);
  const loading = addMessage("bot", "Consultando o contexto...");
  const s = SCENARIOS[currentKey];
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, scenario: s.id, context: JSON.stringify({ title: s.title, description: s.description, facts: s.facts, logs: s.logs }) })
    });
    const data = await res.json();
    loading.remove();
    const reply = data.reply || (res.status === 422 ? "Mensagem inválida (vazia ou muito longa)." : "Não recebi uma resposta válida.");
    addMessage("bot", reply);
    $("#chat-mode-tag").textContent = data.mode === "ai" ? (data.provider || "IA").toUpperCase() : data.mode === "error" ? "ERRO" : "LOCAL";
  } catch {
    loading.remove();
    addMessage("bot", "Não consegui acessar o backend. Inicie o servidor FastAPI e tente novamente.");
  } finally { chatBusy = false; }
}
$("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat($("#chat-input").value); });
$$(".suggestions button").forEach((b) => b.addEventListener("click", () => sendChat(b.dataset.prompt)));

async function checkStatus() {
  try {
    const r = await fetch("/api/status"); const d = await r.json();
    apiMode = d.mode;
    providerTag = d.ai_configured ? (d.provider || "IA").toUpperCase() : "LOCAL";
    $("#api-label").textContent = d.ai_configured ? `${d.provider_label} conectado · ${d.model}` : "Modo demonstração · IA local";
    $("#api-pulse").style.background = d.ai_configured ? "#4ec99a" : "#e7b65d";
    $("#chat-mode-tag").textContent = providerTag;
  } catch {
    $("#api-label").textContent = "Backend não conectado";
    $("#api-pulse").style.background = "#f16b72";
  }
}

/* ---------- Zoom e guia ---------- */
const ZKEY = "cs_zoom", GKEY = "cs_guide_closed";
const autoZoom = () => { const w = window.innerWidth; return w < 1000 ? 1 : w < 1400 ? 1.2 : w < 1900 ? 1.35 : 1.55; };
function applyZoom(z) { document.documentElement.style.zoom = z; }
function getZoom() { try { const v = parseFloat(localStorage.getItem(ZKEY)); return v > 0 ? v : null; } catch { return null; } }
function setZoom(z) { z = Math.min(2, Math.max(0.8, Math.round(z * 100) / 100)); try { localStorage.setItem(ZKEY, z); } catch {} applyZoom(z); toast(`Tamanho: ${Math.round(z * 100)}%`); }
applyZoom(getZoom() || autoZoom());
$("#zoom-in").addEventListener("click", () => setZoom((getZoom() || autoZoom()) + 0.1));
$("#zoom-out").addEventListener("click", () => setZoom((getZoom() || autoZoom()) - 0.1));
$("#zoom-auto").addEventListener("click", () => { try { localStorage.removeItem(ZKEY); } catch {} applyZoom(autoZoom()); toast("Tamanho automático"); });
function closedGuide() { try { return localStorage.getItem(GKEY) === "1"; } catch { return false; } }
if (closedGuide()) $("#howto").classList.add("hidden");
$("#close-guide").addEventListener("click", () => { $("#howto").classList.add("hidden"); try { localStorage.setItem(GKEY, "1"); } catch {} });
$("#open-guide").addEventListener("click", () => { $("#howto").classList.remove("hidden"); try { localStorage.removeItem(GKEY); } catch {} showView("overview"); });

/* ---------- Inicialização ---------- */
startScenario("brute_force", false);   // prepara o cenário sem sair da visão geral
checkStatus();
for (let i = 0; i < 4; i++) pushFeedEvent();
setInterval(pushFeedEvent, 2800);
