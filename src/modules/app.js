import {
  addError,
  addCustomDeck,
  addManualFlashcard,
  addOutsideStudy,
  addSimulation,
  addStudySession,
  answerFlashcard,
  completeLesson,
  completeReview,
  flashcardFromError,
  getDerived,
  logAnki,
  markErrorImportant,
  reopenLesson,
  runAutomations,
  saveWeeklyBoard,
  saveTimerSession
} from "./engine.js";
import { exportState, importState, loadState, resetState, saveState } from "./storage.js";
import { fmtDate, scoreLabel, todayISO } from "./utils.js";

const views = [
  ["today", "Hoje", "◌"],
  ["schedule", "Cronograma", "▦"],
  ["questions", "Simulados e Questões", "◫"],
  ["errors", "Caderno de Erros", "!"],
  ["flashcards", "Flashcards", "◧"],
  ["anki", "Anki", "A"],
  ["dashboard", "Dashboard", "▣"],
  ["timer", "Cronômetro", "◷"],
  ["settings", "Backup", "⚙"]
];

let seed = [];
let state;
let currentView = "today";
let timer = null;
let timerTick = null;
let selectedWeek = "";

const $ = (selector) => document.querySelector(selector);
const viewEl = $("#view");
const titleEl = $("#viewTitle");
const modal = $("#modal");
const modalContent = $("#modalContent");

init();

async function init() {
  let response = await fetch("./data/cronograma.json");
  if (!response.ok) response = await fetch("./public/data/cronograma.json");
  const data = await response.json();
  seed = data.items;
  state = runAutomations(loadState(seed));
  selectedWeek = getCurrentWeekKey(state.schedule, todayISO());
  document.body.dataset.theme = state.preferences.theme;
  renderNav();
  bindShell();
  persistRender();
}

function bindShell() {
  $("#themeToggle").addEventListener("click", () => {
    state.preferences.theme = state.preferences.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = state.preferences.theme;
    persistRender();
  });
  $("#quickSessionBtn").addEventListener("click", () => openSessionModal());
  $("#globalSearch").addEventListener("input", () => render());
}

function renderNav() {
  $("#nav").innerHTML = views
    .map(([id, label, icon]) => `<button class="${id === currentView ? "active" : ""}" data-view="${id}"><span>${icon}</span>${label}</button>`)
    .join("");
  $("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    currentView = button.dataset.view;
    renderNav();
    render();
  });
}

function persistRender() {
  saveState(state);
  render();
}

function render() {
  state = runAutomations(state);
  const derived = getDerived(state);
  $("#streakMini").textContent = `${state.anki.streak} dias`;
  titleEl.textContent = views.find(([id]) => id === currentView)?.[1] || "Hoje";
  renderAlerts(derived.alerts);
  const renderer = {
    today: renderToday,
    schedule: renderScheduleV2,
    questions: renderQuestionsV2,
    errors: renderErrors,
    flashcards: renderFlashcardsV2,
    anki: renderAnki,
    dashboard: renderDashboardV2,
    timer: renderTimer,
    settings: renderSettings
  }[currentView];
  viewEl.innerHTML = renderer(derived);
  bindViewV2();
}

function renderAlerts(alerts) {
  $("#alerts").innerHTML = alerts
    .slice(0, 4)
    .map((alert) => `<div class="alert ${alert.tone}"><span></span>${alert.text}</div>`)
    .join("");
}

function renderToday(d) {
  return `
    <div class="grid metrics">
      ${metric("Progresso geral", `${d.progress}%`, "Cronograma importado")}
      ${metric("Acurácia", `${d.accuracy}%`, `${d.totalCorrect}/${d.totalQuestions} questões`)}
      ${metric("Horas", `${d.hours}h`, "tempo registrado")}
      ${metric("Pendências", d.dueReviews.length + d.dueCards.length + d.pendingErrors.length, "revisões, cards e erros")}
    </div>
    <div class="today-layout">
      <section class="panel">
        <div class="section-title"><h2>Tarefas do dia</h2><span>${fmtDate(d.now)}</span></div>
        ${taskList(d.todayLessons, "lesson")}
      </section>
      <section class="panel anki-panel">
        <div class="section-title"><h2>Anki obrigatório</h2><span>${state.anki.streak} dias de streak</span></div>
        <p class="muted">Reviews do dia, cards sustentáveis e cards dos erros relevantes.</p>
        <div class="anki-meter"><strong>${state.anki.totalMinutes}</strong><span>min acumulados</span></div>
        <button class="primary-button full" data-action="log-anki">Registrar Anki de hoje</button>
      </section>
      <section class="panel">
        <div class="section-title"><h2>Revisões automáticas</h2><span>${d.dueReviews.length} vencidas</span></div>
        ${reviewList(d.dueReviews)}
      </section>
      <section class="panel">
        <div class="section-title"><h2>Flashcards pendentes</h2><span>${d.dueCards.length} cards</span></div>
        ${cardQueue(d.dueCards.slice(0, 5))}
      </section>
      <section class="panel wide">
        <div class="section-title"><h2>Atrasos e pontos fracos</h2><span>priorização automática</span></div>
        <div class="split">
          ${taskList(d.overdueLessons.slice(0, 6), "lesson")}
          ${weakList(d.weakSubjects, "Matérias frágeis")}
        </div>
      </section>
    </div>`;
}

