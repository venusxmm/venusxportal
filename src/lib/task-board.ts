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
export type BoardBlock = { id: string; label: string; start: string; end: string };
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** End "00:00"/"24:00" means midnight; start > end wraps across midnight. */
function inBlock(b: BoardBlock, time: string) {
  const t = mins(time), s = mins(b.start);
  let e = mins(b.end);
  if (e === 0 || e === 1440) e = 1440;
  return s < e ? t >= s && t < e : t >= s || t < e;
}
function blockMinutes(b: BoardBlock) {
  const s = mins(b.start);
  let e = mins(b.end);
  if (e === 0) e = 1440;
  const out: number[] = [];
  for (let m = s; m !== e % 1440 || (out.length === 0 && s === e % 1440 ? false : false); m = (m + 5) % 1440) {
    out.push(m);
    if (out.length > 288) break;
    if ((m + 5) % 1440 === e % 1440) break;
  }
  return out;
}
/** Rejects empty, duplicate-name, zero-length and overlapping blocks. Returns an error or null. */
export function validateBlocks(blocks: BoardBlock[]) {
  const names = new Set<string>();
  const used = new Set<number>();
  for (const b of blocks) {
    const name = b.label.trim().toLowerCase();
    if (!name) return "Every block needs a name";
    if (names.has(name)) return `Duplicate block name: ${b.label}`;
    names.add(name);
    if (!/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) return "Use HH:MM times";
    if (b.start === b.end || (b.start === "00:00" && b.end === "24:00")) {
      if (b.start === b.end) return `${b.label} has no length`;
    }
    for (const m of blockMinutes(b)) {
      if (used.has(m)) return `${b.label} overlaps another block`;
      used.add(m);
    }
  }
  return null;
}
export const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export function blockForTime(time: string | null, blocks: BoardBlock[] = BOARD_BLOCKS) {
  return time ? blocks.find((b) => inBlock(b, time.slice(0, 5))) : undefined;
}
export function currentBlock(now = new Date(), blocks: BoardBlock[] = BOARD_BLOCKS) {
  return blockForTime(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: AGENCY_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now),
    blocks,
  );
}
export function canMoveExecution(task: Execution, executive: boolean) {
  return executive && !task.archived_at && !["done", "skipped", "cancelled"].includes(task.status);
}
export function timeInBlock(block: BoardBlock, task: Execution, rows: Execution[]) {
  if (task.due_time && inBlock(block, task.due_time.slice(0, 5)))
    return task.due_time?.slice(0, 5) ?? block.start;
  const used = new Set(
    rows
      .filter(
        (r) =>
          r.id !== task.id &&
          r.scheduled_date === task.scheduled_date &&
          !r.archived_at &&
          !["cancelled", "skipped"].includes(r.status),
      )
      .map((r) => r.due_time?.slice(0, 5)),
  );
  for (const minute of blockMinutes(block)) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (!used.has(time)) return time;
  }
  return null;
}
