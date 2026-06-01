import {
  TASKS,
  addError,
  addOutsideStudy,
  addQuestionSession,
  addSimulation,
  dayLabel,
  finishStudyTimer,
  getDerived,
  pauseStudyTimer,
  resumeStudyTimer,
  runAutomations,
  saveWeeklyBoard,
  setTask,
  startStudyTimer,
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
  ["dashboard", "Dashboard", "D"],
  ["settings", "Conta e Backup", "*"]
];

const SOURCE_OPTIONS = ["MEDCOF", "UWorld", "Prova antiga", "Outro"];
const TARGET_OPTIONS = ["Residencia BR", "Step 1", "Ambos"];
const SUBJECT_OPTIONS = ["Clinica Medica", "Cirurgia Geral", "Pediatria", "Ginecologia e Obstetricia", "Preventiva/MFC", "Step 1", "Outro"];
const SYSTEM_OPTIONS = [
  "Cardiovascular",
  "Respiratorio",
  "Renal",
  "Gastrointestinal",
  "Endocrino",
  "Reprodutivo",
  "Neurologia",
  "Hematologia/Oncologia",
  "Infectologia/Microbiologia",
  "Imunologia",
  "Farmacologia",
  "Bioquimica/Metabolismo",
  "Genetica",
  "Bioestatistica/Epidemiologia",
  "Etica/Behavioral Science",
  "Musculoesqueletico/Reumatologia",
  "Obstetricia",
  "Ginecologia",
  "Neonatologia",
  "Urgencia/Emergencia",
  "APS/MFC",
  "Outro"
];
const ERROR_TYPE_OPTIONS = [
  "Falta de conteudo",
  "Conduta/protocolo",
  "Confusao conceitual",
  "Fisiopatologia/mecanismo",
  "Interpretacao do enunciado",
  "Desatencao/leitura rapida",
  "Tempo/pressa",
  "Chute/incerteza"
];
const SEVERITY_OPTIONS = ["Baixa", "Media", "Alta", "Critica"];
const ERROR_STATUS_OPTIONS = ["Aberto", "Revisado", "Resolvido", "Recorrente"];

let seed = [];
let state;
let user;
let currentView = "today";
let selectedScheduleWeek = "";
let showAllErrors = false;
let studyTimerTicker = null;

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
    dashboard: renderDashboard,
    settings: renderSettings
  }[currentView];
  $("#view").innerHTML = renderer(derived);
  bindView();
  syncStudyTimerTicker();
}

function renderToday(d) {
  const day = d.today;
  return `
    ${todayPlan(day, d.now)}
    <section class="quick-actions">
      <button class="primary-button" data-action="goto-questions">Registrar questoes feitas</button>
      <button class="secondary-button" data-action="goto-errors">Registrar erro</button>
      <button class="secondary-button" data-action="mark-anki" data-day-id="${day?.id || ""}">Anki: ${day?.tasks?.anki ? "Feito" : "Pendente"}</button>
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
        ${metric("Horas estudadas", `${d.hours}h`, `${d.studyTimerHours}h pelo cronometro`)}
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
    ${studyTimerControls(day, key)}
  </div>`;
}

function studyTimerControls(day, key) {
  if (!["medcof", "step"].includes(key)) return "";
  const active = state.activeTimer;
  const isThisTimer = active?.dayId === day.id && active?.taskKey === key;
  if (isThisTimer) {
    return `<div class="study-timer active">
      <div><span>${active.pausedAt ? "Pausado" : "Cronometro ativo"}</span><strong data-active-timer-display>${formatStudyTimer(active)}</strong></div>
      <div class="timer-actions">
        <button class="secondary-button mini-button" data-action="${active.pausedAt ? "resume-timer" : "pause-timer"}" type="button">${active.pausedAt ? "Retomar" : "Pausar"}</button>
        <button class="primary-button mini-button" data-action="finish-timer" type="button">Finalizar</button>
      </div>
    </div>`;
  }
  if (active) {
    return `<div class="study-timer blocked"><span>Cronometro ativo em: ${active.title}</span></div>`;
  }
  return `<div class="study-timer">
    <button class="secondary-button mini-button" data-action="start-timer" data-day-id="${day.id}" data-task-key="${key}" type="button">Iniciar cronometro</button>
  </div>`;
}

