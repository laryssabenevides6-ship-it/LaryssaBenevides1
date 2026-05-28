export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addDays(dateISO, days) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function diffDays(aISO, bISO = todayISO()) {
  const a = new Date(`${aISO}T00:00:00`);
  const b = new Date(`${bISO}T00:00:00`);
  return Math.floor((a - b) / 86400000);
}

export function fmtDate(dateISO) {
  if (!dateISO) return "-";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${dateISO}T12:00:00`)
  );
}

export function minutesBetween(start, end) {
  return Math.max(1, Math.round((new Date(end) - new Date(start)) / 60000));
}

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function groupCount(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "Não classificado";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function topEntries(map, limit = 5) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export function scoreLabel(score) {
  if (score >= 80) return "forte";
  if (score >= 65) return "estável";
  if (score >= 50) return "atenção";
  return "crítico";
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
