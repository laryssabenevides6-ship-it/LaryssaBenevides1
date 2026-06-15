import {
  addError,
  addOutsideStudy,
  addQuestionSession,
  addSimulation,
  deleteError,
  dayLabel,
  getDerived,
  runAutomations,
  saveWeeklyBoard,
  setOutsideStudyDone,
  setTask,
  taskCompletion,
  updateError,
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
import { addDays, fmtDate, pct, todayISO } from "./utils.js";

const views = [
  ["today", "Hoje", "H"],
  ["schedule", "Cronograma", "C"],
  ["questions", "Questoes", "Q"],
  ["errors", "Caderno de Erros", "!"],
  ["dashboard", "Dashboard", "D"],
  ["settings", "Conta e Backup", "*"]
];

const SOURCE_OPTIONS = ["MEDCOF", "UWorld", "Prova antiga", "Outro"];
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
  "Erro de interpretacao",
  "Tempo",
  "Chute"
];
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
    applyTheme();
    persistRender();
  });
  applyTheme();
  $("#globalSearch").addEventListener("input", render);
  $("#userMini").textContent = user.name;
  $("#userMini").nextElementSibling.textContent = "usuario conectado";
}

function applyTheme() {
  const theme = state.preferences.theme === "light" ? "light" : "dark";
  state.preferences.theme = theme;
  document.body.dataset.theme = theme;
  const toggle = $("#themeToggle");
  if (toggle) {
    toggle.textContent = theme === "light" ? "Escuro" : "Claro";
    toggle.title = theme === "light" ? "Alternar para modo escuro" : "Alternar para modo claro";
  }
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
  render();
  saveState(user.id, state);
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
  const overdue = overdueItems(d.now);
  return `
    ${todayPlan(day, d.now)}
    ${overduePanel("Atrasados", overdue)}
    <section class="panel">
      <div class="section-title"><h2>Revisão do Caderno de Erros</h2><span>${d.errorSummary.pendingReview}</span></div>
      ${errorReviewSummaryCard(d.now)}
    </section>
    <section class="panel">
      <div class="section-title"><h2>Alertas</h2><span>prioridade do dia</span></div>
      ${alertList(d.alerts)}
    </section>`;
}

function todayPlan(day, now) {
  if (!day) return `<section class="panel hero-plan">${empty("Nenhum dia encontrado no cronograma.")}</section>`;
  const taskOrder = [
    { key: "medcof", label: "Aula MEDCOF", value: day.medcofClass || "Sem aula MEDCOF", required: Boolean(day.medcofClass) },
    { key: "step", label: "Aula B&B / Step 1", value: day.stepClass || "Sem aula B&B", required: Boolean(day.stepClass) },
    { key: "questions", label: "Questões recomendadas hoje", value: day.plannedQuestions || "Meta: 30 questões", reminder: true },
    { key: "anki", label: "Lembrete Anki", value: "Fazer Anki, se estiver previsto na sua rotina", reminder: true },
    { key: "errors", label: "Revisão do Caderno de Erros", value: errorReviewShortText(now), reminder: true }
  ].filter((item) => {
    if (["medcof", "step"].includes(item.key)) return !isTaskRemapped(day, item.key);
    if (["questions", "anki", "errors"].includes(item.key)) return hasVisibleScheduledLesson(day);
    return true;
  });
  const pendingTasks = taskOrder.filter((item) => item.required && !day.tasks?.[item.key]);
  const nextTask = pendingTasks[0]?.label || "Tudo feito";
  return `<section class="panel hero-plan">
    <div class="today-hero-header">
      <div>
        <p class="eyebrow">Hoje - Plano do dia</p>
        <h2>${fmtDate(now)}</h2>
      </div>
      <span class="status-pill ${statusClass(day.status)}">${day.status}</span>
    </div>
    <div class="today-summary-strip">
      <div>
        <small>Progresso do dia</small>
        <strong>${taskCompletion(day, state)}%</strong>
        <div class="today-progress"><i style="width:${taskCompletion(day, state)}%"></i></div>
      </div>
      <div>
        <small>Proxima tarefa</small>
        <strong>${nextTask}</strong>
      </div>
      <div>
        <small>Faltam</small>
        <strong>${pendingTasks.length} tarefa(s)</strong>
      </div>
    </div>
    <div class="today-execution-layout">
      <div class="today-main-list">
        <div class="section-title compact-title"><h2>Fazer hoje</h2><span>marque conforme concluir</span></div>
        ${taskOrder.map((item, index) => item.reminder ? reminderTaskCard(item, index + 1) : planTaskCard(day, item.key, item.label, item.value, index + 1)).join("")}
      </div>
    </div>
  </section>`;
}

function reminderTaskCard(item, index = 1) {
  return `<div class="plan-task-card reminder">
    <div class="task-number">${index}</div>
    <div class="task-copy">
      <small>${item.label}</small>
      <strong>${item.value}</strong>
      <em>Lembrete</em>
    </div>
  </div>`;
}

function planTaskCard(day, key, label, value, index = 1) {
  return `<div class="plan-task-card ${day.tasks?.[key] ? "done" : ""}">
    <div class="task-number">${index}</div>
    <div class="task-copy">
      <small>${label}</small>
      <strong>${value}</strong>
      <em>${day.tasks?.[key] ? "Feito" : "Pendente"}</em>
    </div>
    <label class="card-check" title="Marcar ${label}">
      <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${day.tasks?.[key] ? "checked" : ""} />
      <span></span>
    </label>
  </div>`;
}

function todayErrorReviews(items = []) {
  return `<div class="record-list">${
    items
      .map(
        (error) => `<button class="today-error-review" data-action="review-error" data-error-id="${error.id}" type="button">
          <strong>${error.topic}</strong>
          <span>${error.reviewQuestion}</span>
          <small>${error.type} - ${error.status}</small>
        </button>`
      )
      .join("") || empty("Nenhum erro para revisar hoje.")
  }</div>`;
}

