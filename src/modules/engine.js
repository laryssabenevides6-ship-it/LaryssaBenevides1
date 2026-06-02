import { addDays, clamp, groupCount, pct, safeNumber, todayISO, topEntries, uid } from "./utils.js";

export const TASKS = [
  ["medcof", "Aula MEDCOF"],
  ["step", "Aula B&B / Step 1"],
  ["questions", "Questoes"],
  ["anki", "Anki"],
  ["errors", "Revisao de erros"]
];

export const REQUIRED_TASKS = ["medcof", "step", "anki", "errors"];

export function runAutomations(state, now = todayISO()) {
  state.schedule.forEach((day) => {
    day.tasks = { medcof: false, step: false, questions: false, anki: false, errors: false, ...(day.tasks || {}) };
    day.status = dayStatus(day, now, state);
    day.movedToBacklog = day.date < now && !["Feito", "Livre"].includes(day.status);
  });
  return state;
}

export function setTask(state, dayId, taskKey, done, now = todayISO()) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day || !TASKS.some(([key]) => key === taskKey)) return state;
  day.tasks[taskKey] = Boolean(done);
  day.status = dayStatus(day, now, state);
  day.completedAt = day.status === "Feito" ? new Date().toISOString() : "";
  return runAutomations(state, now);
}

export function startStudyTimer(state, dayId, taskKey, nowDate = new Date()) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day || !["medcof", "step"].includes(taskKey)) return state;
  if (state.activeTimer) return state;
  state.activeTimer = {
    id: uid("timer"),
    dayId,
    taskKey,
    title: timerTitle(day, taskKey),
    subject: day.area || "Cronograma",
    system: day.stepSystem || day.secondaryBlock || "",
    startedAt: nowDate.toISOString(),
    pausedAt: "",
    pausedMs: 0
  };
  return state;
}

export function pauseStudyTimer(state, nowDate = new Date()) {
  if (!state.activeTimer || state.activeTimer.pausedAt) return state;
  state.activeTimer.pausedAt = nowDate.toISOString();
  return state;
}

export function resumeStudyTimer(state, nowDate = new Date()) {
  const timer = state.activeTimer;
  if (!timer?.pausedAt) return state;
  timer.pausedMs = (timer.pausedMs || 0) + Math.max(0, nowDate - new Date(timer.pausedAt));
  timer.pausedAt = "";
  return state;
}

export function finishStudyTimer(state, nowDate = new Date()) {
  const timer = state.activeTimer;
  if (!timer) return state;
  const currentPauseMs = timer.pausedAt ? Math.max(0, nowDate - new Date(timer.pausedAt)) : 0;
  const elapsedMs = Math.max(0, nowDate - new Date(timer.startedAt) - (timer.pausedMs || 0) - currentPauseMs);
  const day = state.schedule.find((item) => item.id === timer.dayId);
  state.timers ||= [];
  state.timers.push({
    id: timer.id,
    dayId: timer.dayId,
    taskKey: timer.taskKey,
    title: timer.title,
    subject: timer.subject,
    system: timer.system,
    date: nowDate.toISOString().slice(0, 10),
    startedAt: timer.startedAt,
    finishedAt: nowDate.toISOString(),
    minutes: Math.max(1, Math.round(elapsedMs / 60000)),
    lesson: timerTitle(day, timer.taskKey)
  });
  state.activeTimer = null;
  return state;
}

export function saveWeeklyBoard(state, week, content) {
  if (!week) return state;
  state.weeklyBoards[week] = {
    content,
    updatedAt: new Date().toISOString()
  };
  return state;
}

