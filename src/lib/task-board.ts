import type { Execution } from "./task-executions";
import { AGENCY_TIMEZONE } from "./task-executions";

export const BOARD_BLOCKS = [
  { id: "night", label: "Night", start: "00:00", end: "04:00" },
  { id: "early", label: "Early Morning", start: "04:00", end: "06:00" },
  { id: "morning", label: "Morning", start: "06:00", end: "12:00" },
  { id: "midday", label: "Midday", start: "12:00", end: "15:00" },
  { id: "afternoon", label: "Afternoon", start: "15:00", end: "18:00" },
  { id: "evening", label: "Evening", start: "18:00", end: "24:00" },
];
export type BoardBlock = (typeof BOARD_BLOCKS)[number];
export const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export function blockForTime(time: string | null) {
  return time ? BOARD_BLOCKS.find((b) => time.slice(0, 5) >= b.start && time.slice(0, 5) < b.end) : undefined;
}
export function currentBlock(now = new Date()) {
  return blockForTime(new Intl.DateTimeFormat("en-GB", { timeZone: AGENCY_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now));
}
export function canMoveExecution(task: Execution, executive: boolean) {
  return executive && !task.archived_at && !["done", "skipped", "cancelled"].includes(task.status);
}
export function timeInBlock(block: BoardBlock, task: Execution, rows: Execution[]) {
  if (blockForTime(task.due_time)?.id === block.id) return task.due_time?.slice(0, 5) ?? block.start;
  const used = new Set(rows.filter((r) => r.id !== task.id && r.scheduled_date === task.scheduled_date && !r.archived_at && !["cancelled", "skipped"].includes(r.status)).map((r) => r.due_time?.slice(0, 5)));
  const start = Number(block.start.slice(0, 2)) * 60;
  const end = Number(block.end.slice(0, 2)) * 60;
  for (let minute = start; minute < end; minute += 5) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (!used.has(time)) return time;
  }
  return null;
}