function syncStudyTimerTicker() {
  clearInterval(studyTimerTicker);
  updateStudyTimerDisplays();
  if (!state?.activeTimer || state.activeTimer.pausedAt) return;
  studyTimerTicker = setInterval(updateStudyTimerDisplays, 1000);
}

function updateStudyTimerDisplays() {
  if (!state?.activeTimer) return;
  document.querySelectorAll("[data-active-timer-display]").forEach((item) => {
    item.textContent = formatStudyTimer(state.activeTimer);
  });
}

function formatStudyTimer(timer) {
  const now = timer.pausedAt ? new Date(timer.pausedAt) : new Date();
  const elapsedMs = Math.max(0, now - new Date(timer.startedAt) - (timer.pausedMs || 0));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
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
        <div class="section-title"><h2>Estudos fora do cronograma</h2><span>conta nas horas estudadas</span></div>
        ${outsideStudyForm()}
        <div class="record-list outside-study-list">${(state.outsideStudies || []).slice().reverse().slice(0, 6).map(outsideStudyCard).join("") || empty("Nenhum estudo fora do cronograma registrado.")}</div>
      </section>
      <section class="panel">
        <div class="section-title"><h2>${weekRangeTitle(selectedScheduleWeek, weekItems)}</h2><span>${weekItems.length} dia(s)</span></div>
        <div class="schedule-week-list">${weekItems.map(scheduleDayPanel).join("") || empty("Nenhum dia nesta semana.")}</div>
      </section>
    </div>
  </div>`;
}

function scheduleDayPanel(day) {
  const outsideStudies = (state.outsideStudies || []).filter((study) => study.date === day.date);
  const totalItems = [day.medcofClass, day.stepClass].filter(Boolean).length + outsideStudies.length;
  return `<article class="schedule-day-panel ${day.status === "Atrasado" ? "late" : ""}">
    <header class="schedule-day-header">
      <div>
        <h3>${scheduleDayTitle(day)}</h3>
        <span>${weekTitle(day.week, groupScheduleByWeek(state.schedule))}</span>
      </div>
      <div class="schedule-day-meta">
        <span class="status-pill ${statusClass(day.status)}">${day.status}</span>
        <b>${totalItems} aula(s)</b>
      </div>
    </header>
    <div class="schedule-lesson-list">
      ${scheduleLessonCard(day, "medcof", "MEDCOF", day.area || "MEDCOF", day.medcofClass, day.medcofPriority || day.monthlyPriority)}
      ${scheduleLessonCard(day, "step", "B&B / Step 1", day.stepSystem || "Step 1", day.stepClass, "Step 1")}
      ${outsideStudies.map(outsideStudyScheduleCard).join("")}
      ${totalItems ? "" : empty("Dia livre no cronograma.")}
    </div>
    <footer class="schedule-day-footer">
      ${scheduleFooterTask(day, "questions", "Questoes")}
      ${scheduleFooterTask(day, "anki", "Anki")}
      ${scheduleFooterTask(day, "errors", "Revisao de erros")}
      <button class="secondary-button details-button" data-open-day="${day.id}">Detalhes de hoje</button>
    </footer>
  </article>`;
}

function scheduleFooterTask(day, key, label) {
  const done = Boolean(day.tasks?.[key]);
  return `<label class="schedule-footer-task ${done ? "done" : ""}">
    <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${done ? "checked" : ""} />
    <span></span>
    <div>
      <small>${label}</small>
      <strong>${done ? "Feito" : "Pendente"}</strong>
    </div>
  </label>`;
}

function scheduleLessonCard(day, key, source, subject, title, priority) {
  if (!title) return "";
  const done = Boolean(day.tasks?.[key]);
  return `<article class="schedule-lesson-card ${done ? "done" : ""}">
    <label class="lesson-check" title="Marcar ${source}">
      <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${done ? "checked" : ""} />
      <span></span>
    </label>
    <div class="lesson-main">
      <div class="lesson-title-row">
        <strong>${subject}</strong>
        ${priority ? `<em>${priority}</em>` : ""}
      </div>
      <p>${title}</p>
      ${studyTimerControls(day, key)}
    </div>
    <div class="lesson-side">
      <span>${source}</span>
      <small>${done ? "Feito" : "Pendente"}</small>
    </div>
  </article>`;
}

function outsideStudyScheduleCard(study) {
  return `<article class="schedule-lesson-card outside-schedule-card done">
    <div class="outside-check">+</div>
    <div class="lesson-main">
      <div class="lesson-title-row">
        <strong>${study.subject || "Estudo fora do cronograma"}</strong>
        <em>Fora do cronograma</em>
      </div>
      <p>${study.lesson || study.topic || "Estudo registrado"}</p>
      ${study.system || study.topic ? `<small>${[study.system, study.topic].filter(Boolean).join(" - ")}</small>` : ""}
      ${study.notes ? `<small>${study.notes}</small>` : ""}
    </div>
    <div class="lesson-side">
      <span>${study.minutes || 0} min</span>
      <small>Registrado</small>
    </div>
  </article>`;
}

function scheduleDayTitle(day) {
  const weekday = day.weekday ? `${capitalize(day.weekday)} - ` : "";
  return `${weekday}${fmtDate(day.date)}`;
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
    <small>${items.filter((item) => item.status === "Feito").length}/${items.length} feito(s)</small>
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
  return `<section class="questions-hero panel simple-questions-hero">
      <div>
        <p class="eyebrow">Questoes</p>
        <h2>Registre o bloco em menos de um minuto</h2>
        <p class="muted">Preencha o essencial. Se apareceu um erro importante, registre no mesmo lugar e ele entra no Caderno de Erros.</p>
      </div>
      <div class="quick-result">
        <div><span>Acerto do bloco</span><strong id="qAccuracyPreview">-</strong></div>
        <div><span>Tempo por questao</span><strong id="qAvgPreview">-</strong></div>
      </div>
    </section>
    <section class="panel questions-main simple-question-panel">${questionsForm()}</section>
    <div class="grid metrics compact-metrics">
      ${metric("Questoes", d.totalQuestions, "registradas")}
      ${metric("Acertos", `${d.accuracy}%`, "geral")}
      ${metric("Semana", d.weekQuestions, "ultimos 7 dias")}
      ${metric("Horas", `${d.hours}h`, "questoes e simulados")}
    </div>
    <section class="panel simulation-panel">${simulationForm()}</section>
    <section class="panel"><div class="section-title"><h2>Historico recente</h2><span>ultimos registros</span></div>${historyList(state.sessions.slice(-8).reverse())}</section>`;
}

function questionsForm() {
  return `<div class="section-title"><h2>Registrar questoes feitas</h2><span>simples e rapido</span></div>
  <form id="questionsForm" class="quick-question-form">
    <div class="quick-row two">
      ${fieldSelect("source", "Fonte", SOURCE_OPTIONS)}
      ${fieldSelect("target", "Prova-alvo", TARGET_OPTIONS)}
    </div>
    <div class="quick-row">
      ${fieldSelect("subject", "Materia", SUBJECT_OPTIONS)}
      ${fieldSelect("system", "Sistema", SYSTEM_OPTIONS)}
      ${fieldInput("topic", "Tema", "Opcional")}
    </div>
    <div class="quick-row result-row">
      ${fieldInput("questions", "Questoes", "20", "number", true, 'min="1"')}
      ${fieldInput("correct", "Acertos", "15", "number", true, 'min="0"')}
      ${fieldInput("minutes", "Minutos", "40", "number", true, 'min="0"')}
      ${fieldInput("accuracy", "Percentual", "Auto", "text", false, "readonly")}
      ${fieldInput("avgTime", "Tempo por questao", "Auto", "text", false, "readonly")}
    </div>
    <details class="inline-error-box">
      <summary>Adicionar erro ao caderno de erros</summary>
      <div class="quick-row">
        ${fieldInput("errorTopic", "Tema do erro", "Ex.: choque distributivo")}
        ${fieldSelect("errorType", "Tipo", ERROR_TYPE_OPTIONS, false)}
        ${fieldSelect("errorSeverity", "Gravidade", SEVERITY_OPTIONS, false)}
      </div>
      <label class="field full-field"><span>Resumo do erro</span><textarea name="errorSummary" placeholder="O que voce errou neste bloco?"></textarea></label>
      <label class="field full-field"><span>Pergunta de revisao</span><textarea name="errorReviewQuestion" placeholder="Pergunta para revisar esse erro depois."></textarea></label>
      <label class="field full-field"><span>Resposta esperada</span><textarea name="errorExpectedAnswer" placeholder="Resposta que voce espera lembrar."></textarea></label>
    </details>
    <label class="field full-field"><span>Observacoes do bloco</span><textarea name="notes" placeholder="Opcional: dificuldade geral, fonte, comentarios..."></textarea></label>
    <button class="primary-button submit-main" type="submit">Salvar bloco de questoes</button>
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
    <label class="field"><span>Data</span><input name="date" type="date" value="${todayISO()}" required /></label>
    ${fieldSelect("source", "Fonte", SOURCE_OPTIONS)}
    ${fieldSelect("target", "Prova-alvo", TARGET_OPTIONS)}
    ${fieldSelect("subject", "Materia", SUBJECT_OPTIONS)}
    ${fieldSelect("system", "Sistema", SYSTEM_OPTIONS)}
    ${fieldInput("topic", "Tema", "Tema especifico")}
    <label class="field full-field"><span>Resumo do erro</span><textarea name="summary" placeholder="Resumo do erro" required></textarea></label>
    <label class="field full-field"><span>Pergunta de revisao</span><textarea name="reviewQuestion" placeholder="Transforme o erro em uma pergunta para revisar depois."></textarea></label>
    <label class="field full-field"><span>Resposta esperada</span><textarea name="expectedAnswer" placeholder="Qual resposta voce espera acertar na revisao?"></textarea></label>
    ${fieldSelect("type", "Tipo de erro", ERROR_TYPE_OPTIONS)}
    ${fieldSelect("severity", "Gravidade", SEVERITY_OPTIONS)}
    <label class="field"><span>Data de revisao</span><input name="reviewDate" type="date" /></label>
    ${fieldSelect("status", "Status", ERROR_STATUS_OPTIONS)}
    <button class="primary-button" type="submit">Salvar erro</button>
  </form>`;
}

function renderDashboard(d) {
  return `<div class="grid metrics">
      ${metric("Progresso", `${d.progress}%`, "dias feitos")}
      ${metric("Questoes", d.totalQuestions, "total")}
      ${metric("Acertos", `${d.accuracy}%`, "geral")}
      ${metric("Horas totais", `${d.hours}h`, `${d.studyTimerHours}h pelo cronometro`)}
    </div>
    <div class="dashboard-grid">
      <section class="panel">${barList(d.weekProgress, "Execucao da semana")}</section>
      <section class="panel">${barList(d.subjectPerformance, "Desempenho por materia")}</section>
      <section class="panel">${barList(d.systemPerformance, "Desempenho por sistema")}</section>
      <section class="panel">${barPairs(d.questionsBySource, "Questoes por fonte")}</section>
      <section class="panel">${barPairs(d.statusCounts, "Status do cronograma")}</section>
      <section class="panel">${errorDashboard(d.errorSummary)}</section>
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
  document.querySelectorAll("[data-board-cell]").forEach((cell) =>
    cell.addEventListener("input", () => {
      state = saveWeeklyBoard(state, `schedule:${selectedScheduleWeek}`, serializeBoardFromDOM());
      saveState(user.id, state);
    })
  );
  $("#questionsForm")?.addEventListener("input", updateQuestionCalculatedFields);
  $("#questionsForm")?.addEventListener("submit", handleQuestionsSubmit);
  $("#simulationForm")?.addEventListener("submit", handleSimulationSubmit);
  $("#outsideStudyForm")?.addEventListener("submit", handleOutsideStudySubmit);
  $("#errorForm")?.addEventListener("submit", handleErrorSubmit);
  $("#passwordForm")?.addEventListener("submit", handlePasswordSubmit);
  $("#importFile")?.addEventListener("change", handleImport);
}

