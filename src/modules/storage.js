import { todayISO } from "./utils.js";

const KEY = "med-study-brain:v1";

export function freshState(scheduleItems = []) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    lastOpened: todayISO(),
    preferences: {
      theme: "dark",
      dailyQuestionTarget: 25,
      ankiMinutesTarget: 30
    },
    schedule: scheduleItems.map((item) => ({
      ...item,
      status: item.status && item.status !== "N�o iniciado" ? item.status : "Não iniciado",
      completed: false,
      completedAt: "",
      movedToBacklog: false
    })),
    reviews: [],
    flashcards: [],
    errors: [],
    sessions: [],
    simulations: [],
    anki: {
      logs: [],
      streak: 0,
      lastDone: "",
      totalMinutes: 0
    },
    timers: []
  };
}

export function loadState(scheduleItems = []) {
  const raw = localStorage.getItem(KEY);
  if (!raw) return freshState(scheduleItems);
  try {
    return migrate(JSON.parse(raw), scheduleItems);
  } catch {
    return freshState(scheduleItems);
  }
}

export function saveState(state) {
  state.lastOpened = todayISO();
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function resetState(scheduleItems = []) {
  const state = freshState(scheduleItems);
  saveState(state);
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
  return {
    ...base,
    ...state,
    preferences: { ...base.preferences, ...(state.preferences || {}) },
    anki: { ...base.anki, ...(state.anki || {}) },
    schedule: Array.isArray(state.schedule) && state.schedule.length ? state.schedule : base.schedule,
    reviews: state.reviews || [],
    flashcards: state.flashcards || [],
    errors: state.errors || [],
    sessions: state.sessions || [],
    simulations: state.simulations || [],
    timers: state.timers || []
  };
}
