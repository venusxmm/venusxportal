import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { agencyDate, executionOverdue, type Execution } from "@/lib/task-executions";
import { fail } from "./supabase";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD (America/Bogota)");

export async function agenda(sb: SupabaseClient, date?: string): Promise<Execution[]> {
  const { data, error } = await sb.rpc("task_agenda", { _date: date ?? agencyDate() });
  if (error) fail(error.message);
  return (data ?? []) as Execution[];
}

export const toExecutionJson = (t: Execution) => ({
  execution_id: t.projected ? null : t.id,
  task_id: t.task_id,
  title: t.title,
  description: t.description,
  owner_id: t.owner_id,
  creator_id: t.creator_id,
  priority: t.priority,
  date: t.scheduled_date,
  time: t.due_time,
  status: t.status,
  recurring: t.recurring,
  overdue: executionOverdue(t),
});

export const taskFields = {
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  due_date: dateSchema.nullable().optional(),
  due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe("HH:MM 24h Bogotá"),
  owner_id: z.string().uuid().nullable().optional(),
  creator_id: z.string().uuid().nullable().optional(),
  recurrence: z.enum(["once", "daily", "weekdays"]).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("0=Sun..6=Sat, for weekdays"),
  visible_to_creator: z.boolean().optional(),
};

// Same call the Tasks screen makes; executive-only checks live in the database.
export async function saveConfig(sb: SupabaseClient, taskId: string | null, config: Record<string, unknown>) {
  const { data, error } = await sb.rpc("save_task_configuration", {
    _task_id: taskId ?? "00000000-0000-0000-0000-000000000000",
    _config: { ...config, apply_today: !!taskId },
  });
  if (error) fail(error.message);
  return data as string | null;
}

export async function executionAction(sb: SupabaseClient, taskId: string, date: string, action: "complete" | "reopen") {
  const row = (await agenda(sb, date)).find((t) => t.task_id === taskId && t.scheduled_date === date);
  if (!row) fail("No execution of this task on that date is visible to you.");
  const { error } = row.projected
    ? await sb.rpc("task_future_action", { _task_id: taskId, _date: date, _action: action })
    : await sb.rpc("task_execution_action", { _id: row.id, _action: action });
  if (error) fail(error.message);
}
