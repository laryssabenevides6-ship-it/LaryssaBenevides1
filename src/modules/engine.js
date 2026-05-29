import { addDays, clamp, diffDays, groupCount, minutesBetween, pct, safeNumber, todayISO, topEntries, uid } from "./utils.js";

const AREAS = ["Clinica Medica", "Cirurgia", "Pediatria", "GO", "Preventiva"];

export function runAutomations(state, now = todayISO()) {
  migrateRuntimeState(state);

  state.schedule.forEach((item) => {
    const late = !item.completed && item.date < now;
    item.movedToBacklog = late;
    if (late && item.status !== "Atrasado") item.status = "Atrasado";
  });

  state.flashcards.forEach((card) => {
    normalizeCard(card);
    card.overdue = !card.archived && card.nextReview < now;
    card.forgotten = card.overdue && diffDays(card.nextReview, now) < -7;
  });

  updateAnkiStreak(state, now);
  return state;
}

export function completeLesson(state, lessonId, now = todayISO()) {
  const lesson = state.schedule.find((item) => item.id === lessonId);
  if (!lesson) return state;
  lesson.completed = true;
  lesson.completedAt = new Date().toISOString();
  lesson.status = "Concluido";
  lesson.movedToBacklog = false;

  [15, 30].forEach((interval) => {
    const reviewId = `${lesson.id}-r${interval}`;
    if (!state.reviews.some((review) => review.id === reviewId)) {
      state.reviews.push({
        id: reviewId,
        sourceType: "lesson",
        sourceId: lesson.id,
        title: `${lesson.medcofClass || lesson.stepClass} - revisao ${interval}d`,
        subject: lesson.area,
        area: lesson.area,
        system: lesson.stepSystem,
        week: lesson.week,
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
  lesson.status = lesson.date < now ? "Atrasado" : "Nao iniciado";
  lesson.movedToBacklog = lesson.date < now;
  state.reviews = state.reviews.filter(
    (review) => !(review.sourceType === "lesson" && review.sourceId === lesson.id && review.status !== "concluida")
  );
  return runAutomations(state, now);
}

export function completeReview(state, reviewId) {
  const review = state.reviews.find((item) => item.id === reviewId);
  if (!review) return state;
  review.status = "concluida";
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
    date: payload.date || todayISO(),
    subject: payload.subject || "Misto",
    area: payload.area || payload.subject || "Misto",
    system: payload.system || "Misto",
    week: payload.week || "",
    lessonId: payload.lessonId || "",
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
  const areaBreakdown = buildAreaBreakdown(payload);
  const questions = areaBreakdown.reduce((sum, area) => sum + area.questions, 0) || safeNumber(payload.questions);
  const correct = areaBreakdown.reduce((sum, area) => sum + area.correct, 0) || clamp(safeNumber(payload.correct), 0, questions);
  const accuracy = pct(correct, questions);
  const previous = state.simulations.at(-1);
  const ranked = areaBreakdown.filter((area) => area.questions > 0).sort((a, b) => b.accuracy - a.accuracy);
  state.simulations.push({
    id: uid("simulation"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    name: payload.name || `Simulado ${state.simulations.length + 1}`,
    subject: payload.subject || "Misto",
    area: payload.area || payload.subject || "Misto",
    system: payload.system || "Misto",
    questions,
    correct,
    errors: Math.max(0, questions - correct),
    minutes: safeNumber(payload.minutes),
    accuracy,
    areaBreakdown,
    strongestArea: ranked[0]?.area || "",
    weakestArea: ranked.at(-1)?.area || "",
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
    subject: payload.subject || "Nao classificado",
    area: payload.area || payload.subject || "Nao classificado",
    system: payload.system || "Nao classificado",
    topic: payload.topic || "",
    source: payload.source || "Questoes",
    type: payload.type || "Conceito",
    question: payload.question || "",
    correctAnswer: payload.correctAnswer || "",
    whyMissed: payload.whyMissed || "",
    lessonId: payload.lessonId || "",
    lessonTitle: payload.lessonTitle || "",
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
  const card = normalizeCard({
    id: uid("card"),
    createdAt: new Date().toISOString(),
    deck: `${error.area || error.subject} - ${error.system}`,
    subject: error.subject,
    area: error.area || error.subject,
    bigArea: error.area || error.subject,
    system: error.system,
    topic: error.topic,
    lessonId: error.lessonId || "",
    lessonTitle: error.lessonTitle || "",
    origin: "caderno de erros",
    front: error.question || `Qual e o ponto-chave sobre ${error.topic || error.subject}?`,
    back: error.correctAnswer || error.whyMissed || "Revisar explicacao da questao e registrar a resposta ideal.",
    sourceErrorId: error.id,
    difficulty: "novo",
    priority: "alta",
    interval: 1,
    nextReview: todayISO(),
    lapses: 0,
    reviews: []
  });
  state.flashcards.push(card);
  error.flashcardId = card.id;
  return state;
}

export function addManualFlashcard(state, payload) {
  const card = normalizeCard({
    id: uid("card"),
    createdAt: new Date().toISOString(),
    deck: payload.deck || payload.area || payload.subject || "Manual",
    customDeck: payload.deck || "",
    subject: payload.subject || "Nao classificado",
    area: payload.area || payload.subject || "Nao classificado",
    bigArea: payload.area || payload.subject || "Nao classificado",
    system: payload.system || "Nao classificado",
    topic: payload.topic || "",
    lessonId: payload.lessonId || "",
    lessonTitle: payload.lessonTitle || "",
    origin: payload.origin || "manual",
    front: payload.front || "",
    back: payload.back || "",
    difficulty: "novo",
    priority: "normal",
    interval: 1,
    nextReview: todayISO(),
    lapses: 0,
    reviews: []
  });
  if (card.front && card.back) state.flashcards.push(card);
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
      area: error.area || error.subject,
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
  normalizeCard(card);
  const nextInterval = getNextFlashcardInterval(card, rating);
  const correct = rating === "medium" || rating === "easy";
  card.difficulty = rating;
  card.priority = rating === "again" ? "maxima" : rating === "hard" ? "alta" : "normal";
  card.interval = nextInterval;
  card.nextReview = addDays(todayISO(), nextInterval);
  card.lapses += rating === "hard" || rating === "again" ? 1 : 0;
  card.reviewCount += 1;
  card.correctCount += correct ? 1 : 0;
  card.wrongCount += correct ? 0 : 1;
  card.accuracy = pct(card.correctCount, card.reviewCount);
  card.easyStreak = rating === "easy" ? card.easyStreak + 1 : 0;
  card.reviews.push({
    at: new Date().toISOString(),
    rating,
    correct,
    interval: nextInterval,
    nextReview: card.nextReview,
    accuracy: card.accuracy
  });
  if (rating === "again" || rating === "hard") {
    state.reviews.push({
      id: uid("review-card"),
      sourceType: "flashcard",
      sourceId: card.id,
      title: `Revisar flashcard: ${card.topic || card.subject}`,
      subject: card.subject,
      area: card.area,
      system: card.system,
      dueDate: card.nextReview,
      interval: nextInterval,
      status: "pendente",
      history: []
    });
  }
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
    date: todayISO(),
    subject: timer.subject,
    area: timer.area || timer.subject,
    system: timer.system,
    week: timer.week || "",
    lessonId: timer.lessonId || "",
    topic: timer.topic,
    source: "Cronometro",
    mode: "Tempo focado",
    questions: 0,
    correct: 0,
    minutes
  });
}

export function addOutsideStudy(state, payload) {
  const minutes = safeNumber(payload.minutes);
  const study = {
    id: uid("outside"),
    createdAt: new Date().toISOString(),
    date: payload.date || todayISO(),
    subject: payload.subject || "Nao classificado",
    area: payload.area || payload.subject || "Nao classificado",
    system: payload.system || "Nao classificado",
    topic: payload.topic || "",
    lesson: payload.lesson || "",
    notes: payload.notes || "",
    minutes
  };
  state.outsideStudies.push(study);
  state.sessions.push({
    id: uid("session"),
    createdAt: new Date().toISOString(),
    date: study.date,
    subject: study.subject,
    area: study.area,
    system: study.system,
    topic: study.topic || study.lesson,
    source: "Fora do cronograma",
    mode: "Aula extra",
    questions: 0,
    correct: 0,
    minutes,
    accuracy: 0,
    secondsPerQuestion: 0
  });
  return state;
}

export function saveWeeklyBoard(state, week, content) {
  state.weeklyBoards ||= {};
  state.weeklyBoards[week] = { content, updatedAt: new Date().toISOString() };
  return state;
}

export function addCustomDeck(state, name) {
  const deck = String(name || "").trim();
  if (deck && !state.customDecks.includes(deck)) state.customDecks.push(deck);
  return state;
}

export function getDerived(state, now = todayISO()) {
  migrateRuntimeState(state);
  const completed = state.schedule.filter((item) => item.completed);
  const overdueLessons = state.schedule.filter((item) => !item.completed && item.date < now);
  const todayLessons = state.schedule.filter((item) => item.date === now && !item.completed);
  const upcomingSimulations = state.schedule.filter((item) => item.type === "simulado" && diffDays(item.date, now) >= 0 && diffDays(item.date, now) <= 7);
  const dueReviews = state.reviews.filter((item) => item.status !== "concluida" && item.status !== "concluída" && item.dueDate <= now);
  const dueCards = state.flashcards
    .filter((card) => !card.archived && card.nextReview <= now)
    .sort((a, b) => priorityWeight(b) - priorityWeight(a) || (b.lapses || 0) - (a.lapses || 0) || a.nextReview.localeCompare(b.nextReview));
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
  const neglected = state.schedule.filter((item) => !item.completed && diffDays(item.date, now) < -10).slice(0, 8);
  const createdTodayCards = state.flashcards.filter((card) => String(card.createdAt || "").slice(0, 10) === now);
  const errorCards = state.flashcards.filter((card) => card.origin === "caderno de erros" || card.sourceErrorId);
  const automaticDecks = buildDecks(state.flashcards);
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
    weekProgress: progressBy(state.schedule, "week"),
    totalQuestions,
    totalCorrect,
    accuracy: pct(totalCorrect, totalQuestions),
    hours: Math.round(hours * 10) / 10,
    hoursByArea: sumMinutesBy(state.sessions, "area"),
    hoursBySubject: sumMinutesBy(state.sessions, "subject"),
    hoursBySystem: sumMinutesBy(state.sessions, "system"),
    hoursByWeek: sumMinutesBy(state.sessions, "week"),
    hoursByMonth: sumMinutesBy(state.sessions.map((session) => ({ ...session, month: (session.date || "").slice(0, 7) })), "month"),
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
      again: state.flashcards.filter((card) => card.difficulty === "again").length,
      forgotten: state.flashcards.filter((card) => card.forgotten).length,
      overdue: state.flashcards.filter((card) => card.overdue).length,
      createdToday: createdTodayCards.length,
      fromErrors: errorCards.length
    },
    createdTodayCards,
    errorCards,
    automaticDecks,
    outsideStudies: state.outsideStudies || []
  };
}

function migrateRuntimeState(state) {
  state.customDecks ||= [];
  state.weeklyBoards ||= {};
  state.outsideStudies ||= [];
  state.flashcards ||= [];
  state.flashcards.forEach((card) => normalizeCard(card));
}

function normalizeCard(card) {
  card.area ||= card.bigArea || card.subject || "Nao classificado";
  card.bigArea ||= card.area;
  card.subject ||= card.area;
  card.system ||= "Nao classificado";
  card.topic ||= "";
  card.lessonId ||= "";
  card.lessonTitle ||= "";
  card.origin ||= card.sourceErrorId ? "caderno de erros" : "manual";
  card.difficulty ||= "novo";
  card.priority ||= card.difficulty === "again" ? "maxima" : card.difficulty === "hard" ? "alta" : "normal";
  card.reviewCount ||= card.reviews?.length || 0;
  card.correctCount ||= card.reviews?.filter((review) => review.rating === "easy" || review.rating === "medium").length || 0;
  card.wrongCount ||= Math.max(0, card.reviewCount - card.correctCount);
  card.accuracy = card.reviewCount ? pct(card.correctCount, card.reviewCount) : 0;
  card.easyStreak ||= 0;
  card.reviews ||= [];
  card.deck ||= card.customDeck || card.area || card.subject || "Geral";
  return card;
}

function getNextFlashcardInterval(card, rating) {
  if (rating === "again") return 1;
  if (rating === "hard") return Math.max(1, Math.min(3, Math.floor((card.interval || 3) / 2) || 3));
  if (rating === "medium") return 7;
  const easySteps = [15, 30, 60, 90, 180];
  return easySteps[Math.min(card.easyStreak || 0, easySteps.length - 1)];
}

function priorityWeight(card) {
  if (card.priority === "maxima" || card.difficulty === "again") return 4;
  if (card.priority === "alta" || card.difficulty === "hard") return 3;
  if (card.difficulty === "medium") return 2;
  return 1;
}

function buildAreaBreakdown(payload) {
  return AREAS.map((area) => {
    const key = areaKey(area);
    const questions = safeNumber(payload[`${key}Questions`]);
    const correct = clamp(safeNumber(payload[`${key}Correct`]), 0, questions);
    return { area, questions, correct, errors: Math.max(0, questions - correct), accuracy: pct(correct, questions) };
  });
}

function areaKey(area) {
  return area.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
}

function buildDecks(cards) {
  const dimensions = [
    ["Grande area", (card) => card.area],
    ["Sistema", (card) => card.system],
    ["Tema", (card) => card.topic],
    ["Origem", (card) => card.origin]
  ];
  return dimensions.flatMap(([type, fn]) => topEntries(groupCount(cards, fn), 12).map(([name, count]) => ({ type, name, count })));
}

function sumMinutesBy(items, key) {
  return topEntries(
    items.reduce((acc, item) => {
      const name = item[key] || "Nao classificado";
      acc[name] = (acc[name] || 0) + safeNumber(item.minutes);
      return acc;
    }, {}),
    10
  ).map(([name, minutes]) => [name, Math.round((minutes / 60) * 10) / 10]);
}

function progressBy(items, key) {
  const map = {};
  items.forEach((item) => {
    const name = item[key] || "Nao classificado";
    map[name] ||= { total: 0, done: 0, pct: 0 };
    map[name].total += 1;
    if (item.completed) map[name].done += 1;
  });
  Object.values(map).forEach((entry) => {
    entry.pct = pct(entry.done, entry.total);
  });
  return Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 12);
}

function summarizeAccuracy(sessions, key) {
  const map = {};
  sessions.forEach((session) => {
    if (!session.questions) return;
    const name = session[key] || "Nao classificado";
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
  if (dueReviews.length) alerts.push({ tone: "warning", text: `${dueReviews.length} revisoes vencidas precisam de acao hoje.` });
  if (dueCards.length) alerts.push({ tone: "warning", text: `${dueCards.length} flashcards pendentes, priorizando os mais dificeis.` });
  if (state.flashcards.some((card) => card.difficulty === "again")) alerts.push({ tone: "danger", text: "Ha flashcards marcados como errei completamente." });
  if (upcomingSimulations.length) alerts.push({ tone: "info", text: `${upcomingSimulations.length} simulados/blocos maiores nos proximos 7 dias.` });
  if (weakSubjects[0]?.score > 20) alerts.push({ tone: "danger", text: `Materia critica: ${weakSubjects[0].name}.` });
  if (weakSystems[0]?.score > 20) alerts.push({ tone: "info", text: `Sistema fragil: ${weakSystems[0].name}.` });
  const lastThree = state.sessions.filter((s) => s.questions).slice(-3);
  if (lastThree.length === 3 && lastThree.at(-1).accuracy < lastThree[0].accuracy - 10) alerts.push({ tone: "danger", text: "Queda de desempenho detectada nas ultimas sessoes." });
  const ankiDone = state.anki.logs.some((log) => log.date === now && log.done);
  if (!ankiDone) alerts.push({ tone: "info", text: "Anki obrigatorio ainda nao foi registrado hoje." });
  return alerts;
}

function buildTrend(sessions) {
  return sessions
    .filter((session) => session.questions > 0)
    .slice(-12)
    .map((session) => ({ label: session.date.slice(5), value: session.accuracy }));
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
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
