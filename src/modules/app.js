import {
  TASKS,
  addError,
  addQuestionSession,
  addSimulation,
  dayLabel,
  getDerived,
  rescheduleDay,
  runAutomations,
  saveWeeklyBoard,
  setTask,
  taskCompletion,
  taskLabel,
  taskStatus,
  updateErrorStatus
} from "./engine.js";
import {
  changePassword,
  exportState,
  getCurrentUser,
  importState,
  loadState,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  resetState,
  saveState
} from "./storage.js";
import { fmtDate, pct, todayISO } from "./utils.js";

const views = [
  ["today", "Hoje", "H"],
  ["schedule", "Cronograma", "C"],
  ["questions", "Questoes", "Q"],
  ["errors", "Caderno de Erros", "!"],
  ["anki", "Anki", "A"],
  ["dashboard", "Dashboard", "D"],
  ["settings", "Conta e Backup", "*"]
];

let seed = [];
let state;
let user;
let currentView = "today";
let selectedScheduleWeek = "";
let showAllErrors = false;

const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  const data = await fetchSchedule();
  seed = data.items;
  user = getCurrentUser();
  if (!user) {
    renderAuth();
    return;
  }
  state = runAutomations(loadState(user.id, seed));
  selectedScheduleWeek = getDerived(state).week;
  document.body.dataset.theme = state.preferences.theme;
  bindShell();
  renderNav();
  persistRender();
}

async function fetchSchedule() {
  for (const path of ["./data/cronograma.json", "./public/data/cronograma.json"]) {
    try {
      const response = await fetch(path);
      if (!response.ok) continue;
      return await response.json();
    } catch {
      continue;
    }
  }
  return { items: [] };
}

function renderAuth(message = "") {
  $("#app").className = "auth-shell";
  $("#app").innerHTML = `
    <section class="auth-card">
      <div class="brand auth-brand"><div class="brand-mark">MS</div><div><strong>Med Study Brain</strong><span>Residencia BR + Step 1</span></div></div>
      <div class="auth-tabs">
        <button class="active" data-auth-tab="login">Login</button>
        <button data-auth-tab="register">Cadastro</button>
        <button data-auth-tab="recover">Recuperar senha</button>
      </div>
      <p class="form-message">${message}</p>
      <div id="authPanel">${authForm("login")}</div>
      <small>Os dados sao separados por usuario neste navegador. Para producao multi-dispositivo, conecte Firebase Auth/Firestore.</small>
    </section>`;
  $("#app").addEventListener("click", handleAuthTabs);
  $("#authPanel").addEventListener("submit", handleAuthSubmit);
}

function authForm(kind) {
  if (kind === "register") {
    return `<form data-auth-form="register" class="form auth-form">
      <input name="name" placeholder="Nome" required />
      <input name="email" type="email" placeholder="E-mail" required />
      <input name="password" type="password" minlength="6" placeholder="Senha" required />
      <button class="primary-button" type="submit">Criar conta</button>
    </form>`;
  }
  if (kind === "recover") {
    return `<form data-auth-form="recover" class="form auth-form">
      <input name="email" type="email" placeholder="E-mail cadastrado" required />
      <input name="nextPassword" type="password" minlength="6" placeholder="Nova senha" required />
      <button class="primary-button" type="submit">Alterar senha</button>
    </form>`;
  }
  return `<form data-auth-form="login" class="form auth-form">
    <input name="email" type="email" placeholder="E-mail" required />
    <input name="password" type="password" placeholder="Senha" required />
    <button class="primary-button" type="submit">Entrar</button>
  </form>`;
}

function handleAuthTabs(event) {
  const button = event.target.closest("[data-auth-tab]");
  if (!button) return;
  document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === button));
  $("#authPanel").innerHTML = authForm(button.dataset.authTab);
}