export function addQuestionSession(state, payload) {
  const questions = Math.max(0, safeNumber(payload.questions));
  const correct = clamp(safeNumber(payload.correct), 0, questions);
  const minutes = Math.max(0, safeNumber(payload.minutes));
  const hasMinutes = payload.minutes !== undefined && payload.minutes !== "";
  const accuracy = pct(correct, questions);
  state.sessions.push({
    id: uid("questions"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    source: payload.source || "MEDCOF",
    mode: payload.mode || "Tutor",
    selection: payload.selection || "Por assunto",
    format: payload.format || "Bloco comum",
    subject: cleanText(payload.subject) || "Nao classificado",
    system: cleanText(payload.system) || "Nao classificado",
    topic: cleanText(payload.topic),
    questions,
    correct,
    accuracy,
    minutes,
    secondsPerQuestion: questions && hasMinutes ? Math.round((minutes * 60) / questions) : "",
    notes: payload.notes || ""
  });
  return state;
}

export function addOutsideStudy(state, payload) {
  const minutes = Math.max(0, safeNumber(payload.minutes));
  state.outsideStudies ||= [];
  state.outsideStudies.push({
    id: uid("outside"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    subject: payload.subject || "Nao classificado",
    system: payload.system || "",
    topic: payload.topic || "",
    lesson: payload.lesson || "",
    notes: payload.notes || "",
    minutes,
    done: Boolean(payload.done),
    sourceDayId: payload.sourceDayId || "",
    sourceTaskKey: payload.sourceTaskKey || ""
  });
  return state;
}

export function removeOutsideStudy(state, studyId) {
  state.outsideStudies = (state.outsideStudies || []).filter((study) => study.id !== studyId);
  return state;
}

export function setOutsideStudyDone(state, studyId, done) {
  const study = (state.outsideStudies || []).find((item) => item.id === studyId);
  if (!study) return state;
  study.done = Boolean(done);
  study.completedAt = study.done ? new Date().toISOString() : "";
  if (study.sourceDayId && study.sourceTaskKey) {
    const day = state.schedule.find((item) => item.id === study.sourceDayId);
    if (day && TASKS.some(([key]) => key === study.sourceTaskKey)) {
      day.tasks[study.sourceTaskKey] = study.done;
      day.status = dayStatus(day, todayISO(), state);
    }
  }
  return state;
}

export function addSimulation(state, payload) {
  const areas = ["Clinica Medica", "Cirurgia", "Pediatria", "GO", "Preventiva"];
  const areaBreakdown = areas.map((area) => {
    const key = area.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, "");
    const questions = safeNumber(payload[`${key}Questions`]);
    const correct = clamp(safeNumber(payload[`${key}Correct`]), 0, questions);
    return { area, questions, correct, errors: Math.max(0, questions - correct), accuracy: pct(correct, questions) };
  });
  const questions = areaBreakdown.reduce((sum, area) => sum + area.questions, 0);
  const correct = areaBreakdown.reduce((sum, area) => sum + area.correct, 0);
  const ranked = areaBreakdown.filter((area) => area.questions > 0).sort((a, b) => b.accuracy - a.accuracy);
  const previous = state.simulations.at(-1);
  const accuracy = pct(correct, questions);
  state.simulations.push({
    id: uid("sim"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    name: payload.name || `Simulado ${state.simulations.length + 1}`,
    questions,
    correct,
    errors: Math.max(0, questions - correct),
    minutes: safeNumber(payload.minutes),
    accuracy,
    areaBreakdown,
    strongestArea: ranked[0]?.area || "",
    weakestArea: ranked.at(-1)?.area || "",
    delta: previous ? accuracy - previous.accuracy : 0,
    scheduledDate: payload.scheduledDate || ""
  });
  return state;
}

export function addError(state, payload) {
  state.errors.push({
    id: uid("error"),
    createdAt: new Date().toISOString(),
    ...errorPayload(payload)
  });
  return state;
}

export function updateError(state, errorId, payload) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return state;
  Object.assign(error, errorPayload(payload), { updatedAt: new Date().toISOString() });
  return state;
}

export function deleteError(state, errorId) {
  state.errors = state.errors.filter((item) => item.id !== errorId);
  return state;
}

function errorPayload(payload) {
  const date = payload.date || todayISO();
  return {
    date,
    source: payload.source || "",
    target: payload.target || "",
    subject: cleanText(payload.subject) || "Nao classificado",
    system: cleanText(payload.system) || "Nao classificado",
    topic: cleanText(payload.topic),
    summary: cleanText(payload.summary),
    reviewQuestion: cleanText(payload.reviewQuestion),
    expectedAnswer: cleanText(payload.expectedAnswer),
    reviewNotes: cleanText(payload.reviewNotes),
    type: normalizeErrorType(payload.type),
    severity: payload.severity || "",
    reviewDate: payload.reviewDate || addDays(date, 7),
    status: normalizeErrorStatus(payload.status || "Aberto")
  };
}

export function updateErrorStatus(state, errorId, status) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return state;
  error.status = normalizeErrorStatus(status);
  return state;
}