function dueErrorReviewItems(date = todayISO(), exact = false) {
  const today = todayISO();
  return (state.errors || [])
    .filter((error) => {
      if (!error.reviewDate || error.status === "Resolvido") return false;
      if (exact || date > today) return error.reviewDate === date;
      return error.reviewDate <= date;
    })
    .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
}

function errorReviewCounts(now = todayISO(), exact = false) {
  const items = dueErrorReviewItems(now, exact);
  return {
    today: items.filter((error) => error.reviewDate === now).length,
    overdue: items.filter((error) => error.reviewDate < now).length,
    total: items.length
  };
}

function errorReviewShortText(now = todayISO()) {
  const counts = errorReviewCounts(now);
  return counts.total ? `${counts.total} questão(ões) para revisar` : "Sem revisão vencida";
}

function errorReviewSummaryCard(now = todayISO()) {
  const counts = errorReviewCounts(now);
  return `<article class="review-summary-card">
    <div class="review-summary-grid">
      <div><small>Hoje</small><strong>${counts.today}</strong></div>
      <div><small>Atrasadas</small><strong>${counts.overdue}</strong></div>
      <div><small>Total pendente</small><strong>${counts.total}</strong></div>
    </div>
    <button class="primary-button" data-action="open-error-review-queue" type="button" ${counts.total ? "" : "disabled"}>Revisar agora</button>
  </article>`;
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
    <small>${day.plannedQuestions || "Questoes planejadas"} · ${taskCompletion(day, state)}% das aulas</small>
  </article>`;
}

function renderSchedule(d) {
  const q = searchTerm();
  const weeks = groupScheduleByWeek(state.schedule.filter((day) => matches(day, q)));
  if (!selectedScheduleWeek || !weeks.some(([week]) => week === selectedScheduleWeek)) selectedScheduleWeek = weeks[0]?.[0] || d.week;
  const weekItems = weeks.find(([week]) => week === selectedScheduleWeek)?.[1] || [];
  const board = state.weeklyBoards?.[`schedule:${selectedScheduleWeek}`]?.content || "";
  const overdue = overdueItems(d.now);
  return `<div class="schedule-shell">
    <aside class="week-sidebar panel">
      <div class="section-title"><h2>Semanas</h2><span>${weeks.length}</span></div>
      ${weeks.map(([week, items], index) => weekButton(week, items, index)).join("")}
    </aside>
    <div class="schedule-main">
      ${overduePanel("Aulas e tarefas atrasadas", overdue)}
      <section class="panel weekly-board">
        <div class="section-title"><h2>Lousa semanal - ${weekTitle(selectedScheduleWeek, weeks)}</h2><span>autosave local</span></div>
        ${weeklyBoardGrid(selectedScheduleWeek, board)}
      </section>
      <section class="panel">
        <div class="section-title"><h2>Estudos fora do cronograma</h2><span>aparecem no dia escolhido</span></div>
        ${outsideStudyForm()}
      </section>
      <section class="panel">
        <div class="section-title"><h2>${weekRangeTitle(selectedScheduleWeek, weekItems)}</h2><span>${weekItems.length} dia(s)</span></div>
        <div class="schedule-week-list">${weekItems.map(scheduleDayPanel).join("") || empty("Nenhum dia nesta semana.")}</div>
      </section>
    </div>
  </div>`;
}

function overdueItems(now = todayISO()) {
  const taskLabels = {
    medcof: "Aula MEDCOF",
    step: "Aula B&B / Step 1"
  };
  const scheduled = state.schedule
    .filter((day) => day.date < now && !["Feito", "Livre"].includes(day.status))
    .flatMap((day) =>
      Object.entries(taskLabels)
        .filter(([key]) => !day.tasks?.[key] && !isTaskRemapped(day, key) && overdueTaskExists(day, key))
        .map(([key, label]) => ({
          id: `${day.id}:${key}`,
          kind: "task",
          dayId: day.id,
          taskKey: key,
          date: day.date,
          label,
          title: overdueTaskTitle(day, key),
          meta: scheduleDayTitle(day)
        }))
    );
  const extras = (state.outsideStudies || [])
    .filter((study) => study.date < now && !study.done)
    .map((study) => ({
      id: study.id,
      kind: "outside",
      studyId: study.id,
      date: study.date,
      label: "Fora do cronograma",
      title: study.lesson || study.topic || study.subject || "Estudo fora do cronograma",
      meta: `${fmtDate(study.date)}${study.subject ? ` - ${study.subject}` : ""}`
    }));
  const overdueErrorReviews = dueErrorReviewItems(addDays(now, -1));
  const errorReview = overdueErrorReviews.length
    ? [{
        id: "error-review-overdue",
        kind: "error-review",
        date: overdueErrorReviews[0].reviewDate,
        label: "Caderno de Erros",
        title: "Revisão do Caderno de Erros",
        meta: `${overdueErrorReviews.length} questão(ões) atrasada(s)`
      }]
    : [];
  return [...scheduled, ...extras, ...errorReview].sort((a, b) => a.date.localeCompare(b.date));
}

function overdueTaskExists(day, key) {
  if (key === "medcof") return Boolean(day.medcofClass);
  if (key === "step") return Boolean(day.stepClass);
  return true;
}

function overdueTaskTitle(day, key) {
  const map = {
    medcof: day.medcofClass || "Aula MEDCOF",
    step: day.stepClass || "Aula B&B / Step 1",
    questions: day.plannedQuestions || "Bloco de questoes",
    anki: "Anki obrigatorio",
    errors: day.errorReview || "Revisao de erros"
  };
  return map[key] || key;
}

function overduePanel(title, items) {
  return `<section class="panel overdue-panel">
    <div class="section-title"><h2>${title}</h2><span>${items.length} pendencia(s)</span></div>
    <div class="overdue-list">${items.map(overdueCard).join("") || empty("Nenhuma pendencia atrasada.")}</div>
  </section>`;
}

function overdueCard(item) {
  const target = addDays(todayISO(), 1);
  if (item.kind === "error-review") {
    return `<article class="overdue-card">
      <div class="task-number">!</div>
      <div>
        <small>${fmtDate(item.date)} - ${item.label}</small>
        <strong>${item.title}</strong>
        <em>${item.meta}</em>
      </div>
      <button class="primary-button mini-button" data-action="open-error-review-queue" type="button">Revisar agora</button>
    </article>`;
  }
  const checkAttrs =
    item.kind === "outside"
      ? `data-outside-study-id="${item.studyId}"`
      : `data-day-id="${item.dayId}" data-task="${item.taskKey}"`;
  return `<article class="overdue-card">
    <label class="lesson-check" title="Marcar como feito">
      <input type="checkbox" ${checkAttrs} />
      <span></span>
    </label>
    <div>
      <small>${fmtDate(item.date)} - ${item.label}</small>
      <strong>${item.title}</strong>
      <em>${item.meta}</em>
    </div>
    <form class="overdue-reschedule" data-overdue-reschedule data-kind="${item.kind}" data-day-id="${item.dayId || ""}" data-task-key="${item.taskKey || ""}" data-study-id="${item.studyId || ""}">
      <input name="date" type="date" value="${target}" min="${todayISO()}" aria-label="Nova data" />
      <button class="secondary-button mini-button" type="submit">Remanejar</button>
    </form>
  </article>`;
}

function scheduleDayPanel(day) {
  const outsideStudies = (state.outsideStudies || []).filter((study) => study.date === day.date);
  const reviewCount = errorReviewCountForDate(day.date);
  const scheduledLessonCount = [
    day.medcofClass && !isTaskRemapped(day, "medcof"),
    day.stepClass && !isTaskRemapped(day, "step")
  ].filter(Boolean).length;
  const totalItems = scheduledLessonCount + outsideStudies.length;
  const hasScheduledLessons = scheduledLessonCount > 0;
  const hasChecklistWork = hasScheduledLessons || outsideStudies.length > 0 || reviewCount > 0;
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
      ${reviewCount ? scheduleErrorReviewCard(day.date, reviewCount) : ""}
      ${outsideStudies.map(outsideStudyScheduleCard).join("")}
      ${totalItems ? "" : empty("Dia livre no cronograma.")}
    </div>
    ${
      hasChecklistWork
        ? `<footer class="schedule-day-footer">
      ${hasScheduledLessons ? scheduleQuestionReminder(day) : ""}
      ${hasScheduledLessons ? scheduleAnkiReminder() : ""}
      ${hasScheduledLessons ? scheduleWeeklyReviewReminder(day) : ""}
      <button class="secondary-button details-button" data-open-day="${day.id}">Detalhes de hoje</button>
    </footer>`
        : ""
    }
  </article>`;
}