function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target.closest("[data-auth-form]");
  if (!form) return;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.authForm === "login") loginUser(data);
    if (form.dataset.authForm === "register") registerUser(data);
    if (form.dataset.authForm === "recover") {
      requestPasswordReset(data.email, data.nextPassword);
      renderAuth("Senha alterada. Faca login com a nova senha.");
      return;
    }
    location.reload();
  } catch (error) {
    renderAuth(error.message);
  }
}

function bindShell() {
  $("#themeToggle").addEventListener("click", () => {
    state.preferences.theme = state.preferences.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = state.preferences.theme;
    persistRender();
  });
  $("#quickSessionBtn").textContent = "Registrar questoes feitas";
  $("#quickSessionBtn").addEventListener("click", () => {
    currentView = "questions";
    renderNav();
    render();
    setTimeout(() => $("#questionsForm input[name='questions']")?.focus(), 50);
  });
  $("#globalSearch").addEventListener("input", render);
  $("#userMini").textContent = user.name;
  $("#userMini").nextElementSibling.textContent = "usuario conectado";
}

function renderNav() {
  $("#nav").innerHTML = views
    .map(([id, label, icon]) => `<button class="${id === currentView ? "active" : ""}" data-view="${id}"><span>${icon}</span>${label}</button>`)
    .join("");
  $("#nav").onclick = (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    currentView = button.dataset.view;
    renderNav();
    render();
  };
}

function persistRender() {
  saveState(user.id, state);
  render();
}

function render() {
  state = runAutomations(state);
  const derived = getDerived(state);
  $("#viewTitle").textContent = views.find(([id]) => id === currentView)?.[1] || "Hoje";
  $("#alerts").innerHTML = "";
  const renderer = {
    today: renderToday,
    schedule: renderSchedule,
    questions: renderQuestions,
    errors: renderErrors,
    anki: renderAnki,
    dashboard: renderDashboard,
    settings: renderSettings
  }[currentView];
  $("#view").innerHTML = renderer(derived);
  bindView();
}

function renderToday(d) {
  const day = d.today;
  const board = state.weeklyBoards?.[`routine:${d.week}`]?.content || "";
  return `
    ${todayPlan(day, d.now)}
    <section class="quick-actions">
      <button class="primary-button" data-action="goto-questions">Registrar questoes feitas</button>
      <button class="secondary-button" data-action="goto-errors">Registrar erro</button>
      <button class="secondary-button" data-action="mark-anki" data-day-id="${day?.id || ""}">Anki: ${day?.tasks?.anki ? "Feito" : "Pendente"}</button>
    </section>
    <section class="panel weekly-board">
      <div class="section-title"><h2>Lousa Semanal - Minha rotina</h2><span>${d.week}</span></div>
      <textarea id="weeklyBoard" placeholder="Horarios disponiveis, faculdade, internato, plantoes, academia, compromissos, provas, eventos e observacoes gerais.">${escapeHtml(board)}</textarea>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Planejamento da Semana - Cronograma</h2><span>${d.weekDays.length} dias</span></div>
      <div class="week-planner">${d.weekDays.map(weekDayCard).join("")}</div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Alertas</h2><span>prioridade do dia</span></div>
      ${alertList(d.alerts)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>Resumo simples de desempenho</h2><span>execucao</span></div>
      <div class="grid metrics">
        ${metric("Progresso", `${d.progress}%`, "cronograma")}
        ${metric("Questoes semana", d.weekQuestions, "ultimos 7 dias")}
        ${metric("Acertos", `${d.accuracy}%`, `${d.totalCorrect}/${d.totalQuestions}`)}
        ${metric("Erros abertos", d.openErrors.length, "para revisar")}
      </div>
    </section>`;
}

