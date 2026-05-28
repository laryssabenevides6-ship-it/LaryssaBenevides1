import { addDays, clamp, diffDays, groupCount, minutesBetween, pct, safeNumber, todayISO, topEntries, uid } from "./utils.js";

export function runAutomations(state, now = todayISO()) {
  state.schedule.forEach((item) => {
    const late = !item.completed && item.date < now;
    item.movedToBacklog = late;
    if (late && item.status !== "Atrasado") item.status = "Atrasado";
  });

  state.flashcards.forEach((card) => {
    card.overdue = !card.archived && card.nextReview < now;
  });

  updateAnkiStreak(state, now);
  return state;
}

export function completeLesson(state, lessonId, now = todayISO()) {
  const lesson = state.schedule.find((item) => item.id === lessonId);
  if (!lesson) return state;
  lesson.completed = true;
  lesson.completedAt = new Date().toISOString();
  lesson.status = "Concluído";
  lesson.movedToBacklog = false;

  [15, 30].forEach((interval) => {
    const reviewId = `${lesson.id}-r${interval}`;
    if (!state.reviews.some((review) => review.id === reviewId)) {
      state.reviews.push({
        id: reviewId,
        sourceType: "lesson",
        sourceId: lesson.id,
        title: `${lesson.medcofClass || lesson.stepClass} · revisão ${interval}d`,
        subject: lesson.area,
        system: lesson.stepSystem,
        dueDate: addDays(now, interval),
        interval,
        status: "pendente",
        history: []
      });
    }
  });

  return runAutomations(state, now);
}

export function reopenLesson(state, lessonId, now = todayISO()) {
  const lesson = state.schedule.find((item) => item.id === lessonId);
  if (!lesson) return state;
  lesson.completed = false;
  lesson.completedAt = "";
  lesson.status = lesson.date < now ? "Atrasado" : "Não iniciado";
  lesson.movedToBacklog = lesson.date < now;
  state.reviews = state.reviews.filter(
    (review) => !(review.sourceType === "lesson" && review.sourceId === lesson.id && review.status !== "concluída")
  );
  return runAutomations(state, now);
}

export function completeReview(state, reviewId) {
  const review = state.reviews.find((item) => item.id === reviewId);
  if (!review) return state;
  review.status = "concluída";
  review.completedAt = new Date().toISOString();
  review.history.push({ at: new Date().toISOString(), action: "completed" });
  return state;
}

export function addStudySession(state, payload) {
  const questions = safeNumber(payload.questions);
  const correct = clamp(safeNumber(payload.correct), 0, questions);
  const minutes = Math.max(1, safeNumber(payload.minutes));
  const accuracy = pct(correct, questions);
  state.sessions.push({
    id: uid("session"),
    createdAt: new Date().toISOString(),
    date: todayISO(),
    subject: payload.subject || "Misto",
    system: payload.system || "Misto",
    topic: payload.topic || "",
    source: payload.source || "MEDCOF/UWorld",
    mode: payload.mode || "Tutor",
    questions,
    correct,
    minutes,
    accuracy,
    secondsPerQuestion: questions ? Math.round((minutes * 60) / questions) : 0
  });
  return state;
}

export function addSimulation(state, payload) {
  const questions = safeNumber(payload.questions);
  const correct = clamp(safeNumber(payload.correct), 0, questions);
  const accuracy = pct(correct, questions);
  const previous = state.simulations.at(-1);
  state.simulations.push({
    id: uid("simulation"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    name: payload.name || `Simulado ${state.simulations.length + 1}`,
    subject: payload.subject || "Misto",
    system: payload.system || "Misto",
    questions,
    correct,
    minutes: safeNumber(payload.minutes),
    accuracy,
    delta: previous ? accuracy - previous.accuracy : 0,
    criticalThemes: splitTags(payload.criticalThemes)
  });
  return state;
}

export function addError(state, payload) {
  const error = {
    id: uid("error"),
    createdAt: new Date().toISOString(),
    date: todayISO(),
    subject: payload.subject || "Não classificado",
    system: payload.system || "Não classificado",
    topic: payload.topic || "",
    source: payload.source || "Questões",
    type: payload.type || "Conceito",
    question: payload.question || "",
    correctAnswer: payload.correctAnswer || "",
    whyMissed: payload.whyMissed || "",
    important: Boolean(payload.important),
    reviewed: false,
    flashcardId: "",
    futureReviewId: "",
    status: "pendente"
  };
  state.errors.push(error);
  if (error.important) markErrorImportant(state, error.id);
  return state;
}

export function flashcardFromError(state, errorId) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return state;
  if (error.flashcardId && state.flashcards.some((card) => card.id === error.flashcardId)) return state;
  const card = {
    id: uid("card"),
    createdAt: new Date().toISOString(),
    deck: `${error.subject} · ${error.system}`,
    subject: error.subject,
    system: error.system,
    topic: error.topic,
    front: error.question || `Qual é o ponto-chave sobre ${error.topic || error.subject}?`,
    back: error.correctAnswer || error.whyMissed || "Revisar explicação da questão e registrar a resposta ideal.",
    sourceErrorId: error.id,
    difficulty: "novo",
    interval: 1,
    nextReview: todayISO(),
    lapses: 0,
    reviews: []
  };
  state.flashcards.push(card);
  error.flashcardId = card.id;
  return state;
}

