export type TimeBlock = { id: string; label: string; start: string; end: string };

export const DEFAULT_TIME_BLOCKS: TimeBlock[] = [
  { id: "early", label: "Early morning", start: "00:00", end: "06:00" },
  { id: "morning", label: "Morning", start: "06:00", end: "12:00" },
  { id: "midday", label: "Midday", start: "12:00", end: "15:00" },
  { id: "afternoon", label: "Afternoon", start: "15:00", end: "18:00" },
  { id: "evening", label: "Evening", start: "18:00", end: "24:00" },
];

export function timeToMinutes(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}

export function validateTimeBlocks(blocks: TimeBlock[]): string | null {
  if (blocks.length === 0) return "Add at least one time block.";
  const ids = new Set<string>();
  let previousEnd = -1;
  for (const block of blocks) {
    if (!block.id || ids.has(block.id)) return "Time block IDs must be unique.";
    ids.add(block.id);
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    if (start == null || end == null || start >= end) {
      return `${block.label} must have a valid start time before its end time.`;
    }
    if (start < previousEnd) return "Time blocks cannot overlap.";
    previousEnd = end;
  }
  return null;
}

export function findTimeBlock(blocks: TimeBlock[], time: string | null): TimeBlock | undefined {
  if (!time) return undefined;
  const value = timeToMinutes(time.slice(0, 5));
  if (value == null) return undefined;
  return blocks.find((block) => {
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    return start != null && end != null && value >= start && value < end;
  });
}

export function timeForBlock(block: TimeBlock, currentTime: string | null): string {
  const currentBlock = findTimeBlock([block], currentTime);
  return currentBlock && currentTime ? currentTime.slice(0, 5) : block.start;
}

export function readTimeBlocks(serialized: string | null): TimeBlock[] {
  if (!serialized) return DEFAULT_TIME_BLOCKS;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value) || !value.every(isTimeBlock)) return DEFAULT_TIME_BLOCKS;
    const blocks = value;
    return validateTimeBlocks(blocks) ? DEFAULT_TIME_BLOCKS : blocks;
  } catch {
    return DEFAULT_TIME_BLOCKS;
  }
}

function isTimeBlock(value: unknown): value is TimeBlock {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block["id"] === "string" &&
    typeof block["label"] === "string" &&
    typeof block["start"] === "string" &&
    typeof block["end"] === "string"
  );
}