function openDayModal(dayId) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day) return;
  $("#modalContent").innerHTML = `<div class="modal-day">
    <div class="modal-day-header">
      <div>
        <p class="eyebrow">Detalhes de hoje</p>
        <h2>${fmtDate(day.date)}</h2>
      </div>
      <span class="status-pill ${statusClass(day.status)}">${day.status}</span>
    </div>
    <div class="day-progress-card">
      <div><span>Progresso do dia</span><strong>${taskCompletion(day)}%</strong></div>
      <div class="day-progress-bar"><i style="width:${taskCompletion(day)}%"></i></div>
    </div>
    <div class="daily-detail-grid">
      ${dailyDetailCard(day, "medcof", "Aula MEDCOF", day.medcofClass || "Sem aula MEDCOF")}
      ${dailyDetailCard(day, "step", "Aula B&B / Step 1", day.stepClass || "Sem aula B&B")}
      ${dailyDetailCard(day, "questions", "Questoes", day.plannedQuestions || "25 questoes planejadas")}
      ${dailyDetailCard(day, "anki", "Anki", `Anki: ${day.tasks?.anki ? "Feito" : "Pendente"}`)}
      ${dailyDetailCard(day, "errors", "Revisao de erros", day.errorReview || "Revisar erros abertos")}
    </div>
    <section class="modal-study-section">
      <div class="section-title"><h2>Cronometro de estudo</h2><span>vinculado a aula</span></div>
      <div class="modal-study-timers">
        ${["medcof", "step"].map((key) => `<article><strong>${taskLabel(key)}</strong>${studyTimerControls(day, key)}</article>`).join("")}
      </div>
    </section>
  </div>`;
  if (!$("#modal").open) $("#modal").showModal();
  $("#modalContent").querySelectorAll("[data-task]").forEach((input) =>
    input.addEventListener("change", () => {
      state = setTask(state, input.dataset.dayId, input.dataset.task, input.checked);
      saveState(user.id, state);
      openDayModal(dayId);
      render();
    })
  );
  $("#modalContent").querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
}

