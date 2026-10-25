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