function renderSchedule(d) {
  const q = searchTerm();
  const filtered = state.schedule
    .filter((item) => matches(item, q))
    .sort((a, b) => a.date.localeCompare(b.date));
  const weeks = groupScheduleByWeek(filtered);
  return `
    <div class="toolbar">
      <span>${weeks.length} semanas · ${filtered.length} aulas visíveis · ${d.overdueLessons.length} atrasadas · ${d.completed.length} concluídas</span>
      <button class="secondary-button" data-action="goto-backlog">Ver atrasos</button>
    </div>
    <div class="weekly-schedule">
      ${weeks.map(([week, items]) => scheduleWeekSection(week, items, d.now)).join("") || empty("Nenhuma aula encontrada.")}
    </div>`;
}

function renderQuestions(d) {
  return `
    <div class="grid metrics">
      ${metric("Questões", d.totalQuestions, "total registrado")}
      ${metric("Acertos", `${d.accuracy}%`, "taxa acumulada")}
      ${metric("Sessões", state.sessions.length, "blocos feitos")}
      ${metric("Simulados", state.simulations.length, "comparados")}
    </div>
    <div class="two-col">
      <section class="panel">${formSession()}</section>
      <section class="panel">${formSimulation()}</section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>Histórico recente</h2><span>evolução temporal</span></div>
      ${historyList([...state.sessions, ...state.simulations].slice(-10).reverse())}
    </section>`;
}

function renderErrors(d) {
  return `
    <div class="two-col">
      <section class="panel">${formError()}</section>
      <section class="panel">${weakList(d.weakSystems, "Sistemas fracos")}</section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>Banco inteligente de erros</h2><span>${d.pendingErrors.length} pendentes</span></div>
      <div class="cards-list">
        ${state.errors
          .slice()
          .reverse()
          .map(errorCard)
          .join("") || empty("Nenhum erro registrado ainda.")}
      </div>
    </section>`;
}

function renderFlashcards(d) {
  return `
    <div class="grid metrics">
      ${metric("Total", d.flashcardStats.total, "cards criados")}
      ${metric("Pendentes", d.flashcardStats.due, "fila de hoje")}
      ${metric("Difíceis", d.flashcardStats.hard, "prioridade alta")}
      ${metric("Vencidos", d.flashcardStats.overdue, "atrasados")}
    </div>
    <section class="panel">
      <div class="section-title"><h2>Fila de revisão</h2><span>difíceis primeiro</span></div>
      ${cardQueue(d.dueCards)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>Baralhos</h2><span>${state.flashcards.length} cards</span></div>
      <div class="cards-list">${state.flashcards.map(deckCard).join("") || empty("Os flashcards serão criados a partir dos erros.")}</div>
    </section>`;
}

function renderAnki() {
  return `
    <div class="two-col">
      <section class="panel anki-panel">
        <div class="section-title"><h2>Anki obrigatório</h2><span>preparado para AnkiConnect</span></div>
        <div class="anki-meter"><strong>${state.anki.streak}</strong><span>dias seguidos</span></div>
        <button class="primary-button full" data-action="log-anki">Registrar sessão Anki</button>
      </section>
      <section class="panel">
        <div class="section-title"><h2>Histórico</h2><span>${state.anki.totalMinutes} minutos</span></div>
        ${state.anki.logs
          .slice(-14)
          .reverse()
          .map((log) => `<div class="list-row"><strong>${fmtDate(log.date)}</strong><span>${log.minutes} min · ${log.reviews} reviews</span></div>`)
          .join("") || empty("Sem registros de Anki.")}
      </section>
    </div>`;
}

function renderDashboard(d) {
  return `
    <div class="grid metrics">
      ${metric("Progresso", `${d.progress}%`, "geral")}
      ${metric("Revisões", d.dueReviews.length, "vencidas")}
      ${metric("Cards", d.flashcardStats.due, "pendentes")}
      ${metric("Erros", state.errors.length, "registrados")}
    </div>
    <div class="dashboard-grid">
      <section class="panel wide">
        <div class="section-title"><h2>Tendência de desempenho</h2><span>${scoreLabel(d.accuracy)}</span></div>
        ${lineChart(d.trend)}
      </section>
      <section class="panel">${barList(d.subjectProgress, "Progresso por matéria")}</section>
      <section class="panel">${weakList(d.weakSubjects, "Ranking de fraqueza")}</section>
      <section class="panel">${barPairs(d.errorsBySystem, "Erros por sistema")}</section>
      <section class="panel">${heatmap(state.sessions)}</section>
      <section class="panel">${simulationCompare()}</section>
    </div>`;
}

function renderTimer() {
  return `
    <section class="panel timer-panel">
      <div class="timer-display" id="timerDisplay">${timer ? elapsed(timer.startedAt) : "00:00:00"}</div>
      <form id="timerForm" class="form compact">
        <input name="subject" placeholder="Matéria" value="${timer?.subject || ""}" ${timer ? "disabled" : ""} />
        <input name="system" placeholder="Sistema" value="${timer?.system || ""}" ${timer ? "disabled" : ""} />
        <input name="topic" placeholder="Tema" value="${timer?.topic || ""}" ${timer ? "disabled" : ""} />
        <button class="${timer ? "danger-button" : "primary-button"}" type="submit">${timer ? "Finalizar e salvar" : "Iniciar cronômetro"}</button>
      </form>
    </section>`;
}