export function markErrorImportant(state, errorId) {
  const error = state.errors.find((item) => item.id === errorId);
  if (!error) return state;
  error.important = true;
  if (!error.futureReviewId) {
    const review = {
      id: uid("review-error"),
      sourceType: "error",
      sourceId: error.id,
      title: `Revisar erro: ${error.topic || error.subject}`,
      subject: error.subject,
      system: error.system,
      dueDate: addDays(todayISO(), 3),
      interval: 3,
      status: "pendente",
      history: []
    };
    state.reviews.push(review);
    error.futureReviewId = review.id;
  }
  return state;
}

export function answerFlashcard(state, cardId, rating) {
  const card = state.flashcards.find((item) => item.id === cardId);
  if (!card) return state;
  const multipliers = {
    easy: 2.6,
    medium: 1.7,
    hard: 0.6
  };
  const base = Math.max(1, card.interval || 1);
  const nextInterval = rating === "hard" ? Math.max(1, Math.round(base * multipliers.hard)) : Math.round(base * multipliers[rating]);
  card.difficulty = rating;
  card.interval = nextInterval;
  card.nextReview = addDays(todayISO(), nextInterval);
  card.lapses += rating === "hard" ? 1 : 0;
  card.reviews.push({ at: new Date().toISOString(), rating, nextReview: card.nextReview });
  return state;
}

export function logAnki(state, minutes, reviews = 0) {
  const date = todayISO();
  const existing = state.anki.logs.find((log) => log.date === date);
  if (existing) {
    existing.minutes += safeNumber(minutes);
    existing.reviews += safeNumber(reviews);
  } else {
    state.anki.logs.push({ date, minutes: safeNumber(minutes), reviews: safeNumber(reviews), done: true });
  }
  state.anki.lastDone = date;
  state.anki.totalMinutes = state.anki.logs.reduce((sum, log) => sum + log.minutes, 0);
  updateAnkiStreak(state, date);
  return state;
}

export function saveTimerSession(state, timer) {
  const minutes = minutesBetween(timer.startedAt, timer.endedAt);
  state.timers.push({ ...timer, minutes });
  return addStudySession(state, {
    subject: timer.subject,
    system: timer.system,
    topic: timer.topic,
    source: "Cronômetro",
    mode: "Tempo focado",
    questions: 0,
    correct: 0,
    minutes
  });
}

export function getDerived(state, now = todayISO()) {
  const completed = state.schedule.filter((item) => item.completed);
  const overdueLessons = state.schedule.filter((item) => !item.completed && item.date < now);
  const todayLessons = state.schedule.filter((item) => item.date === now && !item.completed);
  const upcomingSimulations = state.schedule.filter((item) => item.type === "simulado" && diffDays(item.date, now) >= 0 && diffDays(item.date, now) <= 7);
  const dueReviews = state.reviews.filter((item) => item.status !== "concluída" && item.dueDate <= now);
  const dueCards = state.flashcards
    .filter((card) => !card.archived && card.nextReview <= now)
    .sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || a.nextReview.localeCompare(b.nextReview));
  const pendingErrors = state.errors.filter((error) => error.status !== "resolvido");
  const sessionsWithQuestions = state.sessions.filter((session) => session.questions > 0);
  const totalQuestions = sessionsWithQuestions.reduce((sum, session) => sum + session.questions, 0);
  const totalCorrect = sessionsWithQuestions.reduce((sum, session) => sum + session.correct, 0);
  const hours = state.sessions.reduce((sum, session) => sum + session.minutes, 0) / 60;
  const errorsBySubject = groupCount(state.errors, (error) => error.subject);
  const errorsBySystem = groupCount(state.errors, (error) => error.system);
  const sessionsBySubject = summarizeAccuracy(state.sessions, "subject");
  const sessionsBySystem = summarizeAccuracy(state.sessions, "system");
  const weakSubjects = rankWeakness(errorsBySubject, sessionsBySubject);
  const weakSystems = rankWeakness(errorsBySystem, sessionsBySystem);
  const neglected = state.schedule
    .filter((item) => !item.completed && diffDays(item.date, now) < -10)
    .slice(0, 8);
  const alerts = buildAlerts({ overdueLessons, dueReviews, dueCards, weakSubjects, weakSystems, state, now, upcomingSimulations });

  return {
    now,
    todayLessons,
    overdueLessons,
    dueReviews,
    dueCards,
    pendingErrors,
    upcomingSimulations,
    completed,
    progress: pct(completed.length, state.schedule.length),
    subjectProgress: progressBy(state.schedule, "area"),
    systemProgress: progressBy(state.schedule, "stepSystem"),
    totalQuestions,
    totalCorrect,
    accuracy: pct(totalCorrect, totalQuestions),
    hours: Math.round(hours * 10) / 10,
    weakSubjects,
    weakSystems,
    errorsBySubject: topEntries(errorsBySubject, 7),
    errorsBySystem: topEntries(errorsBySystem, 7),
    neglected,
    alerts,
    trend: buildTrend(state.sessions),
    flashcardStats: {
      total: state.flashcards.length,
      due: dueCards.length,
      hard: state.flashcards.filter((card) => card.difficulty === "hard").length,
      overdue: state.flashcards.filter((card) => card.overdue).length
    }
  };
}

