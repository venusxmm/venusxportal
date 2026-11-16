// Pure scheduling of up to three deadline reminders (Bogotá, UTC-5, no DST).
const H = 3600_000;
const BOGOTA_OFFSET = -5 * H;

export type Reminder = { n: 1 | 2 | 3; at: Date };

function bogotaHour(d: Date) {
  return new Date(d.getTime() + BOGOTA_OFFSET).getUTCHours();
}
function atBogotaHour(d: Date, hour: number, dayShift = 0) {
  const local = new Date(d.getTime() + BOGOTA_OFFSET);
  local.setUTCDate(local.getUTCDate() + dayShift);
  local.setUTCHours(hour, 0, 0, 0);
  return new Date(local.getTime() - BOGOTA_OFFSET);
}
export function inQuiet(d: Date, qs: number, qe: number) {
  if (qs === qe) return false;
  const h = bogotaHour(d);
  return qs > qe ? h >= qs || h < qe : h >= qs && h < qe;
}

/** Moves a point out of quiet hours: earlier (before quiet starts) when possible, else to quiet end. */
function avoidQuiet(at: Date, start: Date, deadline: Date, qs: number, qe: number): Date | null {
  if (!inQuiet(at, qs, qe)) return at;
  const h = bogotaHour(at);
  const sameEvening = qs > qe && h < qe ? -1 : 0;
  const before = new Date(atBogotaHour(at, qs, sameEvening).getTime() - H / 2);
  if (before > start && !inQuiet(before, qs, qe)) return before;
  const after = atBogotaHour(at, qe, qs > qe && h >= qs ? 1 : 0);
  if (after < deadline) return after;
  return null;
}

export function computeReminders(
  assigned: Date,
  deadline: Date,
  quietStart = 21,
  quietEnd = 8,
): Reminder[] {
  const span = deadline.getTime() - assigned.getTime();
  if (!(span > 0)) return [];
  const raw: Reminder[] = [
    { n: 1, at: new Date(assigned.getTime() + span * 0.25) },
    { n: 2, at: new Date(assigned.getTime() + span * 0.7) },
    { n: 3, at: new Date(deadline.getTime() - Math.min(2 * H, span * 0.1)) },
  ];
  const wanted = span < 3 * H ? raw.slice(2) : span < 24 * H ? raw.slice(1) : raw;
  const placed = wanted
    .map((r) => ({ n: r.n, at: avoidQuiet(r.at, assigned, deadline, quietStart, quietEnd) }))
    .filter((r): r is Reminder => r.at !== null);
  // Keep the later (more urgent) reminder when two are closer than one hour.
  const out: Reminder[] = [];
  for (const r of placed.sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (out.every((o) => Math.abs(o.at.getTime() - r.at.getTime()) >= H)) out.push(r);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function reminderText(n: 1 | 2 | 3, title: string, deadline: Date) {
  const when = deadline.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  if (n === 1) return { title: "✨ Tienes tiempo para brillar", body: `${title} · vence ${when}` };
  if (n === 2) return { title: "💛 Vas a buen ritmo", body: `Recuerda: ${title} · vence ${when}` };
  return { title: "⏰ ¡Último impulso!", body: `${title} vence ${when}. ¡Tú puedes!` };
}