function renderSettings() {
  return `
    <section class="panel">
      <div class="section-title"><h2>Persistência e backup</h2><span>localStorage + JSON</span></div>
      <div class="backup-actions">
        <button class="primary-button" data-action="export">Exportar JSON</button>
        <label class="secondary-button">Importar JSON<input id="importFile" type="file" accept="application/json" hidden /></label>
        <button class="danger-button" data-action="reset">Restaurar base limpa</button>
      </div>
      <p class="muted">Tudo é salvo automaticamente: cronograma, revisões, simulados, erros, flashcards, sessões, estatísticas, preferências e histórico.</p>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Integração futura</h2><span>AnkiConnect</span></div>
      <p class="muted">O módulo de Anki já separa logs, streak e pendências. A próxima etapa natural é conectar localhost:8765 via AnkiConnect para sincronizar reviews reais.</p>
    </section>`;
}

function bindView() {
  viewEl.querySelectorAll("[data-complete-lesson]").forEach((button) =>
    button.addEventListener("click", () => {
      state = completeLesson(state, button.dataset.completeLesson);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-toggle-lesson]").forEach((input) =>
    input.addEventListener("change", () => {
      state = input.checked ? completeLesson(state, input.dataset.toggleLesson) : reopenLesson(state, input.dataset.toggleLesson);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-complete-review]").forEach((button) =>
    button.addEventListener("click", () => {
      state = completeReview(state, button.dataset.completeReview);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-card]").forEach((button) =>
    button.addEventListener("click", () => {
      state = answerFlashcard(state, button.dataset.card, button.dataset.rating);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-flash-error]").forEach((button) =>
    button.addEventListener("click", () => {
      state = flashcardFromError(state, button.dataset.flashError);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-important-error]").forEach((button) =>
    button.addEventListener("click", () => {
      state = markErrorImportant(state, button.dataset.importantError);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
  $("#sessionForm")?.addEventListener("submit", handleSessionSubmit);
  $("#simulationForm")?.addEventListener("submit", handleSimulationSubmit);
  $("#errorForm")?.addEventListener("submit", handleErrorSubmit);
  $("#timerForm")?.addEventListener("submit", handleTimerSubmit);
  $("#importFile")?.addEventListener("change", handleImport);
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "log-anki") openAnkiModal();
  if (action === "export") exportState(state);
  if (action === "reset" && confirm("Restaurar a base inicial e apagar seus registros locais?")) {
    state = resetState(seed);
    persistRender();
  }
  if (action === "goto-backlog") $("#globalSearch").value = "Atrasado";
}

function handleSessionSubmit(event) {
  event.preventDefault();
  state = addStudySession(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handleSimulationSubmit(event) {
  event.preventDefault();
  state = addSimulation(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handleErrorSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  payload.important = event.currentTarget.important.checked;
  state = addError(state, payload);
  event.currentTarget.reset();
  persistRender();
}

function handleTimerSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (!timer) {
    timer = { ...payload, startedAt: new Date().toISOString() };
    timerTick = setInterval(() => $("#timerDisplay") && ($("#timerDisplay").textContent = elapsed(timer.startedAt)), 1000);
  } else {
    timer.endedAt = new Date().toISOString();
    clearInterval(timerTick);
    state = saveTimerSession(state, timer);
    timer = null;
  }
  persistRender();
}

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  state = await importState(file, seed);
  persistRender();
}

function openSessionModal() {
  modalContent.innerHTML = `<section class="panel modal-panel">${formSession()}</section>`;
  modal.showModal();
  $("#sessionForm").addEventListener("submit", (event) => {
    handleSessionSubmit(event);
    modal.close();
  });
}

function openAnkiModal() {
  modalContent.innerHTML = `
    <section class="panel modal-panel">
      <div class="section-title"><h2>Registrar Anki</h2><span>obrigatório diário</span></div>
      <form id="ankiForm" class="form">
        <input name="minutes" type="number" min="1" placeholder="Minutos" required />
        <input name="reviews" type="number" min="0" placeholder="Reviews concluídos" />
        <button class="primary-button" type="submit">Salvar Anki</button>
      </form>
    </section>`;
  modal.showModal();
  $("#ankiForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state = logAnki(state, data.minutes, data.reviews);
    modal.close();
    persistRender();
  });
}

function metric(label, value, hint) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`;
}

function taskList(items, type) {
  if (!items.length) return empty("Nada pendente aqui.");
  return `<div class="cards-list">${items
    .map(
      (item) => `<article class="task-card ${item.movedToBacklog ? "late" : ""}">
        <div><strong>${item.medcofClass || item.stepClass || item.dailyFocus}</strong><span>${fmtDate(item.date)} · ${item.area || item.stepSystem}</span></div>
        <p>${item.minimumTask || item.normalPlan}</p>
        ${type === "lesson" && !item.completed ? `<button class="secondary-button" data-complete-lesson="${item.id}">Concluir</button>` : ""}
      </article>`
    )
    .join("")}</div>`;
}

function reviewList(items) {
  if (!items.length) return empty("Nenhuma revisão vencida.");
  return `<div class="cards-list">${items
    .map(
      (item) => `<article class="task-card">
        <div><strong>${item.title}</strong><span>${fmtDate(item.dueDate)} · ${item.subject || item.system}</span></div>
        <button class="secondary-button" data-complete-review="${item.id}">Revisão feita</button>
      </article>`
    )
    .join("")}</div>`;
}

function cardQueue(cards) {
  if (!cards.length) return empty("Nenhum card pendente agora.");
  return `<div class="cards-list">${cards
    .map(
      (card) => `<article class="flash-card ${card.difficulty}">
        <div><strong>${card.front}</strong><span>${card.deck} · ${fmtDate(card.nextReview)}</span></div>
        <p>${card.back}</p>
        <div class="button-row">
          <button data-card="${card.id}" data-rating="hard" class="danger-button">Difícil</button>
          <button data-card="${card.id}" data-rating="medium" class="secondary-button">Médio</button>
          <button data-card="${card.id}" data-rating="easy" class="primary-button">Fácil</button>
        </div>
      </article>`
    )
    .join("")}</div>`;
}

function scheduleRow(item) {
  return `<tr class="${item.movedToBacklog ? "late-row" : ""}">
    <td>
      <label class="done-toggle">
        <input type="checkbox" data-toggle-lesson="${item.id}" ${item.completed ? "checked" : ""} />
        <span>${item.completed ? "Feito" : "Não feito"}</span>
      </label>
    </td>
    <td>${fmtDate(item.date)}</td>
    <td>${item.area}</td>
    <td>${item.medcofClass}</td>
    <td>${item.stepClass}<br><small>${item.stepSystem}</small></td>
    <td><span class="pill">${item.medcofPriority || item.monthlyPriority}</span></td>
    <td>${item.status}</td>
  </tr>`;
}

function scheduleWeekSection(week, items, now) {
  const done = items.filter((item) => item.completed).length;
  const late = items.filter((item) => item.movedToBacklog).length;
  const first = items[0]?.date;
  const last = items.at(-1)?.date;
  const isCurrent = first <= now && last >= now;
  const isUpcoming = first > now;
  const open = isCurrent || (!searchTerm() && isUpcoming && items.some((item) => item.date <= addDaysForView(now, 7)));
  return `<details class="week-card" ${open ? "open" : ""}>
    <summary>
      <div>
        <strong>${weekLabel(week)}</strong>
        <span>${fmtDate(first)} a ${fmtDate(last)}</span>
      </div>
      <div class="week-stats">
        <span>${done}/${items.length} feitas</span>
        ${late ? `<span class="danger-text">${late} atrasadas</span>` : ""}
      </div>
    </summary>
    <div class="week-progress"><i style="width:${Math.round((done / items.length) * 100)}%"></i></div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>Feito</th><th>Data</th><th>Área</th><th>Aula MEDCOF</th><th>Step 1</th><th>Prioridade</th><th>Status</th></tr></thead>
        <tbody>${items.map((item) => scheduleRow(item)).join("")}</tbody>
      </table>
    </div>
  </details>`;
}

function groupScheduleByWeek(items) {
  const groups = new Map();
  items.forEach((item) => {
    const week = item.week || "Sem semana";
    if (!groups.has(week)) groups.set(week, []);
    groups.get(week).push(item);
  });
  return [...groups.entries()].sort((a, b) => (a[1][0]?.date || "").localeCompare(b[1][0]?.date || ""));
}

function weekLabel(week) {
  const match = String(week).match(/^(\d{4})-W(\d{2})$/);
  if (!match) return week;
  return `Semana ${Number(match[2])} · ${match[1]}`;
}

function addDaysForView(dateISO, days) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formSession() {
  return `
    <div class="section-title"><h2>Registrar sessão</h2><span>cálculo automático</span></div>
    <form id="sessionForm" class="form">
      <input name="subject" placeholder="Matéria" required />
      <input name="system" placeholder="Sistema" />
      <input name="topic" placeholder="Tema" />
      <input name="source" placeholder="Fonte: MEDCOF, UWorld..." />
      <select name="mode"><option>Tutor</option><option>Timed</option><option>Misto</option></select>
      <input name="questions" type="number" min="0" placeholder="Questões" required />
      <input name="correct" type="number" min="0" placeholder="Acertos" required />
      <input name="minutes" type="number" min="1" placeholder="Minutos" required />
      <button class="primary-button" type="submit">Salvar sessão</button>
    </form>`;
}

function formSimulation() {
  return `
    <div class="section-title"><h2>Finalizar simulado</h2><span>comparação automática</span></div>
    <form id="simulationForm" class="form">
      <input name="name" placeholder="Nome do simulado" />
      <input name="subject" placeholder="Matéria" />
      <input name="system" placeholder="Sistema" />
      <input name="questions" type="number" min="1" placeholder="Questões" required />
      <input name="correct" type="number" min="0" placeholder="Acertos" required />
      <input name="minutes" type="number" min="1" placeholder="Minutos" />
      <input name="criticalThemes" placeholder="Temas críticos, separados por vírgula" />
      <button class="primary-button" type="submit">Salvar simulado</button>
    </form>`;
}

function formError() {
  return `
    <div class="section-title"><h2>Registrar erro</h2><span>vira revisão e flashcard</span></div>
    <form id="errorForm" class="form">
      <input name="subject" placeholder="Matéria" required />
      <input name="system" placeholder="Sistema" />
      <input name="topic" placeholder="Assunto" />
      <input name="source" placeholder="Fonte" />
      <select name="type"><option>Conceito</option><option>Distração</option><option>Memória</option><option>Interpretação</option></select>
      <textarea name="question" placeholder="Frente do flashcard / enunciado resumido"></textarea>
      <textarea name="correctAnswer" placeholder="Verso do flashcard / resposta correta"></textarea>
      <textarea name="whyMissed" placeholder="Por que errei?"></textarea>
      <label class="check"><input name="important" type="checkbox" /> Marcar como importante e agendar revisão</label>
      <button class="primary-button" type="submit">Salvar erro</button>
    </form>`;
}

function errorCard(error) {
  return `<article class="task-card">
    <div><strong>${error.topic || error.subject}</strong><span>${error.subject} · ${error.system} · ${error.type}</span></div>
    <p>${error.whyMissed || error.question || "Erro pendente de revisão ativa."}</p>
    <div class="button-row">
      <button class="secondary-button" data-flash-error="${error.id}">${error.flashcardId ? "Flashcard criado" : "Gerar flashcard"}</button>
      <button class="secondary-button" data-important-error="${error.id}">${error.important ? "Importante" : "Marcar importante"}</button>
    </div>
  </article>`;
}

function deckCard(card) {
  return `<article class="task-card"><div><strong>${card.front}</strong><span>${card.deck} · ${card.difficulty}</span></div><p>Próxima revisão: ${fmtDate(card.nextReview)} · intervalo ${card.interval}d</p></article>`;
}

function weakList(items, title) {
  return `<div class="section-title"><h2>${title}</h2><span>score automático</span></div>
    <div class="rank-list">${items
      .map((item, index) => `<div class="rank-row"><b>${index + 1}</b><span>${item.name}</span><strong>${Math.round(item.score)}</strong></div>`)
      .join("") || empty("Sem fraquezas detectadas.")}</div>`;
}

function barList(entries, title) {
  return `<div class="section-title"><h2>${title}</h2><span>concluído</span></div>
    ${entries
      .map(([name, item]) => `<div class="bar-row"><span>${name}</span><div><i style="width:${item.pct}%"></i></div><strong>${item.pct}%</strong></div>`)
      .join("")}`;
}

function barPairs(entries, title) {
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return `<div class="section-title"><h2>${title}</h2><span>recorrência</span></div>
    ${entries.map(([name, value]) => `<div class="bar-row"><span>${name}</span><div><i style="width:${(value / max) * 100}%"></i></div><strong>${value}</strong></div>`).join("") || empty("Sem erros ainda.")}`;
}

function lineChart(points) {
  if (!points.length) return empty("Registre sessões de questões para gerar o gráfico.");
  const path = points
    .map((point, index) => {
      const x = 20 + index * (520 / Math.max(1, points.length - 1));
      const y = 150 - point.value * 1.25;
      return `${index ? "L" : "M"}${x},${y}`;
    })
    .join(" ");
  return `<svg class="line-chart" viewBox="0 0 580 170" role="img">
    <path d="M20 150 H560" />
    <path class="trend" d="${path}" />
    ${points.map((point, index) => `<circle cx="${20 + index * (520 / Math.max(1, points.length - 1))}" cy="${150 - point.value * 1.25}" r="4"><title>${point.label}: ${point.value}%</title></circle>`).join("")}
  </svg>`;
}

function heatmap(sessions) {
  const days = Array.from({ length: 28 }, (_, i) => {
    const session = sessions.at(-28 + i);
    const level = session ? Math.min(4, Math.ceil(session.minutes / 30)) : 0;
    return `<span class="heat l${level}" title="${session?.date || ""}"></span>`;
  }).join("");
  return `<div class="section-title"><h2>Heatmap de estudo</h2><span>últimos registros</span></div><div class="heatmap">${days}</div>`;
}

function simulationCompare() {
  if (!state.simulations.length) return `<div class="section-title"><h2>Simulados</h2><span>sem dados</span></div>${empty("Finalize um simulado para comparar evolução.")}`;
  return `<div class="section-title"><h2>Simulados</h2><span>delta automático</span></div>${state.simulations
    .slice(-5)
    .reverse()
    .map((sim) => `<div class="list-row"><strong>${sim.name}</strong><span>${sim.accuracy}% · ${sim.delta >= 0 ? "+" : ""}${sim.delta} pts</span></div>`)
    .join("")}`;
}

function historyList(items) {
  if (!items.length) return empty("Sem histórico ainda.");
  return items
    .map((item) => `<div class="list-row"><strong>${item.name || item.topic || item.subject}</strong><span>${item.accuracy ?? 0}% · ${item.minutes} min · ${item.questions} questões</span></div>`)
    .join("");
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function searchTerm() {
  return $("#globalSearch").value.trim().toLowerCase();
}

function matches(item, q) {
  if (!q) return true;
  return JSON.stringify(item).toLowerCase().includes(q);
}

function elapsed(startedAt) {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function renderScheduleV2(d) {
  const q = searchTerm();
  const filtered = state.schedule.filter((item) => matches(item, q)).sort((a, b) => a.date.localeCompare(b.date));
  const weeks = groupScheduleByWeek(filtered);
  if (!selectedWeek || !weeks.some(([week]) => week === selectedWeek)) selectedWeek = getCurrentWeekKey(filtered, d.now) || weeks[0]?.[0] || "";
  const selectedItems = weeks.find(([week]) => week === selectedWeek)?.[1] || [];
  const board = state.weeklyBoards?.[selectedWeek]?.content || "";
  return `
    <section class="panel backlog-panel">
      <div class="section-title"><h2>Aulas Atrasadas</h2><span>aulas, revisoes e flashcards vencidos</span></div>
      <div class="three-col mini-lists">
        <div>${taskList(d.overdueLessons.slice(0, 8), "lesson")}</div>
        <div>${reviewList(d.dueReviews.slice(0, 8))}</div>
        <div>${cardQueueV2(d.dueCards.slice(0, 4))}</div>
      </div>
    </section>
    <div class="toolbar">
      <span>${weeks.length} semanas - ${filtered.length} aulas visiveis - ${d.overdueLessons.length} atrasadas - ${d.completed.length} concluidas</span>
      <select id="weekSelect" class="week-select">
        ${weeks.map(([week, items], index) => `<option value="${week}" ${week === selectedWeek ? "selected" : ""}>Semana ${index + 1} - ${fmtDate(items[0].date)} (${items.filter((item) => item.completed).length}/${items.length})</option>`).join("")}
      </select>
    </div>
    <section class="panel weekly-board">
      <div class="section-title"><h2>Lousa ${weekLabel(selectedWeek)}</h2><span>salva automaticamente</span></div>
      <textarea id="weeklyBoard" placeholder="Anotacoes livres da semana, prioridades, pendencias, estrategia...">${escapeHtml(board)}</textarea>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Estudos Fora do Cronograma</h2><span>conta no Dashboard</span></div>
      ${formOutsideStudy()}
      <div class="cards-list outside-list">${(state.outsideStudies || []).slice(-4).reverse().map(outsideStudyCard).join("") || empty("Nenhum estudo extra registrado.")}</div>
    </section>
    <div class="weekly-schedule">
      ${selectedItems.length ? scheduleWeekSectionV2(selectedWeek, selectedItems, d.now, true) : empty("Nenhuma semana selecionada.")}
    </div>`;
}

function bindViewV2() {
  viewEl.querySelectorAll("[data-complete-lesson]").forEach((button) =>
    button.addEventListener("click", () => {
      state = completeLesson(state, button.dataset.completeLesson);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-toggle-lesson]").forEach((input) =>
    input.addEventListener("change", () => {
      state = input.checked ? completeLesson(state, input.dataset.toggleLesson) : reopenLesson(state, input.dataset.toggleLesson);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-complete-review]").forEach((button) =>
    button.addEventListener("click", () => {
      state = completeReview(state, button.dataset.completeReview);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-card]").forEach((button) =>
    button.addEventListener("click", () => {
      state = answerFlashcard(state, button.dataset.card, button.dataset.rating);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-flash-error]").forEach((button) =>
    button.addEventListener("click", () => {
      state = flashcardFromError(state, button.dataset.flashError);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-important-error]").forEach((button) =>
    button.addEventListener("click", () => {
      state = markErrorImportant(state, button.dataset.importantError);
      persistRender();
    })
  );
  viewEl.querySelectorAll("[data-start-lesson]").forEach((button) => button.addEventListener("click", () => startLessonStudy(button.dataset.startLesson)));
  viewEl.querySelectorAll("[data-pause-timer]").forEach((button) => button.addEventListener("click", pauseLessonStudy));
  viewEl.querySelectorAll("[data-finish-timer]").forEach((button) => button.addEventListener("click", finishLessonStudy));
  viewEl.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
  $("#weekSelect")?.addEventListener("change", (event) => {
    selectedWeek = event.target.value;
    render();
  });
  $("#weeklyBoard")?.addEventListener("input", (event) => {
    state = saveWeeklyBoard(state, selectedWeek, event.target.value);
    saveState(state);
  });
  $("#outsideStudyForm")?.addEventListener("submit", handleOutsideStudySubmit);
  $("#manualFlashcardForm")?.addEventListener("submit", handleManualFlashcardSubmit);
  $("#customDeckForm")?.addEventListener("submit", handleCustomDeckSubmit);
  $("#sessionForm")?.addEventListener("submit", handleSessionSubmit);
  $("#simulationForm")?.addEventListener("submit", handleSimulationSubmit);
  $("#errorForm")?.addEventListener("submit", handleErrorSubmit);
  $("#timerForm")?.addEventListener("submit", handleTimerSubmit);
  $("#importFile")?.addEventListener("change", handleImport);
}

function scheduleRowV2(item) {
  const active = timer?.lessonId === item.id;
  return `<tr class="${item.movedToBacklog ? "late-row" : ""}">
    <td>
      <label class="done-toggle">
        <input type="checkbox" data-toggle-lesson="${item.id}" ${item.completed ? "checked" : ""} />
        <span>${item.completed ? "Feito" : "Nao feito"}</span>
      </label>
    </td>
    <td>${fmtDate(item.date)}</td>
    <td>${item.area}</td>
    <td>${item.medcofClass}</td>
    <td>${item.stepClass}<br><small>${item.stepSystem}</small></td>
    <td><span class="pill">${item.medcofPriority || item.monthlyPriority}</span></td>
    <td>${item.status}</td>
    <td>
      <div class="button-row compact-actions">
        ${active ? `<button class="secondary-button" data-pause-timer>${timer.pausedAt ? "Retomar" : "Pausar"}</button><button class="primary-button" data-finish-timer>Finalizar</button>` : `<button class="secondary-button" data-start-lesson="${item.id}">Iniciar estudo</button>`}
      </div>
    </td>
  </tr>`;
}

function scheduleWeekSectionV2(week, items, now, open = false) {
  const done = items.filter((item) => item.completed).length;
  const late = items.filter((item) => item.movedToBacklog).length;
  const first = items[0]?.date;
  const last = items.at(-1)?.date;
  return `<details class="week-card" ${open ? "open" : ""}>
    <summary>
      <div><strong>${weekLabel(week)}</strong><span>${fmtDate(first)} a ${fmtDate(last)}</span></div>
      <div class="week-stats"><span>${done}/${items.length} feitas</span>${late ? `<span class="danger-text">${late} atrasadas</span>` : ""}</div>
    </summary>
    <div class="week-progress"><i style="width:${Math.round((done / items.length) * 100)}%"></i></div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>Feito</th><th>Data</th><th>Grande area</th><th>Aula</th><th>Step 1</th><th>Prioridade</th><th>Status</th><th>Estudo</th></tr></thead>
        <tbody>${items.map((item) => scheduleRowV2(item)).join("")}</tbody>
      </table>
    </div>
  </details>`;
}

function renderFlashcardsV2(d) {
  return `
    <div class="grid metrics">
      ${metric("Total", d.flashcardStats.total, "cards criados")}
      ${metric("Pendentes", d.flashcardStats.due, "fila de hoje")}
      ${metric("Errei completamente", d.flashcardStats.again, "prioridade maxima")}
      ${metric("Criados hoje", d.flashcardStats.createdToday, "novos cards")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="section-title"><h2>Novo flashcard</h2><span>manual ou personalizado</span></div>
        ${formManualFlashcard()}
      </section>
      <section class="panel">
        <div class="section-title"><h2>Baralho personalizado</h2><span>${state.customDecks.length} criados</span></div>
        ${formCustomDeck()}
        <div class="deck-cloud">${state.customDecks.map((deck) => `<span class="pill">${deck}</span>`).join("") || empty("Nenhum baralho personalizado.")}</div>
      </section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>Fila de revisao espacada</h2><span>prioridade automatica</span></div>
      ${cardQueueV2(d.dueCards)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>Baralhos automaticos</h2><span>grande area, sistema, tema e origem</span></div>
      <div class="deck-grid">${d.automaticDecks.map((deck) => `<article class="deck-card"><strong>${deck.name}</strong><span>${deck.type} - ${deck.count} cards</span></article>`).join("") || empty("Os baralhos aparecem conforme os cards sao criados.")}</div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Todos os cards</h2><span>${state.flashcards.length} cards</span></div>
      <div class="cards-list">${state.flashcards.map(deckCardV2).join("") || empty("Os flashcards serao criados a partir dos erros ou manualmente.")}</div>
    </section>`;
}

function cardQueueV2(cards) {
  if (!cards.length) return empty("Nenhum card pendente agora.");
  return `<div class="cards-list">${cards
    .map(
      (card) => `<article class="flash-card ${card.difficulty}">
        <div><strong>${card.front}</strong><span>${card.deck} - ${card.origin || "manual"} - ${fmtDate(card.nextReview)}</span></div>
        <p>${card.back}</p>
        <small>${card.area || card.subject} - ${card.system} - ${card.topic || "sem tema"} - ${card.reviewCount || 0} revisoes - ${card.accuracy || 0}% acerto</small>
        <div class="button-row">
          <button data-card="${card.id}" data-rating="again" class="danger-button">Errei completamente</button>
          <button data-card="${card.id}" data-rating="hard" class="danger-button">Dificil</button>
          <button data-card="${card.id}" data-rating="medium" class="secondary-button">Medio</button>
          <button data-card="${card.id}" data-rating="easy" class="primary-button">Facil</button>
        </div>
      </article>`
    )
    .join("")}</div>`;
}

function renderQuestionsV2(d) {
  return `
    <div class="grid metrics">
      ${metric("Questoes", d.totalQuestions, "total registrado")}
      ${metric("Acertos", `${d.accuracy}%`, "taxa acumulada")}
      ${metric("Sessoes", state.sessions.length, "blocos feitos")}
      ${metric("Simulados", state.simulations.length, "comparados")}
    </div>
    <div class="two-col">
      <section class="panel">${formSession()}</section>
      <section class="panel">${formSimulationV2()}</section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>Historico recente</h2><span>evolucao temporal</span></div>
      ${historyList([...state.sessions, ...state.simulations].slice(-10).reverse())}
    </section>`;
}

function renderDashboardV2(d) {
  return `
    <div class="grid metrics">
      ${metric("Progresso", `${d.progress}%`, "geral por aula")}
      ${metric("Horas", `${d.hours}h`, "total")}
      ${metric("Cards vencidos", d.flashcardStats.overdue, "flashcards")}
      ${metric("Erros", state.errors.length, "registrados")}
    </div>
    <div class="dashboard-grid">
      <section class="panel wide"><div class="section-title"><h2>Tendencia de desempenho</h2><span>${scoreLabel(d.accuracy)}</span></div>${lineChart(d.trend)}</section>
      <section class="panel">${barList(d.weekProgress.slice(0, 10), "Progresso por semana")}</section>
      <section class="panel">${barList(d.subjectProgress, "Progresso por materia")}</section>
      <section class="panel">${barPairs(d.hoursByArea, "Horas por grande area")}</section>
      <section class="panel">${barPairs(d.hoursBySystem, "Horas por sistema")}</section>
      <section class="panel">${weakList(d.weakSubjects, "Ranking de fraqueza")}</section>
      <section class="panel">${barPairs(d.errorsBySystem, "Erros por sistema")}</section>
      <section class="panel">${simulationCompare()}</section>
    </div>`;
}

function formOutsideStudy() {
  return `<form id="outsideStudyForm" class="form compact">
    <input name="date" type="date" value="${todayISO()}" />
    <input name="area" placeholder="Grande area" required />
    <input name="subject" placeholder="Materia" required />
    <input name="system" placeholder="Sistema" />
    <input name="topic" placeholder="Tema" />
    <input name="lesson" placeholder="Aula" />
    <input name="minutes" type="number" min="1" placeholder="Duracao em minutos" required />
    <textarea name="notes" placeholder="Observacoes"></textarea>
    <button class="primary-button" type="submit">Registrar estudo extra</button>
  </form>`;
}

function formManualFlashcard() {
  const decks = [...new Set([...(state.customDecks || []), "Clinica Medica", "Cirurgia", "Pediatria", "GO", "Preventiva"])];
  return `<form id="manualFlashcardForm" class="form">
    <input name="front" placeholder="Frente" required />
    <input name="back" placeholder="Verso" required />
    <input name="area" placeholder="Grande area" />
    <input name="subject" placeholder="Materia" />
    <input name="system" placeholder="Sistema" />
    <input name="topic" placeholder="Tema" />
    <input name="lessonTitle" placeholder="Aula relacionada" />
    <select name="deck">${decks.map((deck) => `<option>${deck}</option>`).join("")}</select>
    <button class="primary-button" type="submit">Criar flashcard</button>
  </form>`;
}

function formCustomDeck() {
  return `<form id="customDeckForm" class="form compact"><input name="deck" placeholder="Nome do baralho" required /><button class="primary-button" type="submit">Criar baralho</button></form>`;
}

function formSimulationV2() {
  const areaInputs = [
    ["clinicamedica", "Clinica Medica"],
    ["cirurgia", "Cirurgia"],
    ["pediatria", "Pediatria"],
    ["go", "GO"],
    ["preventiva", "Preventiva"]
  ];
  return `
    <div class="section-title"><h2>Finalizar simulado</h2><span>por grande area</span></div>
    <form id="simulationForm" class="form sim-form">
      <input name="name" placeholder="Nome do simulado" />
      <input name="minutes" type="number" min="1" placeholder="Minutos" />
      ${areaInputs.map(([key, label]) => `<input name="${key}Questions" type="number" min="0" placeholder="${label}: questoes" /><input name="${key}Correct" type="number" min="0" placeholder="${label}: acertos" />`).join("")}
      <input name="criticalThemes" placeholder="Temas criticos, separados por virgula" />
      <button class="primary-button" type="submit">Salvar simulado</button>
    </form>`;
}

function outsideStudyCard(study) {
  return `<article class="task-card"><div><strong>${study.lesson || study.topic || study.subject}</strong><span>${fmtDate(study.date)} - ${study.area} - ${study.minutes} min</span></div><p>${study.notes || study.system || ""}</p></article>`;
}

function deckCardV2(card) {
  return `<article class="task-card"><div><strong>${card.front}</strong><span>${card.deck} - ${card.difficulty} - ${card.origin || "manual"}</span></div><p>Proxima revisao: ${fmtDate(card.nextReview)} - intervalo ${card.interval}d - ${card.accuracy || 0}% acerto</p></article>`;
}

function handleOutsideStudySubmit(event) {
  event.preventDefault();
  state = addOutsideStudy(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handleManualFlashcardSubmit(event) {
  event.preventDefault();
  state = addManualFlashcard(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handleCustomDeckSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state = addCustomDeck(state, data.deck);
  event.currentTarget.reset();
  persistRender();
}

function startLessonStudy(lessonId) {
  const lesson = state.schedule.find((item) => item.id === lessonId);
  if (!lesson) return;
  timer = {
    lessonId: lesson.id,
    week: lesson.week,
    subject: lesson.area,
    area: lesson.area,
    system: lesson.stepSystem,
    topic: lesson.medcofClass || lesson.stepClass,
    startedAt: new Date().toISOString(),
    pausedMs: 0,
    pausedAt: ""
  };
  timerTick = setInterval(() => $("#timerDisplay") && ($("#timerDisplay").textContent = elapsed(timer.startedAt)), 1000);
  render();
}

function pauseLessonStudy() {
  if (!timer) return;
  if (timer.pausedAt) {
    timer.pausedMs += Date.now() - new Date(timer.pausedAt).getTime();
    timer.pausedAt = "";
  } else {
    timer.pausedAt = new Date().toISOString();
  }
  render();
}

function finishLessonStudy() {
  if (!timer) return;
  if (timer.pausedAt) {
    timer.pausedMs += Date.now() - new Date(timer.pausedAt).getTime();
    timer.pausedAt = "";
  }
  timer.endedAt = new Date(Date.now() - (timer.pausedMs || 0)).toISOString();
  clearInterval(timerTick);
  state = saveTimerSession(state, timer);
  timer = null;
  persistRender();
}

function getCurrentWeekKey(items, now) {
  return items.find((item) => item.date <= now && item.date >= now)?.week || items.find((item) => item.date >= now)?.week || items[0]?.week || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

renderSchedule = renderScheduleV2;
bindView = bindViewV2;
scheduleRow = scheduleRowV2;
scheduleWeekSection = scheduleWeekSectionV2;
renderFlashcards = renderFlashcardsV2;
cardQueue = cardQueueV2;
renderQuestions = renderQuestionsV2;
renderDashboard = renderDashboardV2;
formSimulation = formSimulationV2;
deckCard = deckCardV2;