function isWeekendFreeDay(day) {
  return /sabado|sábado|domingo/i.test(day.weekday || "") && !day.medcofClass && !day.stepClass;
}

function hasVisibleScheduledLesson(day) {
  return Boolean((day.medcofClass && !isTaskRemapped(day, "medcof")) || (day.stepClass && !isTaskRemapped(day, "step")));
}

function isTaskRemapped(day, key) {
  if (!day || !key) return false;
  if (day.remappedTasks?.[key]) return true;
  return Boolean((state.outsideStudies || []).some((study) => remappedStudySourceKey(study) === key && remappedStudySourceDay(study)?.id === day.id));
}

function remappedStudySourceDay(study) {
  const direct = state.schedule.find((day) => day.id === study.sourceDayId);
  if (direct) return direct;
  const sourceKey = remappedStudySourceKey(study);
  if (!sourceKey) return null;
  const lessonKey = cleanKey(study.lesson);
  if (!lessonKey) return null;
  return state.schedule.find((day) => cleanKey(sourceTaskTitle(day, sourceKey)) === lessonKey) || null;
}

function remappedStudySourceKey(study) {
  if (study?.sourceTaskKey) return study.sourceTaskKey;
  if (!looksLikeLegacyRemap(study)) return "";
  const lessonKey = cleanKey(study.lesson);
  if (!lessonKey) return "";
  const match = state.schedule.find((day) => cleanKey(day.medcofClass) === lessonKey || cleanKey(day.stepClass) === lessonKey);
  if (!match) return "";
  return cleanKey(match.medcofClass) === lessonKey ? "medcof" : "step";
}

function looksLikeLegacyRemap(study) {
  const marker = cleanKey([study.topic, study.notes, study.subject, study.system].filter(Boolean).join(" "));
  return marker.includes("remanejad") || marker.includes("remarcad");
}

function sourceTaskTitle(day, key) {
  if (key === "medcof") return day.medcofClass || "Aula MEDCOF";
  if (key === "step") return day.stepClass || "Aula B&B / Step 1";
  if (key === "questions") return day.plannedQuestions || "Bloco de questoes";
  if (key === "anki") return "Anki obrigatorio";
  if (key === "errors") return day.errorReview || "Revisao de erros";
  return "";
}

function cleanKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function scheduleQuestionReminder(day) {
  return `<article class="schedule-footer-task reminder">
    <div>
      <small>Questões recomendadas</small>
      <strong>${day.plannedQuestions || "Meta de questões"}</strong>
    </div>
  </article>`;
}