export function getDerived(state, now = todayISO()) {
  const schedule = state.schedule || [];
  const today = schedule.find((item) => item.date === now) || schedule.find((item) => item.date > now) || schedule[0];
  const week = today?.week || getWeekKey(now);
  const weekDays = schedule.filter((item) => item.week === week);
  const completedDays = schedule.filter((item) => item.status === "Feito");
  const lessonTotals = schedule.reduce(
    (acc, day) => {
      const keys = lessonTaskKeys(day);
      acc.total += keys.length;
      acc.done += keys.filter((key) => day.tasks?.[key]).length;
      return acc;
    },
    { total: 0, done: 0 }
  );
  const totalQuestions = state.sessions.reduce((sum, item) => sum + item.questions, 0);
  const totalCorrect = state.sessions.reduce((sum, item) => sum + item.correct, 0);
  const outsideStudies = state.outsideStudies || [];
  const timerMinutes = (state.timers || []).reduce((sum, item) => sum + (item.minutes || 0), 0);
  const totalMinutes =
    state.sessions.reduce((sum, item) => sum + item.minutes, 0) +
    state.simulations.reduce((sum, item) => sum + item.minutes, 0) +
    outsideStudies.reduce((sum, item) => sum + item.minutes, 0) +
    timerMinutes;
  const openErrors = state.errors.filter((error) => error.status === "Aberto" || error.status === "Recorrente");
  const weekSessions = state.sessions.filter((item) => item.date >= addDays(now, -6) && item.date <= now);
  const weekQuestions = weekSessions.reduce((sum, item) => sum + item.questions, 0);
  const todayQuestions = state.sessions.filter((item) => item.date === now).reduce((sum, item) => sum + item.questions, 0);
  const monthPrefix = now.slice(0, 7);
  const monthQuestions = state.sessions.filter((item) => item.date?.startsWith(monthPrefix)).reduce((sum, item) => sum + item.questions, 0);
  const overdueDays = schedule.filter((item) => item.movedToBacklog);

  return {
    now,
    today,
    week,
    weekDays,
    overdueDays,
    completedDays,
    lessonProgress: { ...lessonTotals, percent: pct(lessonTotals.done, lessonTotals.total) },
    progress: pct(lessonTotals.done, lessonTotals.total),
    totalQuestions,
    totalCorrect,
    accuracy: pct(totalCorrect, totalQuestions),
    hours: Math.round((totalMinutes / 60) * 10) / 10,
    studyTimerHours: Math.round((timerMinutes / 60) * 10) / 10,
    activeTimer: state.activeTimer,
    openErrors,
    outsideStudies,
    outsideHours: Math.round((outsideStudies.reduce((sum, item) => sum + item.minutes, 0) / 60) * 10) / 10,
    todayQuestions,
    weekQuestions,
    monthQuestions,
    questionErrors: Math.max(0, totalQuestions - totalCorrect),
    alerts: buildAlerts(state, now, overdueDays, openErrors, weekQuestions),
    subjectPerformance: summarizeAccuracy(state.sessions, "subject"),
    systemPerformance: summarizeAccuracy(state.sessions, "system"),
    questionsBySource: groupCount(state.sessions, (item) => item.source),
    statusCounts: groupCount(schedule, (item) => item.status),
    weekProgress: weekDays.map((day) => ({ label: dayLabel(day), value: taskCompletion(day, state) })),
    errorSummary: summarizeErrors(state.errors, now)
  };
}

