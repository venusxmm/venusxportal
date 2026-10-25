export const AGENCY_TIMEZONE = "America/Bogota";
export type Execution = {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  creator_id: string | null;
  priority: string;
  scheduled_date: string | null;
  due_time: string | null;
  status: string;
  recurring: boolean;
  skip_state: string;
  skip_reason?: string | null;
  completed_at?: string | null;
  projected?: boolean;
  archived_at?: string | null;
  visible_to_creator?: boolean;
  occurrence_date?: string | null;
};
export function agencyDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENCY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
export function executionOverdue(task: Execution, now = new Date()) {
  if (
    !task.scheduled_date ||
    !task.due_time ||
    ["done", "skipped", "cancelled"].includes(task.status)
  )
    return false;
  return (
    new Date(
      `${task.scheduled_date}T${task.due_time.length === 5 ? `${task.due_time}:00` : task.due_time.slice(0, 8)}-05:00`,
    ).getTime() < now.getTime()
  );
}
export function scheduledFor(task: Execution, date: string) {
  return task.scheduled_date === date;
}
export function canExecute(task: Execution, userId: string, executive: boolean) {
  return !task.projected && task.status !== "cancelled" && (executive || task.owner_id === userId);
}
export function appliesOn(mode: string, weekdays: number[], start: string, date: string) {
  if (date < start) return false;
  return mode === "once"
    ? date === start
    : mode === "daily" || weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}
/** Creator portal order: date ascending (undated last), timed before untimed within a date. */
export function sortPortalTasks<T extends { scheduled_date?: string | null; due_time: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.scheduled_date ?? "9999-12-31").localeCompare(b.scheduled_date ?? "9999-12-31") ||
      (a.due_time?.slice(0, 5) ?? "99:99").localeCompare(b.due_time?.slice(0, 5) ?? "99:99"),
  );
}
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Plain-language recurrence label for creator-facing views. */
export function recurrenceLabel(mode: string | null | undefined, weekdays: number[] = []) {
  if (mode === "daily") return "Daily";
  if (mode === "weekdays")
    return `Weekly: ${[...weekdays].sort().map((d) => DAY_NAMES[d]).join(", ")}`;
  return "One time";
}
/** Portal publication is only coherent when the owner is the linked creator's own account. */
export function ownerCreatorConsistent(
  t: { owner_id: string | null; creator_id: string | null; visible_to_creator?: boolean },
  creatorUserIds: Record<string, string | null>,
  creatorOwnerIds: Set<string>,
) {
  if (t.owner_id && creatorOwnerIds.has(t.owner_id))
    return !!t.creator_id && creatorUserIds[t.creator_id] === t.owner_id;
  if (t.visible_to_creator) return !!t.creator_id && creatorUserIds[t.creator_id] === t.owner_id;
  return true;
}
/** 24h "15:00[:00]" to "3:00 PM". */
export function formatTime12(time: string | null | undefined) {
  if (!time) return "No time";
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