function scheduleAnkiReminder() {
  return `<article class="schedule-footer-task reminder">
    <div>
      <small>Anki</small>
      <strong>Somente lembrete</strong>
    </div>
  </article>`;
}

function scheduleWeeklyReviewReminder(day) {
  return `<article class="schedule-footer-task reminder">
    <div>
      <small>Revisão da semana</small>
      <strong>${day.errorReview || "Revisar os pontos importantes da semana"}</strong>
    </div>
  </article>`;
}

function errorReviewCountForDate(date) {
  return (state.errors || []).filter((error) => error.reviewDate === date && error.status !== "Resolvido").length;
}

function scheduleErrorReviewCard(date, count) {
  return `<article class="schedule-lesson-card error-review-schedule-card">
    <div class="task-number">!</div>
    <div class="lesson-main">
      <div class="lesson-title-row">
        <strong>Revisão do Caderno de Erros</strong>
        <em>Caderno de Erros</em>
      </div>
      <p>${count} questão(ões) programada(s) para revisão</p>
    </div>
    <div class="lesson-side">
      <button class="secondary-button mini-button" data-action="open-error-review-queue" data-review-date="${date}" type="button">Revisar agora</button>
    </div>
  </article>`;
}

function scheduleLessonCard(day, key, source, subject, title, priority) {
  if (!title) return "";
  const done = Boolean(day.tasks?.[key]);
  const remappedDate = day.remappedTasks?.[key];
  if (isTaskRemapped(day, key)) return "";
  const isRemappedPending = Boolean(remappedDate && !done);
  return `<article class="schedule-lesson-card ${done ? "done" : ""} ${isRemappedPending ? "remapped" : ""}">
    <label class="lesson-check" title="Marcar ${source}">
      <input type="checkbox" data-day-id="${day.id}" data-task="${key}" ${done ? "checked" : ""} ${isRemappedPending ? "disabled" : ""} />
      <span></span>
    </label>
    <div class="lesson-main">
      <div class="lesson-title-row">
        <strong>${subject}</strong>
        ${priority ? `<em>${priority}</em>` : ""}
      </div>
      <p>${title}</p>
    </div>
    <div class="lesson-side">
      <span>${source}</span>
      <small>${done ? "Feito" : remappedDate ? `Remanejado para ${fmtDate(remappedDate)}` : "Pendente"}</small>
    </div>
  </article>`;
}