function timerTitle(day, taskKey) {
  if (!day) return "Estudo do cronograma";
  if (taskKey === "medcof") return day.medcofClass || "Aula MEDCOF";
  if (taskKey === "step") return day.stepClass || "Aula B&B / Step 1";
  return "Estudo do cronograma";
}

export function taskCompletion(day, state = null) {
  const keys = lessonTaskKeys(day).filter((key) => !isTaskRemapped(state, day, key));
  if (!keys.length) return 0;
  return pct(keys.filter((key) => day.tasks?.[key]).length, keys.length);
}

function lessonTaskKeys(day) {
  return [
    day.medcofClass ? "medcof" : "",
    day.stepClass ? "step" : ""
  ].filter(Boolean);
}

export function taskLabel(key) {
  return TASKS.find(([taskKey]) => taskKey === key)?.[1] || key;
}

export function taskStatus(day, key) {
  return day.tasks?.[key] ? "Feito" : "Pendente";
}

export function dayStatus(day, now = todayISO(), state = null) {
  if (isFreeDay(day)) return "Livre";
  const required = requiredTaskKeys(day, state);
  const done = required.filter((key) => day.tasks?.[key]).length;
  if (required.length && done === required.length) return "Feito";
  if (day.date < now) return "Atrasado";
  if (done > 0) return "Parcial";
  return "Pendente";
}

function requiredTaskKeys(day, state = null) {
  return [
    day.medcofClass && !isTaskRemapped(state, day, "medcof") ? "medcof" : "",
    day.stepClass && !isTaskRemapped(state, day, "step") ? "step" : "",
    "anki",
    hasErrorReviewOnDate(state, day.date) || day.tasks?.errors ? "errors" : ""
  ].filter(Boolean);
}

function isTaskRemapped(state, day, key) {
  if (!day || !key) return false;
  if (day.remappedTasks?.[key]) return true;
  return Boolean(state?.outsideStudies?.some((study) => study.sourceDayId === day.id && study.sourceTaskKey === key));
}

function hasErrorReviewOnDate(state, date) {
  return Boolean(state?.errors?.some((error) => error.reviewDate === date && error.status !== "Resolvido"));
}

export function dayLabel(day) {
  return `${day.weekday || ""} ${day.date?.slice(5) || ""}`.trim();
}

function buildAlerts(state, now, overdueDays, openErrors, weekQuestions) {
  const alerts = [];
  const today = state.schedule.find((item) => item.date === now);
  const errorSummary = summarizeErrors(state.errors, now);

  if (today && !today.tasks?.anki) alerts.push({ tone: "info", text: "Anki pendente hoje." });
  if (today && !["Feito", "Livre"].includes(today.status)) alerts.push({ tone: "warning", text: "Tarefa obrigatoria incompleta no plano de hoje." });
  if (errorSummary.dueToday.length) alerts.push({ tone: "danger", text: `Revisoes pendentes: ${errorSummary.dueToday.length} erros para revisar hoje.` });
  if (errorSummary.recurringTopics[0]) alerts.push({ tone: "warning", text: `Tema recorrente: ${errorSummary.recurringTopics[0].label}.` });
  if (errorSummary.topErrorConcentration) alerts.push({ tone: "warning", text: `Maior concentracao de erros: ${errorSummary.topErrorConcentration}.` });
  if (weekQuestions < 80) alerts.push({ tone: "info", text: `Poucas questoes na semana: ${weekQuestions}/80.` });
  return alerts.slice(0, 6);
}

function isFreeDay(day) {
  return /sabado|sábado|domingo/i.test(day.weekday || "") && !day.medcofClass && !day.stepClass;
}

