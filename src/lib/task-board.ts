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
function blockMinutes(b: BoardBlock, step = 5) {
  const s = mins(b.start);
  const len = (((mins(b.end) - s) % 1440) + 1440) % 1440 || 1440;
  const out: number[] = [];
  for (let k = 0; k < len; k += step) out.push((s + k) % 1440);
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
    if (b.start === b.end) return `${b.label} has no length`;
    for (const m of blockMinutes(b, 1)) {
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
/** Stored block wins; otherwise the block containing the task's time; otherwise the first block. */
export function effectiveBlock(task: Pick<Execution, "due_time"> & { block_id?: string | null }, blocks: BoardBlock[] = BOARD_BLOCKS) {
  return (task.block_id && blocks.find((b) => b.id === task.block_id)) || blockForTime(task.due_time, blocks) || blocks[0];
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
/** Delay until the next whole minute (+50ms), so block changes land on the boundary. */
export function msToNextMinute(now = new Date()) {
  return 60_000 - (now.getTime() % 60_000) + 50;
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

export type SortMode = "manual" | "time" | "priority";
export const SORT_MODES: SortMode[] = ["manual", "time", "priority"];
export const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const manualKey = (a: Execution, b: Execution) =>
  (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) ||
  (a.due_time ?? "24:00").localeCompare(b.due_time ?? "24:00") ||
  a.title.localeCompare(b.title);
/** Shared block ordering (UI + MCP). Time/priority modes fall back to manual order for ties and untimed tasks. */
export function orderBlock<T extends Execution>(rows: T[], mode: SortMode = "manual"): T[] {
  const list = [...rows];
  if (mode === "time")
    return list.sort((a, b) => (a.due_time ? 0 : 1) - (b.due_time ? 0 : 1) || (a.due_time && b.due_time ? a.due_time.localeCompare(b.due_time) : 0) || manualKey(a, b));
  if (mode === "priority")
    return list.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || manualKey(a, b));
  return list.sort(manualKey);
}