function outsideStudyScheduleCard(study) {
  const done = Boolean(study.done);
  return `<article class="schedule-lesson-card outside-schedule-card ${done ? "done" : ""}">
    <label class="lesson-check" title="Marcar estudo fora do cronograma">
      <input type="checkbox" data-outside-study-id="${study.id}" ${done ? "checked" : ""} />
      <span></span>
    </label>
    <div class="lesson-main">
      <div class="lesson-title-row">
        <strong>${study.subject || "Estudo fora do cronograma"}</strong>
        <em>Fora do cronograma</em>
      </div>
      <p>${study.lesson || study.topic || "Estudo registrado"}</p>
      ${study.system || study.topic ? `<small>${[study.system, study.topic].filter(Boolean).join(" - ")}</small>` : ""}
    </div>
    <div class="lesson-side">
      <span>Extra</span>
      <small>${done ? "Feito" : "Pendente"}</small>
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
  const weekItems = state.schedule.filter((day) => day.week === week).sort((a, b) => a.date.localeCompare(b.date));
  const dayLabels = days.map((day, index) => {
    const date = weekItems[index]?.date;
    return date ? `${day} ${date.slice(8, 10)}/${date.slice(5, 7)}` : day;
  });
  return `<div class="board-grid" data-board-week="${week}">
    ${periods
      .map(
        (period) => `<div class="board-period">${period}</div>${days
          .map((day, index) => `<label class="board-cell"><span>${dayLabels[index]}</span><textarea data-board-cell="${period}.${day}" placeholder="${dayLabels[index]} ${period.toLowerCase()}">${escapeHtml(data[period]?.[day] || "")}</textarea></label>`)
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
        <p class="muted">Preencha apenas desempenho quantitativo. Erros ficam separados no Caderno de Erros.</p>
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
    </div>
    <section class="panel simulation-panel">${simulationForm()}</section>
    <section class="panel"><div class="section-title"><h2>Historico recente</h2><span>ultimos registros</span></div>${historyList(state.sessions.slice(-8).reverse())}</section>`;
}

function questionsForm() {
  return `<div class="section-title"><h2>Registrar questoes feitas</h2><span>simples e rapido</span></div>
  <form id="questionsForm" class="quick-question-form">
    <fieldset class="question-section">
      <legend>1. Dados do bloco</legend>
      <div class="quick-row two">
        ${fieldInput("date", "Data", "", "date", true, "", todayISO())}
        ${fieldSelect("source", "Fonte", SOURCE_OPTIONS)}
      </div>
    </fieldset>
    <fieldset class="question-section">
      <legend>2. Conteudo treinado</legend>
      <div class="quick-row question-classification">
        ${fieldMultiSelect("subject", "Materias", SUBJECT_OPTIONS)}
        ${fieldMultiSelect("system", "Sistemas", SYSTEM_OPTIONS)}
        ${fieldInput("topic", "Tema / observacao do bloco", "Opcional")}
      </div>
    </fieldset>
    <fieldset class="question-section">
      <legend>3. Resultado</legend>
      <div class="quick-row result-row">
        ${fieldInput("questions", "Numero de questoes", "20", "number", true, 'min="1"')}
        ${fieldInput("correct", "Acertos", "15", "number", true, 'min="0"')}
        ${fieldInput("minutes", "Minutos", "40", "number", false, 'min="0"')}
        ${fieldInput("accuracy", "Percentual", "Auto", "text", false, "readonly")}
        ${fieldInput("avgTime", "Tempo por questao", "Auto", "text", false, "readonly")}
      </div>
    </fieldset>
    <fieldset class="question-section">
      <legend>4. Observacoes</legend>
      <label class="field full-field"><span>Observacoes do bloco</span><textarea name="notes" placeholder="Opcional: dificuldade geral, fonte, comentarios..."></textarea></label>
    </fieldset>
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

function errorForm(error = null, formId = "errorForm") {
  const isEdit = Boolean(error);
  return `<div class="section-title"><h2>${isEdit ? "Editar erro" : "Novo erro"}</h2><span>banco de revisao</span></div>
  <form id="${formId}" class="form">
    ${isEdit ? `<input type="hidden" name="id" value="${error.id}" />` : ""}
    <label class="field"><span>Data</span><input name="date" type="date" value="${error?.date || todayISO()}" required /></label>
    ${fieldMultiSelect("subject", "Materia", SUBJECT_OPTIONS, true, error?.subject)}
    ${fieldMultiSelect("system", "Sistemas", SYSTEM_OPTIONS, true, error?.system)}
    ${fieldInput("topic", "Tema", "Tema especifico", "text", false, "", error?.topic)}
    <label class="field full-field"><span>Pergunta de revisao</span><textarea name="reviewQuestion" placeholder="Transforme o erro em uma pergunta para revisar depois." required>${escapeHtml(error?.reviewQuestion || "")}</textarea></label>
    <label class="field full-field"><span>Resposta esperada</span><textarea name="expectedAnswer" placeholder="Qual resposta voce espera acertar na revisao?">${escapeHtml(error?.expectedAnswer || "")}</textarea></label>
    ${fieldSelect("type", "Tipo de erro", ERROR_TYPE_OPTIONS, true, error?.type)}
    <label class="field"><span>Data de revisao</span><input name="reviewDate" type="date" value="${error?.reviewDate || ""}" /></label>
    ${fieldSelect("status", "Status", ERROR_STATUS_OPTIONS, true, error?.status)}
    <button class="primary-button" type="submit">${isEdit ? "Salvar alteracoes" : "Salvar erro"}</button>
  </form>`;
}

function renderDashboard(d) {
  return `<div class="grid metrics">
      ${lessonProgressMetric(d.lessonProgress)}
      ${metric("Questoes", d.totalQuestions, "total")}
      ${metric("Acertos", `${d.accuracy}%`, "geral")}
      ${metric("Hoje", d.todayQuestions, "questoes feitas")}
      ${metric("Semana", d.weekQuestions, "questoes feitas")}
      ${metric("Mes", d.monthQuestions, "questoes feitas")}
      ${metric("Erros", d.questionErrors, "em questoes")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">${barList(d.weekProgress, "Execucao da semana")}</section>
      <section class="panel">${barList(d.subjectPerformance, "Desempenho por materia")}</section>
      <section class="panel">${barList(d.systemPerformance, "Desempenho por sistema")}</section>
      <section class="panel">${barPairs(d.questionsBySource, "Questoes por fonte")}</section>
      <section class="panel">${barPairs(d.statusCounts, "Status do cronograma")}</section>
      <section class="panel wide">${errorDashboard(d.errorSummary)}</section>
      <section class="panel">${simulationCompare()}</section>
    </div>`;
}

function lessonProgressMetric(progress = { done: 0, total: 0, percent: 0 }) {
  return `<article class="metric lesson-progress-metric">
    <span>Progresso do Cronograma</span>
    <strong>${progress.percent}%</strong>
    <small>${progress.done} / ${progress.total} aulas concluídas</small>
    <div class="today-progress"><i style="width:${progress.percent}%"></i></div>
  </article>`;
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
      <div class="section-title"><h2>Aparencia</h2><span>tema do app</span></div>
      <div class="theme-options">
        <button class="secondary-button ${state.preferences.theme === "light" ? "active" : ""}" data-action="set-theme" data-theme-value="light" type="button">Modo claro</button>
        <button class="secondary-button ${state.preferences.theme === "dark" ? "active" : ""}" data-action="set-theme" data-theme-value="dark" type="button">Modo escuro</button>
      </div>
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
  document.querySelectorAll("[data-outside-study-id]").forEach((input) =>
    input.addEventListener("change", () => {
      state = setOutsideStudyDone(state, input.dataset.outsideStudyId, input.checked);
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
  document.querySelectorAll("form[data-overdue-reschedule]").forEach((form) => form.addEventListener("submit", handleOverdueReschedule));
  document.querySelectorAll("[data-board-cell]").forEach((cell) =>
    cell.addEventListener("input", () => {
      state = saveWeeklyBoard(state, `schedule:${selectedScheduleWeek}`, serializeBoardFromDOM());
      saveState(user.id, state);
    })
  );
  $("#questionsForm")?.addEventListener("input", updateQuestionCalculatedFields);
  $("#questionsForm")?.addEventListener("submit", handleQuestionsSubmit);
  document.querySelectorAll("[data-multi-field] input").forEach((input) => input.addEventListener("change", () => updateMultiSummary(input.closest("[data-multi-field]"))));
  $("#simulationForm")?.addEventListener("submit", handleSimulationSubmit);
  $("#outsideStudyForm")?.addEventListener("submit", handleOutsideStudySubmit);
  $("#errorForm")?.addEventListener("submit", handleErrorSubmit);
  $("#passwordForm")?.addEventListener("submit", handlePasswordSubmit);
  $("#importFile")?.addEventListener("change", handleImport);
}

function openDayModal(dayId) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day) return;
  const hasErrorReview = errorReviewCountForDate(day.date) > 0;
  const medcofDetail = isTaskRemapped(day, "medcof") ? "" : dailyDetailCard(day, "medcof", "Aula MEDCOF", day.medcofClass || "Sem aula MEDCOF");
  const stepDetail = isTaskRemapped(day, "step") ? "" : dailyDetailCard(day, "step", "Aula B&B / Step 1", day.stepClass || "Sem aula B&B");
  $("#modalContent").innerHTML = `<div class="modal-day">
    <div class="modal-day-header">
      <div>
        <p class="eyebrow">Detalhes de hoje</p>
        <h2>${fmtDate(day.date)}</h2>
      </div>
      <span class="status-pill ${statusClass(day.status)}">${day.status}</span>
    </div>
    <div class="day-progress-card">
      <div><span>Progresso do dia</span><strong>${taskCompletion(day, state)}%</strong></div>
      <div class="day-progress-bar"><i style="width:${taskCompletion(day, state)}%"></i></div>
    </div>
    <div class="daily-detail-grid">
      ${medcofDetail}
      ${stepDetail}
      ${hasVisibleScheduledLesson(day) ? dailyReminderCard("Questões recomendadas", day.plannedQuestions || "25 questões planejadas") : ""}
      ${hasVisibleScheduledLesson(day) ? dailyReminderCard("Anki", "Somente lembrete, sem necessidade de marcar") : ""}
      ${hasVisibleScheduledLesson(day) ? dailyReminderCard("Revisão da semana", day.errorReview || "Revisar os pontos importantes da semana") : ""}
      ${hasErrorReview ? dailyReminderCard("Revisão do Caderno de Erros", `${errorReviewCountForDate(day.date)} revisão(ões) programada(s)`) : ""}
    </div>
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

function dailyReminderCard(title, content) {
  return `<article class="daily-detail-card reminder">
    <strong>${title}</strong>
    <p>${content}</p>
    <span class="status-pill livre">Lembrete</span>
  </article>`;
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  const modalDayId = event.currentTarget.closest("#modalContent") ? event.currentTarget.dataset.dayId || state.activeTimer?.dayId : "";
  if (action === "goto-questions") currentView = "questions";
  if (action === "goto-errors") currentView = "errors";
  if (action === "edit-error") {
    openErrorModal(event.currentTarget.dataset.errorId);
    return;
  }
  if (action === "review-error") {
    openReviewErrorModal(event.currentTarget.dataset.errorId);
    return;
  }
  if (action === "open-error-review-queue") {
    openErrorReviewQueueModal(event.currentTarget.dataset.reviewDate || todayISO());
    return;
  }
  if (action === "mark-error-reviewed") {
    markErrorReviewed(event.currentTarget.dataset.errorId);
    return;
  }
  if (action === "reschedule-error-review") {
    rescheduleErrorReview(event.currentTarget.dataset.errorId);
    return;
  }
  if (action === "review-error-mastered") {
    state = updateErrorStatus(state, event.currentTarget.dataset.errorId, "Resolvido");
    $("#modal")?.close();
  }
  if (action === "review-error-repeat") {
    const error = state.errors.find((item) => item.id === event.currentTarget.dataset.errorId);
    if (error) state = updateError(state, error.id, { ...error, status: "Em revisao", reviewDate: addDays(todayISO(), 15) });
    $("#modal")?.close();
  }
  if (action === "delete-error") {
    if (!confirm("Apagar este erro do caderno?")) return;
    state = deleteError(state, event.currentTarget.dataset.errorId);
  }
  if (action === "set-theme") {
    state.preferences.theme = event.currentTarget.dataset.themeValue === "light" ? "light" : "dark";
    applyTheme();
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

function openErrorModal(errorId) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return;
  $("#modalContent").innerHTML = `<div class="modal-day">${errorForm(error, "errorEditForm")}</div>`;
  if (!$("#modal").open) $("#modal").showModal();
  $("#errorEditForm").addEventListener("submit", handleErrorSubmit);
}

function openReviewErrorModal(errorId) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return;
  $("#modalContent").innerHTML = `<div class="modal-day review-error-modal">
    <div class="section-title"><h2>Voce considera este erro dominado?</h2><span>${error.topic || "Sem tema"}</span></div>
    <article class="task-card">
      <strong>Pergunta de revisao</strong>
      <p>${error.reviewQuestion || "Sem pergunta de revisao."}</p>
      <strong>Resposta esperada</strong>
      <p>${error.expectedAnswer || "Sem resposta esperada."}</p>
    </article>
    <div class="modal-actions">
      <button class="primary-button" data-action="review-error-mastered" data-error-id="${error.id}" type="button">Sim, dominei</button>
      <button class="secondary-button" data-action="review-error-repeat" data-error-id="${error.id}" type="button">Ainda nao dominei</button>
    </div>
  </div>`;
  if (!$("#modal").open) $("#modal").showModal();
  $("#modalContent").querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
}

function openErrorReviewQueueModal(reviewDate = todayISO()) {
  const exact = reviewDate > todayISO();
  const items = dueErrorReviewItems(reviewDate, exact);
  const counts = errorReviewCounts(reviewDate, exact);
  $("#modalContent").innerHTML = `<div class="modal-day review-error-modal">
    <div class="section-title"><h2>Revisão do Caderno de Erros</h2><span>${fmtDate(reviewDate)} · ${counts.total} pendente(s)</span></div>
    <div class="review-summary-grid modal-review-summary">
      <div><small>Hoje</small><strong>${counts.today}</strong></div>
      <div><small>Atrasadas</small><strong>${counts.overdue}</strong></div>
      <div><small>Total</small><strong>${counts.total}</strong></div>
    </div>
    <div class="record-list review-queue-list">${items.map(errorReviewQueueCard).join("") || empty("Nenhuma questão prevista para revisão agora.")}</div>
  </div>`;
  if (!$("#modal").open) $("#modal").showModal();
  $("#modalContent").querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
}

function errorReviewQueueCard(error) {
  return `<article class="task-card review-queue-card" data-review-card="${error.id}">
    <div><strong>${error.topic || error.subject || "Sem tema"}</strong><span>${fmtDate(error.reviewDate)} - ${error.type || "Erro"}</span></div>
    <p>${error.reviewQuestion || "Sem pergunta de revisão."}</p>
    ${error.expectedAnswer ? `<small>Resposta esperada: ${error.expectedAnswer}</small>` : ""}
    <label class="field full-field"><span>Observações adicionais</span><textarea data-review-notes placeholder="O que ficou claro ou ainda precisa revisar?">${escapeHtml(error.reviewNotes || "")}</textarea></label>
    <div class="review-card-actions">
      <label class="field"><span>Nova data de revisão</span><input data-review-date type="date" value="${addDays(todayISO(), 15)}" /></label>
      <button class="primary-button mini-button" data-action="mark-error-reviewed" data-error-id="${error.id}" type="button">Marcar revisada</button>
      <button class="secondary-button mini-button" data-action="reschedule-error-review" data-error-id="${error.id}" type="button">Reagendar</button>
    </div>
  </article>`;
}

function markErrorReviewed(errorId) {
  const card = document.querySelector(`[data-review-card="${errorId}"]`);
  const nextDate = card?.querySelector("[data-review-date]")?.value || addDays(todayISO(), 15);
  const notes = card?.querySelector("[data-review-notes]")?.value || "";
  state = updateError(state, errorId, { ...(state.errors.find((item) => item.id === errorId) || {}), status: "Revisado", reviewDate: nextDate, reviewNotes: notes });
  saveState(user.id, state);
  openErrorReviewQueueModal();
  render();
}

function rescheduleErrorReview(errorId) {
  const card = document.querySelector(`[data-review-card="${errorId}"]`);
  const nextDate = card?.querySelector("[data-review-date]")?.value || addDays(todayISO(), 15);
  const notes = card?.querySelector("[data-review-notes]")?.value || "";
  state = updateError(state, errorId, { ...(state.errors.find((item) => item.id === errorId) || {}), status: "Revisado", reviewDate: nextDate, reviewNotes: notes });
  saveState(user.id, state);
  openErrorReviewQueueModal();
  render();
}

function handleQuestionsSubmit(event) {
  event.preventDefault();
  const data = formToObject(event.currentTarget);
  state = addQuestionSession(state, {
    ...data,
    mode: "Nao informado",
    selection: "Por assunto",
    format: "Bloco comum"
  });
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
  const data = formToObject(event.currentTarget);
  state = addOutsideStudy(state, data);
  const matchingDay = state.schedule.find((day) => day.date === data.date);
  if (matchingDay?.week) selectedScheduleWeek = matchingDay.week;
  event.currentTarget.reset();
  persistRender();
}

function handleOverdueReschedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const targetDate = new FormData(form).get("date") || todayISO();
  if (form.dataset.kind === "outside") {
    const study = (state.outsideStudies || []).find((item) => item.id === form.dataset.studyId);
    if (study) {
      study.date = targetDate;
      study.done = false;
      study.completedAt = "";
    }
  } else {
    const day = state.schedule.find((item) => item.id === form.dataset.dayId);
    const taskKey = form.dataset.taskKey;
    if (day && taskKey) {
      const existing = (state.outsideStudies || []).find((study) => study.sourceTaskKey === taskKey && remappedStudySourceDay(study)?.id === day.id);
      if (existing) {
        Object.assign(existing, rescheduledPayload(day, taskKey, targetDate), { id: existing.id, createdAt: new Date().toISOString(), completedAt: "", manualCompleted: false });
      } else {
        state = addOutsideStudy(state, rescheduledPayload(day, taskKey, targetDate));
      }
      day.remappedTasks ||= {};
      day.remappedTasks[taskKey] = targetDate;
      day.tasks[taskKey] = false;
    }
  }
  const matchingDay = state.schedule.find((day) => day.date === targetDate);
  if (matchingDay?.week) selectedScheduleWeek = matchingDay.week;
  persistRender();
}

function rescheduledPayload(day, taskKey, date) {
  const payloads = {
    medcof: {
      subject: day.area || "MEDCOF",
      system: day.medcofPriority || day.monthlyPriority || "",
      topic: "Aula remanejada",
      lesson: day.medcofClass || "Aula MEDCOF"
    },
    step: {
      subject: day.stepSystem || "Step 1",
      system: "B&B / Step 1",
      topic: "Aula remanejada",
      lesson: day.stepClass || "Aula B&B / Step 1"
    },
    questions: {
      subject: day.area || day.stepSystem || "Questoes",
      system: "",
      topic: "Questoes remanejadas",
      lesson: day.plannedQuestions || "Bloco de questoes"
    },
    anki: {
      subject: "Anki",
      system: "",
      topic: "Anki remanejado",
      lesson: "Anki obrigatorio"
    },
    errors: {
      subject: "Caderno de Erros",
      system: "",
      topic: "Revisao remanejada",
      lesson: day.errorReview || "Revisao de erros"
    }
  };
  return { date, done: false, sourceDayId: day.id, sourceTaskKey: taskKey, ...(payloads[taskKey] || payloads.questions) };
}

function handleErrorSubmit(event) {
  event.preventDefault();
  const data = formToObject(event.currentTarget);
  state = data.id ? updateError(state, data.id, data) : addError(state, data);
  event.currentTarget.reset();
  if (event.currentTarget.id === "errorEditForm") $("#modal").close();
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
  const hasMinutes = form.minutes.value !== "";
  const accuracy = questions ? `${pct(correct, questions)}%` : "";
  const avg = questions && hasMinutes ? `${Math.round((minutes * 60) / questions)} s/questao` : "";
  form.accuracy.value = accuracy;
  form.avgTime.value = avg;
  $("#qAccuracyPreview") && ($("#qAccuracyPreview").textContent = accuracy || "-");
  $("#qAvgPreview") && ($("#qAvgPreview").textContent = avg || "-");
}

function errorCard(error) {
  return `<article class="task-card">
    <div><strong>${error.topic || error.subject}</strong><span>${fmtDate(error.date)} - ${error.subject}</span></div>
    ${error.reviewQuestion ? `<small>Pergunta: ${error.reviewQuestion}</small>` : ""}
    ${error.expectedAnswer ? `<small>Resposta esperada: ${error.expectedAnswer}</small>` : ""}
    <small>${error.type} - ${error.subject} - ${error.system}</small>
    <div class="error-card-actions">
      <select data-error-status="${error.id}">${ERROR_STATUS_OPTIONS.map((status) => `<option ${status === error.status ? "selected" : ""}>${status}</option>`).join("")}</select>
      <button class="secondary-button mini-button" data-action="edit-error" data-error-id="${error.id}" type="button">Editar</button>
      <button class="danger-button mini-button" data-action="delete-error" data-error-id="${error.id}" type="button">Apagar</button>
    </div>
  </article>`;
}

function outsideStudyForm() {
  return `<form id="outsideStudyForm" class="form compact outside-study-form">
    ${fieldInput("date", "Data", "", "date", true, "", todayISO())}
    ${fieldSelect("subject", "Materia", SUBJECT_OPTIONS)}
    ${fieldSelect("system", "Sistema", SYSTEM_OPTIONS, false)}
    ${fieldInput("topic", "Tema", "Tema")}
    ${fieldInput("lesson", "Aula estudada", "Aula estudada")}
    <button class="primary-button" type="submit">Adicionar estudo fora do cronograma</button>
  </form>`;
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

function fieldInput(name, label, placeholder = "", type = "text", required = false, extra = "", value = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(value || "")}" ${required ? "required" : ""} ${extra} /></label>`;
}

function fieldSelect(name, label, options, required = true, value = "") {
  return `<label class="field"><span>${label}</span><select name="${name}" ${required ? "required" : ""}><option value="">Escolha</option>${options.map((option) => `<option ${option === value ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
}

function fieldMultiSelect(name, label, options, required = true, value = "") {
  const selected = splitLabels(value);
  const summary = selected.length ? `${selected.length} selecionada(s)` : "Selecionar";
  return `<details class="field multi-field" data-multi-field="${name}">
    <summary><span>${label}</span><strong data-multi-summary>${summary}</strong></summary>
    <div class="multi-options" role="group" aria-label="${label}">${options
      .map((option) => `<label><input type="checkbox" name="${name}" value="${option}" ${selected.includes(option) ? "checked" : ""} /><span>${option}</span></label>`)
      .join("")}</div>
  </details>`;
}

function formToObject(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  form.querySelectorAll("[data-multi-field]").forEach((field) => {
    const name = field.dataset.multiField;
    data[name] = formData.getAll(name).map((item) => String(item).trim()).filter(Boolean).join(", ");
  });
  return data;
}

function updateMultiSummary(field) {
  if (!field) return;
  const count = field.querySelectorAll("input:checked").length;
  const summary = field.querySelector("[data-multi-summary]");
  if (summary) summary.textContent = count ? `${count} selecionada(s)` : "Selecionar";
}

function splitLabels(value = "") {
  return String(value || "")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
      ${metric("Resolvidos", summary.resolved, "resolvidos")}
      ${metric("Recorrentes", summary.recurring, "repetidos")}
      ${metric("Revisão vencida", summary.overdue, "para revisar")}
    </div>
    <article class="review-summary-card dashboard-review-summary">
      <div class="review-summary-grid">
        <div><small>Hoje</small><strong>${summary.scheduledToday}</strong></div>
        <div><small>Atrasadas</small><strong>${summary.overdueReview}</strong></div>
        <div><small>Total pendente</small><strong>${summary.pendingReview}</strong></div>
      </div>
      <button class="primary-button" data-action="open-error-review-queue" type="button" ${summary.pendingReview ? "" : "disabled"}>Revisar agora</button>
    </article>
    ${errorsDueToday(summary.dueToday)}
    <div class="error-dashboard-grid">
      ${miniList(summary.topics, "Temas mais errados")}
      ${simpleRank(summary.byType, "Erros por tipo")}
      ${simpleRank(summary.bySubject, "Erros por matéria")}
      ${simpleRank(summary.bySystem, "Erros por sistema")}
    </div>`;
}

function errorsDueToday(items = []) {
  return `<section class="error-review-today">
    <div class="section-title compact-title"><h2>Erros para revisar hoje</h2><span>${items.length}</span></div>
    <div class="record-list">${
      items
        .map(
          (error) => `<article class="error-review-item">
            <strong>${error.topic}</strong>
            <p>${error.reviewQuestion}</p>
            <small>${error.type} - ${error.status}</small>
          </article>`
        )
        .join("") || empty("Nenhum erro para revisar hoje.")
    }</div>
  </section>`;
}

function miniList(items, title) {
  return `<div><div class="section-title compact-title"><h2>${title}</h2><span>${items.length}</span></div>
    <div class="record-list">${items.map((item) => `<div class="list-row"><strong>${item.label}</strong><span>${item.value}</span></div>`).join("") || empty("Sem dados.")}</div></div>`;
}

function simpleRank(map, title) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<div><div class="section-title compact-title"><h2>${title}</h2><span>${entries.length}</span></div>
    <div class="record-list">${entries.map(([label, value]) => `<div class="list-row"><strong>${label}</strong><span>${value}</span></div>`).join("") || empty("Sem dados.")}</div></div>`;
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