function cleanText(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeErrorType(type = "") {
  const allowed = [
    "Falta de conteudo",
    "Erro de interpretacao",
    "Tempo",
    "Chute"
  ];
  const migration = {
    "Conduta/protocolo": "Falta de conteudo",
    "Confusao conceitual": "Falta de conteudo",
    "Fisiopatologia/mecanismo": "Falta de conteudo",
    "Interpretacao do enunciado": "Erro de interpretacao",
    "Desatencao/leitura rapida": "Erro de interpretacao",
    "Tempo/pressa": "Tempo",
    "Chute/incerteza": "Chute"
  };
  const migrated = migration[type] || type;
  return allowed.includes(migrated) ? migrated : "Falta de conteudo";
}

function normalizeErrorStatus(status = "") {
  if (status === "Em revisao") return "Revisado";
  if (status === "Fechado") return "Resolvido";
  return ["Aberto", "Revisado", "Resolvido", "Recorrente"].includes(status) ? status : "Aberto";
}

function splitLabels(value = "") {
  return String(value || "")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupMultiCount(items, key) {
  return items.reduce((acc, item) => {
    const labels = splitLabels(item[key]);
    (labels.length ? labels : ["Nao classificado"]).forEach((label) => {
      acc[label] = (acc[label] || 0) + 1;
    });
    return acc;
  }, {});
}

function topMapEntry(map = {}) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0];
}

function summarizeErrors(errors = [], now = todayISO()) {
  const open = errors.filter((error) => error.status === "Aberto");
  const resolved = errors.filter((error) => error.status === "Resolvido");
  const recurring = errors.filter((error) => error.status === "Recorrente");
  const dueToday = errors.filter((error) => error.reviewDate && error.reviewDate <= now && error.status !== "Resolvido");
  const scheduledToday = dueToday.filter((error) => error.reviewDate === now);
  const overdueReview = dueToday.filter((error) => error.reviewDate < now);
  const topicCounts = groupCount(errors, (error) => error.topic || "Sem tema");
  const recurringTopics = topEntries(topicCounts, 20)
    .filter(([, value]) => value >= 3)
    .map(([label, value]) => ({ label, value }));
  const bySubject = groupMultiCount(errors, "subject");
  const bySystem = groupMultiCount(errors, "system");
  const topSubject = topMapEntry(bySubject);
  const topSystem = topMapEntry(bySystem);
  return {
    total: errors.length,
    open: open.length,
    resolved: resolved.length,
    recurring: Math.max(recurring.length, recurringTopics.length),
    overdue: dueToday.length,
    scheduledToday: scheduledToday.length,
    overdueReview: overdueReview.length,
    pendingReview: dueToday.length,
    dueToday: dueToday
      .slice()
      .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))
      .map((error) => ({
        id: error.id,
        topic: error.topic || error.subject || "Sem tema",
        reviewQuestion: error.reviewQuestion || error.summary || "Sem pergunta de revisao",
        type: error.type || "Nao classificado",
        severity: error.severity || "Nao informada",
        status: error.status || "Aberto"
      })),
    recurringTopics,
    topErrorConcentration: topSubject || topSystem ? [topSubject?.[0], topSystem?.[0]].filter(Boolean).join(" / ") : "",
    topics: topEntries(topicCounts, 6).map(([label, value]) => ({ label, value })),
    byType: groupCount(errors, (error) => error.type),
    bySubject,
    bySystem
  };
}

function summarizeAccuracy(items, key) {
  const map = items.reduce((acc, item) => {
    const label = item[key] || "Nao classificado";
    acc[label] ||= { label, questions: 0, correct: 0 };
    acc[label].questions += item.questions;
    acc[label].correct += item.correct;
    return acc;
  }, {});
  return Object.values(map)
    .map((item) => ({ ...item, value: pct(item.correct, item.questions) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 8);
}

function getWeekKey(dateISO) {
  const date = new Date(`${dateISO}T12:00:00`);
  const first = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - first) / 86400000);
  return `${date.getFullYear()}-W${String(Math.ceil((days + first.getDay() + 1) / 7)).padStart(2, "0")}`;
}
