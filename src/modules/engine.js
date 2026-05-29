import { addDays, clamp, diffDays, groupCount, pct, safeNumber, todayISO, topEntries, uid } from "./utils.js";

export const TASKS = [
  ["medcof", "Aula MEDCOF"],
  ["step", "Aula B&B / Step 1"],
  ["questions", "Questoes"],
  ["anki", "Anki"],
  ["errors", "Revisao de erros"],
  ["interleaving", "Interleaving"]
];

export const REQUIRED_TASKS = ["medcof", "step", "questions", "anki", "errors", "interleaving"];

export function runAutomations(state, now = todayISO()) {
  state.schedule.forEach((day) => {
    day.tasks = { medcof: false, step: false, questions: false, anki: false, errors: false, interleaving: false, ...(day.tasks || {}) };
    day.status = day.rescheduledTo ? "Reprogramado" : dayStatus(day, now);
    day.movedToBacklog = day.date < now && day.status !== "Concluido" && day.status !== "Reprogramado";
  });
  return state;
}

export function setTask(state, dayId, taskKey, done, now = todayISO()) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day || !TASKS.some(([key]) => key === taskKey)) return state;
  day.tasks[taskKey] = Boolean(done);
  day.status = dayStatus(day, now);
  day.completedAt = day.status === "Concluido" ? new Date().toISOString() : "";
  return runAutomations(state, now);
}

export function rescheduleDay(state, dayId, dateISO, now = todayISO()) {
  const day = state.schedule.find((item) => item.id === dayId);
  if (!day || !dateISO) return state;
  day.rescheduledTo = dateISO;
  day.status = "Reprogramado";
  day.movedToBacklog = false;
  return runAutomations(state, now);
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
  const accuracy = pct(correct, questions);
  state.sessions.push({
    id: uid("questions"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    source: payload.source || "MEDCOF",
    mode: payload.mode || "Tutor",
    selection: payload.selection || "Por assunto",
    format: payload.format || "Bloco comum",
    target: payload.target || "Ambos",
    subject: payload.subject || "Nao classificado",
    system: payload.system || "Nao classificado",
    topic: payload.topic || "",
    questions,
    correct,
    accuracy,
    minutes,
    secondsPerQuestion: questions ? Math.round((minutes * 60) / questions) : 0,
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
    minutes
  });
  return state;
}

export function removeOutsideStudy(state, studyId) {
  state.outsideStudies = (state.outsideStudies || []).filter((study) => study.id !== studyId);
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
    date: payload.date || todayISO(),
    source: payload.source || "MEDCOF",
    subject: payload.subject || "Nao classificado",
    system: payload.system || "Nao classificado",
    topic: payload.topic || "",
    summary: payload.summary || "",
    type: payload.type || "Conceito",
    probableReason: payload.probableReason || "",
    severity: payload.severity || "Media",
    nextAction: payload.nextAction || "Revisar explicacao",
    reviewDate: payload.reviewDate || addDays(todayISO(), 7),
    status: payload.status || "Aberto"
  });
  return state;
}

export function updateErrorStatus(state, errorId, status) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return state;
  error.status = status;
  return state;
}