function todayPlan(day, now) {
  if (!day) return `<section class="panel hero-plan">${empty("Nenhum dia encontrado no cronograma.")}</section>`;
  return `<section class="panel hero-plan">
    <div class="section-title"><h2>Hoje - Plano do dia</h2><span>${fmtDate(now)}</span></div>
    <div class="plan-grid">
      ${planTaskCard(day, "medcof", "Aula MEDCOF do dia", day.medcofClass || "Sem aula MEDCOF")}
      ${planTaskCard(day, "step", "Aula B&B / Step 1 do dia", day.stepClass || "Sem aula B&B")}
      ${planTaskCard(day, "interleaving", "Bloco secundario/interleaving", day.secondaryBlock || day.dailyFocus || "Interleaving livre")}
      ${planTaskCard(day, "questions", "Questoes planejadas", day.plannedQuestions || "25 questoes")}
      ${planTaskCard(day, "anki", "Anki obrigatorio", `Anki: ${day.tasks.anki ? "Feito" : "Pendente"}`)}
      ${planTaskCard(day, "errors", "Revisao/caderno de erros", day.errorReview || "Revisar erros abertos")}
      <div><small>Tarefa minima</small><strong>${day.minimumTask || "Anki + aula principal + questoes"}</strong></div>
      <div><small>Plano normal</small><strong>${day.normalPlan || "Aulas + questoes + caderno de erros"}</strong></div>
      <div><small>Extra se der tempo</small><strong>${day.extraPlan || "Reforcar ponto fraco"}</strong></div>
      <div><small>Status geral do dia</small><strong class="status-pill ${statusClass(day.status)}">${day.status}</strong></div>
    </div>
  </section>`;
}

function planTaskCard(day, key, label, value) {
  return `<div class="plan-task-card ${day.tasks?.[key] ? "done" : ""}">
    <label class="card-check" title="Marcar ${label}">
      <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${day.tasks?.[key] ? "checked" : ""} />
      <span></span>
    </label>
    <small>${label}</small>
    <strong>${value}</strong>
  </div>`;
}

function weekDayCard(day) {
  return `<article class="day-card">
    <div><strong>${dayLabel(day)}</strong><span class="status-pill ${statusClass(day.status)}">${day.status}</span></div>
    <p><b>MEDCOF:</b> ${day.medcofClass || "-"}</p>
    <p><b>B&B:</b> ${day.stepClass || "-"}</p>
    <small>${day.plannedQuestions || "Questoes planejadas"} · Anki ${day.tasks.anki ? "feito" : "pendente"} · ${taskCompletion(day)}%</small>
  </article>`;
}

