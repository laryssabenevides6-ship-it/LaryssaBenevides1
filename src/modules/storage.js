import { todayISO } from "./utils.js";

const AUTH_KEY = "med-study-brain:auth:v2";
const SESSION_KEY = "med-study-brain:session:v2";
const STATE_PREFIX = "med-study-brain:user-state:v2:";

export function getAuth() {
  return JSON.parse(localStorage.getItem(AUTH_KEY) || '{"users":[]}');
}

function saveAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function getCurrentUser() {
  const userId = localStorage.getItem(SESSION_KEY);
  if (!userId) return null;
  return getAuth().users.find((user) => user.id === userId) || null;
}

export function registerUser(payload) {
  const auth = getAuth();
  const email = normalizeEmail(payload.email);
  if (!email || !payload.name || !payload.password) throw new Error("Preencha nome, e-mail e senha.");
  if (payload.password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
  if (auth.users.some((user) => user.email === email)) throw new Error("Este e-mail ja possui cadastro.");

  const user = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name.trim(),
    email,
    passwordHash: hashPassword(payload.password),
    createdAt: new Date().toISOString(),
    resetRequestedAt: ""
  };
  auth.users.push(user);
  saveAuth(auth);
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export function loginUser(payload) {
  const auth = getAuth();
  const email = normalizeEmail(payload.email);
  const user = auth.users.find((item) => item.email === email);
  if (!user || user.passwordHash !== hashPassword(payload.password)) throw new Error("E-mail ou senha invalidos.");
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
}

export function requestPasswordReset(email, nextPassword = "") {
  const auth = getAuth();
  const user = auth.users.find((item) => item.email === normalizeEmail(email));
  if (!user) throw new Error("E-mail nao encontrado.");
  if (nextPassword) {
    if (nextPassword.length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
    user.passwordHash = hashPassword(nextPassword);
  }
  user.resetRequestedAt = new Date().toISOString();
  saveAuth(auth);
  return true;
}

export function changePassword(userId, currentPassword, nextPassword) {
  const auth = getAuth();
  const user = auth.users.find((item) => item.id === userId);
  if (!user) throw new Error("Usuario nao encontrado.");
  if (currentPassword && user.passwordHash !== hashPassword(currentPassword)) throw new Error("Senha atual incorreta.");
  if (!nextPassword || nextPassword.length < 6) throw new Error("A nova senha precisa ter pelo menos 6 caracteres.");
  user.passwordHash = hashPassword(nextPassword);
  user.resetRequestedAt = "";
  saveAuth(auth);
}

export function freshState(scheduleItems = []) {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    lastOpened: todayISO(),
    preferences: {
      theme: "dark",
      dailyQuestionTarget: 25,
      defaultTarget: "Ambos"
    },
    schedule: scheduleItems.map(normalizeScheduleItem),
    weeklyBoards: {},
    outsideStudies: [],
    errors: [],
    sessions: [],
    simulations: [],
    timers: [],
    activeTimer: null
  };
}

export function loadState(userId, scheduleItems = []) {
  if (!userId) return freshState(scheduleItems);
  const raw = localStorage.getItem(`${STATE_PREFIX}${userId}`);
  if (!raw) return freshState(scheduleItems);
  try {
    return migrate(JSON.parse(raw), scheduleItems);
  } catch {
    return freshState(scheduleItems);
  }
}

export function saveState(userId, state) {
  if (!userId) return;
  state.lastOpened = todayISO();
  localStorage.setItem(`${STATE_PREFIX}${userId}`, JSON.stringify(state));
}

export function resetState(userId, scheduleItems = []) {
  const state = freshState(scheduleItems);
  saveState(userId, state);
  return state;
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `med-study-brain-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importState(file, scheduleItems = []) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(migrate(JSON.parse(reader.result), scheduleItems));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function migrate(state, scheduleItems = []) {
  const base = freshState(scheduleItems);
  const schedule = Array.isArray(state.schedule) && state.schedule.length ? state.schedule : base.schedule;
  return {
    ...base,
    ...state,
    version: 2,
    preferences: { ...base.preferences, ...(state.preferences || {}) },
    schedule: schedule.map((item) => normalizeScheduleItem(item)),
    weeklyBoards: state.weeklyBoards || {},
    outsideStudies: (state.outsideStudies || []).map(normalizeOutsideStudy),
    errors: (state.errors || []).map(normalizeError),
    sessions: state.sessions || [],
    simulations: state.simulations || [],
    timers: state.timers || [],
    activeTimer: state.activeTimer || null
  };
}

function normalizeScheduleItem(item) {
  const tasks = {
    medcof: false,
    step: false,
    questions: false,
    anki: false,
    errors: false,
    ...(item.tasks || {})
  };
  return {
    ...item,
    tasks,
    status: item.status || "Pendente",
    completedAt: item.completedAt || "",
    movedToBacklog: Boolean(item.movedToBacklog)
  };
}

function normalizeOutsideStudy(study) {
  return {
    id: study.id || `outside-${Date.now().toString(36)}`,
    createdAt: study.createdAt || new Date().toISOString(),
    date: study.date || todayISO(),
    subject: study.subject || "Nao classificado",
    system: study.system || "",
    topic: study.topic || "",
    lesson: study.lesson || "",
    notes: study.notes || "",
    minutes: Number(study.minutes) || 0
  };
}

function normalizeError(error) {
  const errorTypes = [
    "Falta de conteudo",
    "Conduta/protocolo",
    "Confusao conceitual",
    "Fisiopatologia/mecanismo",
    "Interpretacao do enunciado",
    "Desatencao/leitura rapida",
    "Tempo/pressa",
    "Chute/incerteza"
  ];
  return {
    id: error.id || `error-${Date.now().toString(36)}`,
    date: error.date || todayISO(),
    source: error.source || "MEDCOF",
    target: error.target || "Ambos",
    subject: error.subject || "Nao classificado",
    system: error.system || "Nao classificado",
    topic: cleanText(error.topic),
    summary: cleanText(error.summary || error.question),
    reviewQuestion: cleanText(error.reviewQuestion || error.question),
    expectedAnswer: cleanText(error.expectedAnswer),
    type: errorTypes.includes(error.type) ? error.type : "Falta de conteudo",
    severity: error.severity || "Media",
    reviewDate: error.reviewDate || "",
    status: ["Aberto", "Revisado", "Resolvido", "Recorrente"].includes(error.status) ? error.status : "Aberto",
    createdAt: error.createdAt || new Date().toISOString()
  };
}

function cleanText(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function hashPassword(value = "") {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