function dailyDetailCard(day, key, title, content) {
  const done = Boolean(day.tasks?.[key]);
  return `<article class="daily-detail-card ${done ? "done" : ""}">
    <label class="task-check daily-check">
      <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${done ? "checked" : ""} />
      <span>${title}</span>
    </label>
    <p>${content}</p>
    <strong class="status-pill ${done ? "feito" : "pendente"}">${done ? "Feito" : "Pendente"}</strong>
  </article>`;
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const modalDayId = event.currentTarget.closest("#modalContent") ? event.currentTarget.dataset.dayId || state.activeTimer?.dayId : "";
  if (action === "goto-questions") currentView = "questions";
  if (action === "goto-errors") currentView = "errors";
  if (action === "start-timer") state = startStudyTimer(state, event.currentTarget.dataset.dayId, event.currentTarget.dataset.taskKey);
  if (action === "pause-timer") state = pauseStudyTimer(state);
  if (action === "resume-timer") state = resumeStudyTimer(state);
  if (action === "finish-timer") state = finishStudyTimer(state);
  if (action === "mark-anki" || action === "toggle-anki") {
    const day = state.schedule.find((item) => item.id === event.currentTarget.dataset.dayId);
    state = setTask(state, event.currentTarget.dataset.dayId, "anki", !day?.tasks?.anki);
  }
  if (action === "toggle-errors") showAllErrors = !showAllErrors;
  if (action === "remove-outside") state.outsideStudies = (state.outsideStudies || []).filter((study) => study.id !== event.currentTarget.dataset.studyId);
  if (action === "export") exportState(state);
  if (action === "reset" && confirm("Restaurar cronograma limpo para este usuario?")) state = resetState(user.id, seed);
  if (action === "logout") {
    logoutUser();
    location.reload();
    return;
  }
  renderNav();
  persistRender();
  if ($("#modal")?.open && modalDayId) openDayModal(modalDayId);
}

function handleQuestionsSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state = addQuestionSession(state, {
    ...data,
    mode: "Nao informado",
    selection: data.errorSummary ? "Revisao de erros" : "Por assunto",
    format: "Bloco comum"
  });
  if (data.errorSummary?.trim()) {
    state = addError(state, {
      date: todayISO(),
      source: data.source,
      target: data.target,
      subject: data.subject,
      system: data.system,
      topic: (data.errorTopic || data.topic || "").trim(),
      summary: data.errorSummary,
      reviewQuestion: data.errorReviewQuestion,
      expectedAnswer: data.errorExpectedAnswer,
      type: data.errorType || "Falta de conteudo",
      severity: data.errorSeverity || "Media",
      status: "Aberto"
    });
  }
  const today = getDerived(state).today;
  if (today?.date === todayISO()) state = setTask(state, today.id, "questions", true);
  event.currentTarget.reset();
  updateQuestionCalculatedFields({ currentTarget: event.currentTarget });
  persistRender();
}

function handleSimulationSubmit(event) {
  event.preventDefault();
  state = addSimulation(state, Object.fromEntries(new FormData(event.currentTarget)));
  event.currentTarget.reset();
  persistRender();
}

function handleOutsideStudySubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state = addOutsideStudy(state, data);
  const matchingDay = state.schedule.find((day) => day.date === data.date);
  if (matchingDay?.week) selectedScheduleWeek = matchingDay.week;
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
  const accuracy = questions ? `${pct(correct, questions)}%` : "";
  const avg = questions ? `${Math.round((minutes * 60) / questions)} s/questao` : "";
  form.accuracy.value = accuracy;
  form.avgTime.value = avg;
  $("#qAccuracyPreview") && ($("#qAccuracyPreview").textContent = accuracy || "-");
  $("#qAvgPreview") && ($("#qAvgPreview").textContent = avg || "-");
}