function renderSchedule(d) {
  const q = searchTerm();
  const weeks = groupScheduleByWeek(state.schedule.filter((day) => matches(day, q)));
  if (!selectedScheduleWeek || !weeks.some(([week]) => week === selectedScheduleWeek)) selectedScheduleWeek = weeks[0]?.[0] || d.week;
  const weekItems = weeks.find(([week]) => week === selectedScheduleWeek)?.[1] || [];
  const board = state.weeklyBoards?.[`schedule:${selectedScheduleWeek}`]?.content || "";
  return `<div class="schedule-shell">
    <aside class="week-sidebar panel">
      <div class="section-title"><h2>Semanas</h2><span>${weeks.length}</span></div>
      ${weeks.map(([week, items], index) => weekButton(week, items, index)).join("")}
    </aside>
    <div class="schedule-main">
      <section class="panel weekly-board">
        <div class="section-title"><h2>Lousa semanal - ${weekTitle(selectedScheduleWeek, weeks)}</h2><span>autosave local</span></div>
        ${weeklyBoardGrid(selectedScheduleWeek, board)}
      </section>
      <section class="panel">
        <div class="section-title"><h2>${weekRangeTitle(selectedScheduleWeek, weekItems)}</h2><span>${weekItems.length} dia(s)</span></div>
        <div class="table-wrap">
          <table class="schedule-table">
            <thead><tr>${["Data", "Aula MEDCOF", "Aula B&B", "Questoes", "Anki", "Revisao de erros", "Interleaving", "Status MEDCOF", "Status B&B", "Status Questoes", "Status Anki", "Status Revisao", "Status Interleaving", "Status geral", "Detalhes"].map((h) => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${weekItems.map(scheduleRow).join("") || `<tr><td colspan="15">${empty("Nenhum dia nesta semana.")}</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  </div>`;
}

function scheduleRow(day) {
  return `<tr class="${day.status === "Atrasado" ? "late-row" : ""}">
    <td>${fmtDate(day.date)}</td>
    <td>${day.medcofClass || "-"}</td>
    <td>${day.stepClass || "-"}</td>
    <td>${day.plannedQuestions || "25 questoes"}</td>
    <td>Anki: ${taskStatus(day, "anki")}</td>
    <td>${day.errorReview || "Revisar erros"}</td>
    <td>${day.secondaryBlock || day.dailyFocus || "-"}</td>
    ${["medcof", "step", "questions", "anki", "errors", "interleaving"].map((key) => `<td>${taskStatus(day, key)}</td>`).join("")}
    <td><span class="status-pill ${statusClass(day.status)}">${day.status}</span></td>
    <td><button class="secondary-button" data-open-day="${day.id}">Iniciar estudo</button></td>
  </tr>`;
}

function groupScheduleByWeek(items) {
  const groups = new Map();
  items
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((day) => {
      if (!groups.has(day.week)) groups.set(day.week, []);
      groups.get(day.week).push(day);
    });
  return [...groups.entries()];
}

function weekButton(week, items, index) {
  return `<button class="${week === selectedScheduleWeek ? "active" : ""}" data-week-select="${week}">
    <strong>Semana ${index + 1}</strong>
    <span>${fmtDate(items[0]?.date)} a ${fmtDate(items.at(-1)?.date)}</span>
    <small>${items.filter((item) => item.status === "Concluido").length}/${items.length} concluido(s)</small>
  </button>`;
}

function weekTitle(week, weeks) {
  const index = weeks.findIndex(([key]) => key === week);
  return index >= 0 ? `Semana ${index + 1}` : "Semana";
}

function weekRangeTitle(week, items) {
  if (!items.length) return "Semana selecionada";
  return `${fmtDate(items[0].date)} - ${fmtDate(items.at(-1).date)}`;
}

function weeklyBoardGrid(week, rawContent) {
  const data = parseBoard(rawContent);
  const periods = ["Manha", "Tarde", "Noite"];
  const days = ["Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado", "Domingo"];
  return `<div class="board-grid" data-board-week="${week}">
    ${periods
      .map(
        (period) => `<div class="board-period">${period}</div>${days
          .map((day) => `<label class="board-cell"><span>${day}</span><textarea data-board-cell="${period}.${day}" placeholder="${day} ${period.toLowerCase()}">${escapeHtml(data[period]?.[day] || "")}</textarea></label>`)
          .join("")}`
      )
      .join("")}
  </div>`;
}

function parseBoard(rawContent) {
  try {
    const parsed = JSON.parse(rawContent || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { Manha: { Segunda: rawContent || "" } };
  }
}

function serializeBoardFromDOM() {
  const data = {};
  document.querySelectorAll("[data-board-cell]").forEach((cell) => {
    const [period, day] = cell.dataset.boardCell.split(".");
    data[period] ||= {};
    data[period][day] = cell.value;
  });
  return JSON.stringify(data);
}

function renderQuestions(d) {
  return `<div class="grid metrics">
      ${metric("Questoes", d.totalQuestions, "registradas")}
      ${metric("Acertos", `${d.accuracy}%`, "geral")}
      ${metric("Semana", d.weekQuestions, "ultimos 7 dias")}
      ${metric("Horas", `${d.hours}h`, "questoes e simulados")}
    </div>
    <div class="two-col">
      <section class="panel">${questionsForm()}</section>
      <section class="panel">${simulationForm()}</section>
    </div>
    <section class="panel"><div class="section-title"><h2>Historico</h2><span>questoes feitas</span></div>${historyList(state.sessions.slice(-12).reverse())}</section>`;
}

function questionsForm() {
  return `<div class="section-title"><h2>Registrar questoes feitas</h2><span>calculo automatico</span></div>
  <form id="questionsForm" class="form">
    ${select("source", ["MEDCOF", "UWorld", "Prova antiga", "Outro"], "Fonte")}
    ${select("mode", ["Tutor", "Teste"], "Modo")}
    ${select("selection", ["Por assunto", "Por sistema", "Random/misto", "Revisao de erros"], "Selecao")}
    ${select("format", ["Bloco comum", "Simulado completo"], "Formato")}
    ${select("target", ["Residencia BR", "Step 1", "Ambos"], "Prova-alvo")}
    <input name="subject" placeholder="Materia" required />
    <input name="system" placeholder="Sistema" required />
    <input name="topic" placeholder="Tema" />
    <input name="questions" type="number" min="1" placeholder="Numero de questoes" required />
    <input name="correct" type="number" min="0" placeholder="Acertos" required />
    <input name="accuracy" readonly placeholder="Percentual" />
    <input name="minutes" type="number" min="0" placeholder="Tempo total em minutos" required />
    <input name="avgTime" readonly placeholder="Tempo medio por questao" />
    <textarea name="notes" placeholder="Observacoes"></textarea>
    <button class="primary-button" type="submit">Registrar questoes feitas</button>
  </form>`;
}

function renderErrors(d) {
  const sortedErrors = state.errors.slice().reverse();
  const visibleErrors = showAllErrors ? sortedErrors : sortedErrors.slice(0, 4);
  return `<div class="two-col">
    <section class="panel">${errorForm()}</section>
    <section class="panel">${barList(d.systemPerformance, "Sistemas mais fracos")}</section>
  </div>
  <section class="panel"><div class="section-title"><h2>Caderno de erros</h2><span>${state.errors.length} erro(s)</span></div>
    <div class="errors-toolbar">
      <p class="muted">Mostrando ${visibleErrors.length} de ${state.errors.length}. A lista completa fica recolhida para manter a tela limpa.</p>
      ${state.errors.length > 4 ? `<button class="secondary-button" data-action="toggle-errors">${showAllErrors ? "Mostrar menos" : "Ver lista completa"}</button>` : ""}
    </div>
    <div class="record-list errors-list ${showAllErrors ? "expanded" : ""}">${visibleErrors.map(errorCard).join("") || empty("Nenhum erro registrado.")}</div>
  </section>`;
}

function errorForm() {
  return `<div class="section-title"><h2>Novo erro</h2><span>banco de revisao</span></div>
  <form id="errorForm" class="form">
    <input name="date" type="date" value="${todayISO()}" required />
    ${select("source", ["MEDCOF", "UWorld", "Prova antiga", "Outro"], "Fonte")}
    <input name="subject" placeholder="Materia" required />
    <input name="system" placeholder="Sistema" required />
    <input name="topic" placeholder="Tema" />
    <textarea name="summary" placeholder="Resumo do erro" required></textarea>
    ${select("type", ["Conceito", "Interpretacao", "Memorizacao", "Atencao", "Tempo"], "Tipo de erro")}
    <input name="probableReason" placeholder="Motivo provavel" />
    ${select("severity", ["Baixa", "Media", "Alta", "Critica"], "Gravidade")}
    <input name="nextAction" placeholder="Proxima acao" />
    <input name="reviewDate" type="date" />
    ${select("status", ["Aberto", "Revisado", "Resolvido", "Recorrente"], "Status")}
    <button class="primary-button" type="submit">Salvar erro</button>
  </form>`;
}

function renderAnki(d) {
  const day = d.today;
  return `<section class="panel anki-simple">
    <div class="section-title"><h2>Anki obrigatorio</h2><span>tarefa diaria simples</span></div>
    <strong>Anki: ${day?.tasks?.anki ? "Feito" : "Pendente"}</strong>
    <button class="${day?.tasks?.anki ? "secondary-button" : "primary-button"}" data-action="toggle-anki" data-day-id="${day?.id || ""}">${day?.tasks?.anki ? "Desmarcar Anki" : "Marcar Anki como feito"}</button>
  </section>`;
}

function renderDashboard(d) {
  return `<div class="grid metrics">
      ${metric("Progresso", `${d.progress}%`, "dias concluidos")}
      ${metric("Questoes", d.totalQuestions, "total")}
      ${metric("Acertos", `${d.accuracy}%`, "geral")}
      ${metric("Erros abertos", d.openErrors.length, "ativos")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">${barList(d.weekProgress, "Execucao da semana")}</section>
      <section class="panel">${barList(d.subjectPerformance, "Desempenho por materia")}</section>
      <section class="panel">${barList(d.systemPerformance, "Desempenho por sistema")}</section>
      <section class="panel">${barPairs(d.questionsBySource, "Questoes por fonte")}</section>
      <section class="panel">${barPairs(d.statusCounts, "Status do cronograma")}</section>
      <section class="panel">${simulationCompare()}</section>
    </div>`;
}

function renderSettings() {
  return `<div class="two-col">
    <section class="panel">
      <div class="section-title"><h2>Conta</h2><span>${user.email}</span></div>
      <form id="passwordForm" class="form">
        <input name="currentPassword" type="password" placeholder="Senha atual" required />
        <input name="nextPassword" type="password" minlength="6" placeholder="Nova senha" required />
        <button class="primary-button" type="submit">Alterar senha</button>
      </form>
      <button class="danger-button full" data-action="logout">Logout</button>
    </section>
    <section class="panel">
      <div class="section-title"><h2>Backup</h2><span>dados do usuario atual</span></div>
      <div class="backup-actions">
        <button class="secondary-button" data-action="export">Exportar JSON</button>
        <label class="secondary-button">Importar JSON<input id="importFile" type="file" accept="application/json" hidden /></label>
        <button class="danger-button" data-action="reset">Restaurar cronograma limpo</button>
      </div>
    </section>
  </div>`;
}

function bindView() {
  document.querySelectorAll("[data-task]").forEach((input) =>
    input.addEventListener("change", () => {
      state = setTask(state, input.dataset.dayId, input.dataset.task, input.checked);
      persistRender();
    })
  );
  document.querySelectorAll("[data-open-day]").forEach((button) => button.addEventListener("click", () => openDayModal(button.dataset.openDay)));
  document.querySelectorAll("[data-week-select]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedScheduleWeek = button.dataset.weekSelect;
      render();
    })
  );
  document.querySelectorAll("[data-error-status]").forEach((selectEl) =>
    selectEl.addEventListener("change", () => {
      state = updateErrorStatus(state, selectEl.dataset.errorStatus, selectEl.value);
      persistRender();
    })
  );
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
  $("#weeklyBoard")?.addEventListener("input", (event) => {
    const week = `routine:${getDerived(state).week}`;
    state = saveWeeklyBoard(state, week, event.target.value);
    saveState(user.id, state);
  });
  document.querySelectorAll("[data-board-cell]").forEach((cell) =>
    cell.addEventListener("input", () => {
      state = saveWeeklyBoard(state, `schedule:${selectedScheduleWeek}`, serializeBoardFromDOM());
      saveState(user.id, state);
    })
  );
  $("#questionsForm")?.addEventListener("input", updateQuestionCalculatedFields);
  $("#questionsForm")?.addEventListener("submit", handleQuestionsSubmit);
  $("#simulationForm")?.addEventListener("submit", handleSimulationSubmit);
  $("#errorForm")?.addEventListener("submit", handleErrorSubmit);
  $("#passwordForm")?.addEventListener("submit", handlePasswordSubmit);
  $("#importFile")?.addEventListener("change", handleImport);
}

function openDayModal(dayId) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day) return;
  $("#modalContent").innerHTML = `<div class="section-title"><h2>${fmtDate(day.date)}</h2><span>${day.status}</span></div>
    <div class="plan-grid compact-plan">
      <div><small>MEDCOF</small><strong>${day.medcofClass}</strong></div>
      <div><small>B&B</small><strong>${day.stepClass}</strong></div>
      <div><small>Questoes</small><strong>${day.plannedQuestions}</strong></div>
      <div><small>Interleaving</small><strong>${day.secondaryBlock || day.dailyFocus}</strong></div>
    </div>
    <div class="task-checklist">${TASKS.map(([key, label]) => checkbox(day, key, label)).join("")}</div>
    <form id="rescheduleForm" class="form compact"><input name="date" type="date" required /><button class="secondary-button">Reprogramar dia</button></form>`;
  $("#modal").showModal();
  $("#modalContent").querySelectorAll("[data-task]").forEach((input) =>
    input.addEventListener("change", () => {
      state = setTask(state, input.dataset.dayId, input.dataset.task, input.checked);
      saveState(user.id, state);
      openDayModal(dayId);
      render();
    })
  );
  $("#rescheduleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state = rescheduleDay(state, dayId, new FormData(event.currentTarget).get("date"));
    $("#modal").close();
    persistRender();
  });
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "goto-questions") currentView = "questions";
  if (action === "goto-errors") currentView = "errors";
  if (action === "mark-anki" || action === "toggle-anki") {
    const day = state.schedule.find((item) => item.id === event.currentTarget.dataset.dayId);
    state = setTask(state, event.currentTarget.dataset.dayId, "anki", !day?.tasks?.anki);
  }
  if (action === "toggle-errors") showAllErrors = !showAllErrors;
  if (action === "export") exportState(state);
  if (action === "reset" && confirm("Restaurar cronograma limpo para este usuario?")) state = resetState(user.id, seed);
  if (action === "logout") {
    logoutUser();
    location.reload();
    return;
  }
  renderNav();
  persistRender();
}

function handleQuestionsSubmit(event) {
  event.preventDefault();
  state = addQuestionSession(state, Object.fromEntries(new FormData(event.currentTarget)));
  const today = getDerived(state).today;
  if (today?.date === todayISO()) state = setTask(state, today.id, "questions", true);
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
  state = addError(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handlePasswordSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    changePassword(user.id, data.currentPassword, data.nextPassword);
    alert("Senha alterada.");
    event.currentTarget.reset();
  } catch (error) {
    alert(error.message);
  }
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state = runAutomations(await importState(file, seed));
  persistRender();
}

function updateQuestionCalculatedFields(event) {
  const form = event.currentTarget;
  const questions = Number(form.questions.value) || 0;
  const correct = Number(form.correct.value) || 0;
  const minutes = Number(form.minutes.value) || 0;
  form.accuracy.value = questions ? `${pct(correct, questions)}%` : "";
  form.avgTime.value = questions ? `${Math.round((minutes * 60) / questions)} s/questao` : "";
}

function checkbox(day, key, label) {
  return `<label class="task-check"><input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${day.tasks?.[key] ? "checked" : ""} /><span>${label}</span></label>`;
}

function errorCard(error) {
  return `<article class="task-card">
    <div><strong>${error.topic || error.subject}</strong><span>${fmtDate(error.date)} · ${error.source} · ${error.severity}</span></div>
    <p>${error.summary}</p>
    <small>${error.type} · ${error.probableReason || "motivo nao informado"} · Proxima acao: ${error.nextAction}</small>
    <select data-error-status="${error.id}">${["Aberto", "Revisado", "Resolvido", "Recorrente"].map((status) => `<option ${status === error.status ? "selected" : ""}>${status}</option>`).join("")}</select>
  </article>`;
}

function historyList(items) {
  return `<div class="record-list">${items
    .map((item) => `<div class="list-row"><strong>${fmtDate(item.date)} · ${item.source}</strong><span>${item.correct}/${item.questions} · ${item.accuracy}% · ${item.secondsPerQuestion || 0}s/q</span></div>`)
    .join("") || empty("Nenhum registro ainda.")}</div>`;
}

function simulationForm() {
  const areas = [
    ["clinicamedica", "Clinica Medica"],
    ["cirurgia", "Cirurgia"],
    ["pediatria", "Pediatria"],
    ["go", "GO"],
    ["preventiva", "Preventiva"]
  ];
  return `<div class="section-title"><h2>Simulado completo</h2><span>por grande area</span></div>
    <form id="simulationForm" class="form sim-form">
      <input name="name" placeholder="Nome do simulado" />
      <input name="minutes" type="number" min="0" placeholder="Tempo total em minutos" />
      <input name="scheduledDate" type="date" title="Data programada do proximo simulado" />
      ${areas.map(([key, label]) => `<input name="${key}Questions" type="number" min="0" placeholder="${label}: questoes" /><input name="${key}Correct" type="number" min="0" placeholder="${label}: acertos" />`).join("")}
      <button class="primary-button" type="submit">Salvar simulado</button>
    </form>`;
}

function simulationCompare() {
  const last = state.simulations.at(-1);
  if (!last) return `<div class="section-title"><h2>Simulados</h2><span>historico</span></div>${empty("Nenhum simulado finalizado.")}`;
  return `<div class="section-title"><h2>Simulados</h2><span>${last.delta >= 0 ? "+" : ""}${last.delta} pp</span></div>
    <div class="list-row"><strong>${last.name}</strong><span>${last.accuracy}% · Forte: ${last.strongestArea || "-"} · Fraca: ${last.weakestArea || "-"}</span></div>`;
}

function select(name, options, placeholder) {
  return `<select name="${name}" required><option value="">${placeholder}</option>${options.map((option) => `<option>${option}</option>`).join("")}</select>`;
}

function metric(label, value, hint) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`;
}

function alertList(alerts) {
  return `<div class="alerts inline-alerts">${alerts.map((alert) => `<div class="alert ${alert.tone}"><span></span>${alert.text}</div>`).join("") || empty("Sem alertas prioritarios agora.")}</div>`;
}

function barList(items, title) {
  return `<div class="section-title"><h2>${title}</h2><span>${items.length}</span></div>
    <div class="bar-list">${items.map((item) => `<div class="bar-row"><span>${item.label}</span><div><i style="width:${item.value}%"></i></div><b>${item.value}%</b></div>`).join("") || empty("Sem dados suficientes.")}</div>`;
}

function barPairs(map, title) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...entries.map(([, value]) => value), 1);
  return `<div class="section-title"><h2>${title}</h2><span>${entries.length}</span></div>
    <div class="bar-list">${entries.map(([label, value]) => `<div class="bar-row"><span>${label}</span><div><i style="width:${Math.round((value / max) * 100)}%"></i></div><b>${value}</b></div>`).join("") || empty("Sem dados.")}</div>`;
}

function empty(text) {
  return `<p class="empty">${text}</p>`;
}

function statusClass(status = "") {
  return status.toLowerCase().replace(/\s/g, "-").replace(/[ãáà]/g, "a").replace(/[í]/g, "i").replace(/[ó]/g, "o");
}

function searchTerm() {
  return ($("#globalSearch")?.value || "").trim().toLowerCase();
}

function matches(day, q) {
  if (!q) return true;
  return [day.medcofClass, day.stepClass, day.area, day.stepSystem, day.secondaryBlock, day.status].join(" ").toLowerCase().includes(q);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