export function getDerived(state, now = todayISO()) {
  const schedule = state.schedule || [];
  const today = schedule.find((item) => item.date === now) || schedule.find((item) => item.date > now) || schedule[0];
  const week = today?.week || getWeekKey(now);
  const weekDays = schedule.filter((item) => item.week === week);
  const completedDays = schedule.filter((item) => item.status === "Concluido");
  const totalQuestions = state.sessions.reduce((sum, item) => sum + item.questions, 0);
  const totalCorrect = state.sessions.reduce((sum, item) => sum + item.correct, 0);
  const outsideStudies = state.outsideStudies || [];
  const totalMinutes =
    state.sessions.reduce((sum, item) => sum + item.minutes, 0) +
    state.simulations.reduce((sum, item) => sum + item.minutes, 0) +
    outsideStudies.reduce((sum, item) => sum + item.minutes, 0);
  const openErrors = state.errors.filter((error) => error.status === "Aberto" || error.status === "Recorrente");
  const weekSessions = state.sessions.filter((item) => item.date >= addDays(now, -6) && item.date <= now);
  const weekQuestions = weekSessions.reduce((sum, item) => sum + item.questions, 0);
  const overdueDays = schedule.filter((item) => item.movedToBacklog);

  return {
    now,
    today,
    week,
    weekDays,
    overdueDays,
    completedDays,
    progress: pct(completedDays.length, schedule.length),
    totalQuestions,
    totalCorrect,
    accuracy: pct(totalCorrect, totalQuestions),
    hours: Math.round((totalMinutes / 60) * 10) / 10,
    openErrors,
    outsideStudies,
    outsideHours: Math.round((outsideStudies.reduce((sum, item) => sum + item.minutes, 0) / 60) * 10) / 10,
    weekQuestions,
    alerts: buildAlerts(state, now, overdueDays, openErrors, weekQuestions),
    subjectPerformance: summarizeAccuracy(state.sessions, "subject"),
    systemPerformance: summarizeAccuracy(state.sessions, "system"),
    questionsBySource: groupCount(state.sessions, (item) => item.source),
    statusCounts: groupCount(schedule, (item) => item.status),
    weekProgress: weekDays.map((day) => ({ label: dayLabel(day), value: taskCompletion(day) }))
  };
}

export function taskCompletion(day) {
  return pct(REQUIRED_TASKS.filter((key) => day.tasks?.[key]).length, REQUIRED_TASKS.length);
}

export function taskLabel(key) {
  return TASKS.find(([taskKey]) => taskKey === key)?.[1] || key;
}

export function taskStatus(day, key) {
  return day.tasks?.[key] ? "Feito" : "Pendente";
}

export function dayStatus(day, now = todayISO()) {
  const done = REQUIRED_TASKS.filter((key) => day.tasks?.[key]).length;
  if (day.rescheduledTo) return "Reprogramado";
  if (done === REQUIRED_TASKS.length) return "Concluido";
  if (day.date < now) return "Atrasado";
  if (done > 0) return "Parcial";
  return "Nao iniciado";
}

export function dayLabel(day) {
  return `${day.weekday || ""} ${day.date?.slice(5) || ""}`.trim();
}

function buildAlerts(state, now, overdueDays, openErrors, weekQuestions) {
  const alerts = [];
  const today = state.schedule.find((item) => item.date === now);
  const diamondLate = overdueDays.find((item) => String(item.medcofPriority || "").toLowerCase().includes("diamante"));
  const stepLate = overdueDays.find((item) => item.stepClass);
  const greenLate = overdueDays.find((item) => /verde|alta/i.test(`${item.medcofPriority} ${item.monthlyPriority}`));
  const oldError = openErrors.find((error) => diffDays(error.date, now) <= -7);
  const upcomingSim = state.simulations.find((sim) => sim.scheduledDate && diffDays(now, sim.scheduledDate) >= -7 && diffDays(now, sim.scheduledDate) <= 0);

  if (diamondLate) alerts.push({ tone: "danger", text: `Aula Diamante MEDCOF atrasada: ${diamondLate.medcofClass}` });
  if (stepLate) alerts.push({ tone: "warning", text: `B&B essencial atrasado: ${stepLate.stepClass}` });
  if (greenLate) alerts.push({ tone: "warning", text: `Alta prioridade atrasada: ${greenLate.medcofClass}` });
  if (today && !today.tasks?.anki) alerts.push({ tone: "info", text: "Anki pendente hoje." });
  if (today && today.status !== "Concluido") alerts.push({ tone: "warning", text: "Tarefa obrigatoria incompleta no plano de hoje." });
  if (oldError) alerts.push({ tone: "danger", text: `Erro aberto ha mais de 7 dias: ${oldError.topic || oldError.subject}` });
  if (weekQuestions < 80) alerts.push({ tone: "info", text: `Poucas questoes na semana: ${weekQuestions}/80.` });
  if (upcomingSim) alerts.push({ tone: "info", text: `Simulado proximo: ${upcomingSim.name}.` });
  return alerts.slice(0, 6);
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