function progressBy(items, key) {
  const map = {};
  items.forEach((item) => {
    const name = item[key] || "Não classificado";
    map[name] ||= { total: 0, done: 0, pct: 0 };
    map[name].total += 1;
    if (item.completed) map[name].done += 1;
  });
  Object.values(map).forEach((entry) => {
    entry.pct = pct(entry.done, entry.total);
  });
  return Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
}

function summarizeAccuracy(sessions, key) {
  const map = {};
  sessions.forEach((session) => {
    if (!session.questions) return;
    const name = session[key] || "Não classificado";
    map[name] ||= { questions: 0, correct: 0, accuracy: 0 };
    map[name].questions += session.questions;
    map[name].correct += session.correct;
  });
  Object.values(map).forEach((entry) => {
    entry.accuracy = pct(entry.correct, entry.questions);
  });
  return map;
}

function rankWeakness(errorMap, accuracyMap) {
  const keys = new Set([...Object.keys(errorMap), ...Object.keys(accuracyMap)]);
  return [...keys]
    .map((key) => {
      const errors = errorMap[key] || 0;
      const accuracy = accuracyMap[key]?.accuracy ?? 70;
      const score = errors * 12 + Math.max(0, 75 - accuracy);
      return { name: key, errors, accuracy, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function buildAlerts({ overdueLessons, dueReviews, dueCards, weakSubjects, weakSystems, state, now, upcomingSimulations }) {
  const alerts = [];
  if (overdueLessons.length) alerts.push({ tone: "danger", text: `${overdueLessons.length} aulas atrasadas foram movidas para atraso.` });
  if (dueReviews.length) alerts.push({ tone: "warning", text: `${dueReviews.length} revisões vencidas precisam de ação hoje.` });
  if (dueCards.length) alerts.push({ tone: "warning", text: `${dueCards.length} flashcards pendentes, priorizando difíceis.` });
  if (upcomingSimulations.length) alerts.push({ tone: "info", text: `${upcomingSimulations.length} simulados/blocos maiores nos próximos 7 dias.` });
  if (weakSubjects[0]?.score > 20) alerts.push({ tone: "danger", text: `Matéria crítica: ${weakSubjects[0].name}.` });
  if (weakSystems[0]?.score > 20) alerts.push({ tone: "info", text: `Sistema frágil: ${weakSystems[0].name}.` });
  const lastThree = state.sessions.filter((s) => s.questions).slice(-3);
  if (lastThree.length === 3 && lastThree.at(-1).accuracy < lastThree[0].accuracy - 10) {
    alerts.push({ tone: "danger", text: "Queda de desempenho detectada nas últimas sessões." });
  }
  const ankiDone = state.anki.logs.some((log) => log.date === now && log.done);
  if (!ankiDone) alerts.push({ tone: "info", text: "Anki obrigatório ainda não foi registrado hoje." });
  return alerts;
}

function buildTrend(sessions) {
  return sessions
    .filter((session) => session.questions > 0)
    .slice(-12)
    .map((session) => ({
      label: session.date.slice(5),
      value: session.accuracy
    }));
}

function updateAnkiStreak(state, now) {
  let streak = 0;
  let cursor = now;
  const done = new Set(state.anki.logs.filter((log) => log.done).map((log) => log.date));
  while (done.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  state.anki.streak = streak;
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