function checkbox(day, key, label) {
  return `<label class="task-check"><input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${day.tasks?.[key] ? "checked" : ""} /><span>${label}</span></label>`;
}

function errorCard(error) {
  return `<article class="task-card">
    <div><strong>${error.topic || error.subject}</strong><span>${fmtDate(error.date)} - ${error.source} - ${error.target || "Ambos"} - ${error.severity}</span></div>
    <p>${error.summary}</p>
    ${error.reviewQuestion ? `<small>Pergunta: ${error.reviewQuestion}</small>` : ""}
    ${error.expectedAnswer ? `<small>Resposta esperada: ${error.expectedAnswer}</small>` : ""}
    <small>${error.type} - ${error.subject} - ${error.system}</small>
    <select data-error-status="${error.id}">${ERROR_STATUS_OPTIONS.map((status) => `<option ${status === error.status ? "selected" : ""}>${status}</option>`).join("")}</select>
  </article>`;
}

function outsideStudyForm() {
  return `<form id="outsideStudyForm" class="form compact outside-study-form">
    <input name="date" type="date" value="${todayISO()}" required />
    <input name="subject" placeholder="Materia" required />
    <input name="system" placeholder="Sistema" />
    <input name="topic" placeholder="Tema" />
    <input name="lesson" placeholder="Aula estudada" />
    <input name="minutes" type="number" min="1" placeholder="Duracao em minutos" required />
    <textarea name="notes" placeholder="Observacoes"></textarea>
    <button class="primary-button" type="submit">Adicionar estudo fora do cronograma</button>
  </form>`;
}

function outsideStudyCard(study) {
  return `<article class="task-card outside-study-card">
    <div><strong>${study.lesson || study.topic || study.subject}</strong><span>${fmtDate(study.date)} · ${study.minutes} min</span></div>
    <p>${study.subject}${study.system ? ` · ${study.system}` : ""}${study.topic ? ` · ${study.topic}` : ""}</p>
    ${study.notes ? `<small>${study.notes}</small>` : ""}
    <button class="danger-button" data-action="remove-outside" data-study-id="${study.id}">Remover</button>
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
  return `<details class="simulation-details">
      <summary><div><strong>Simulado completo</strong><span>Abra somente quando for registrar prova inteira por grande area.</span></div></summary>
      <form id="simulationForm" class="guided-form sim-form">
        <fieldset>
          <legend>Dados gerais</legend>
          <div class="form-grid three">
            ${fieldInput("name", "Nome do simulado", "Ex.: Simulado MEDCOF 01")}
            ${fieldInput("minutes", "Tempo total", "Minutos", "number", false, 'min="0"')}
            ${fieldInput("scheduledDate", "Proximo simulado", "", "date")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Desempenho por grande area</legend>
          <div class="area-score-grid">
            ${areas
              .map(
                ([key, label]) => `<div class="area-score">
                  <strong>${label}</strong>
                  <input name="${key}Questions" type="number" min="0" placeholder="Questoes" />
                  <input name="${key}Correct" type="number" min="0" placeholder="Acertos" />
                </div>`
              )
              .join("")}
          </div>
        </fieldset>
        <button class="primary-button submit-main" type="submit">Salvar simulado</button>
      </form>
    </details>`;
}

function fieldInput(name, label, placeholder = "", type = "text", required = false, extra = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" placeholder="${placeholder}" ${required ? "required" : ""} ${extra} /></label>`;
}

function fieldSelect(name, label, options, required = true) {
  return `<label class="field"><span>${label}</span><select name="${name}" ${required ? "required" : ""}><option value="">Escolha</option>${options.map((option) => `<option>${option}</option>`).join("")}</select></label>`;
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

function errorDashboard(summary) {
  return `<div class="section-title"><h2>Caderno de Erros</h2><span>${summary.total} erro(s)</span></div>
    <div class="grid metrics error-metrics">
      ${metric("Total", summary.total, "erros registrados")}
      ${metric("Abertos", summary.open, "pendentes")}
      ${metric("Resolvidos", summary.resolved, "fechados")}
      ${metric("Recorrentes", summary.recurring, "repetidos")}
      ${metric("Revisao vencida", summary.overdue, "atrasada")}
    </div>
    <div class="error-dashboard-grid">
      ${miniList(summary.topics, "Temas mais errados")}
      ${barPairs(summary.byType, "Erros por tipo")}
      ${barPairs(summary.bySubject, "Erros por materia")}
      ${barPairs(summary.bySystem, "Erros por sistema")}
    </div>`;
}

function miniList(items, title) {
  return `<div><div class="section-title compact-title"><h2>${title}</h2><span>${items.length}</span></div>
    <div class="record-list">${items.map((item) => `<div class="list-row"><strong>${item.label}</strong><span>${item.value}</span></div>`).join("") || empty("Sem dados.")}</div></div>`;
}

function empty(text) {
  return `<p class="empty">${text}</p>`;
}

function statusClass(status = "") {
  const map = {
    Pendente: "pendente",
    Parcial: "parcial",
    Feito: "feito",
    Atrasado: "atrasado",
    Livre: "livre"
  };
  return map[status] || "pendente";
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

function capitalize(value = "") {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}
