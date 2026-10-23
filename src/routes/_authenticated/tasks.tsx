import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { TASK_STATUS_LABEL, useMe } from "@/lib/me";
import {
  DEFAULT_TIME_BLOCKS,
  compareScheduledTasks,
  findTimeBlock,
  readTimeBlocks,
  timeForBlock,
  validateTimeBlocks,
  type TimeBlock,
} from "@/lib/task-schedule";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill, isOverdue } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TaskStatus = Database["public"]["Enums"]["task_status"];
type Priority = Database["public"]["Enums"]["task_priority"];
const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "review", "done"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
const TIME_BLOCKS_KEY = "venusx.task-time-blocks";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks — VenusX Portal" }] }),
  component: Tasks,
});

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  creator_id: string | null;
  owner_id: string | null;
  member_type: string | null;
  visible_to_creator: boolean;
  source: string;
  archived_at: string | null;
  created_by: string | null;
  creators: { stage_name: string } | null;
};

function Tasks() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [view, setView] = useState("list");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("open");
  const [fCreator, setFCreator] = useState("all");
  const [fPriority, setFPriority] = useState("all");
  const [fMemberType, setFMemberType] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [blocks, setBlocks] = useState(DEFAULT_TIME_BLOCKS);
  const [loadedBlocksKey, setLoadedBlocksKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const blocksKey = me?.id ? `${TIME_BLOCKS_KEY}:${me.id}` : null;

  useEffect(() => {
    if (!blocksKey) return;
    try {
      setBlocks(readTimeBlocks(localStorage.getItem(blocksKey)));
    } catch {
      toast.error("Could not load saved time blocks; defaults are in use.");
    } finally {
      setLoadedBlocksKey(blocksKey);
    }
  }, [blocksKey]);
  useEffect(() => {
    if (!blocksKey || loadedBlocksKey !== blocksKey) return;
    try {
      localStorage.setItem(blocksKey, JSON.stringify(blocks));
    } catch {
      toast.error("Could not save time blocks in this browser.");
    }
  }, [blocks, blocksKey, loadedBlocksKey]);

  const tasks = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id,title,description,status,priority,due_date,due_time,creator_id,owner_id,member_type,visible_to_creator,source,archived_at,created_by,creators(stage_name)",
        )
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data as Task[];
    },
  });
  const creators = useQuery({
    queryKey: ["creators", "options"],
    queryFn: async () =>
      (
        await supabase
          .from("creators")
          .select("id,stage_name")
          .is("archived_at", null)
          .order("stage_name")
      ).data ?? [],
  });
  const people = useQuery({
    queryKey: ["profiles"],
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id,full_name,email")
          .is("membership_removed_at", null)
          .order("full_name")
      ).data ?? [],
  });
  const who = (id: string | null) => {
    const p = people.data?.find((x) => x.id === id);
    return p ? p.full_name || p.email : "Unassigned";
  };
  const canDeleteTask = (task: Task) =>
    !!me && (me.isExec || (me.isStaff && task.created_by === me.id));

  const statusRequests = useRef(new Set<string>());
  const setStatus = useMutation({
    onMutate: async ({ task, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const previous = qc.getQueryData<Task[]>(["tasks", "all"]);
      qc.setQueryData<Task[]>(["tasks", "all"], rows => rows?.map(row => row.id === task.id ? { ...row, status } : row));
      return { previous };
    },
    mutationFn: async ({ task, status }: { task: Task; status: TaskStatus }) => {
      if (me?.isStaff) {
        const { data, error } = await supabase
          .from("tasks")
          .update({ status })
          .eq("id", task.id)
          .select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("You are not authorized to update this task.");
        return;
      }
      const { error } = await supabase.rpc("creator_set_task_status", {
        _task_id: task.id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task status updated");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e, _variables, context) => {
      if (context?.previous) qc.setQueryData(["tasks", "all"], context.previous);
      toast.error((e as Error).message);
    },
    onSettled: (_data, _error, { task }) => {
      statusRequests.current.delete(task.id);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const deleteTask = useMutation({
    mutationFn: async (task: Task) => {
      const { data, error } = await supabase.from("tasks").delete().eq("id", task.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("You are not authorized to delete this task.");
    },
    onSuccess: () => {
      toast.success("Task deleted");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const duplicateTask = useMutation({
    mutationFn: async (task: Task) => {
      const { error } = await supabase.from("tasks").insert({
        title: `${task.title} (copy)`,
        description: task.description,
        status: "todo",
        priority: task.priority,
        due_date: null,
        due_time: null,
        creator_id: task.creator_id,
        owner_id: task.owner_id,
        member_type: task.member_type,
        visible_to_creator: task.visible_to_creator,
        source: "manual",
        created_by: me?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task duplicated without a date or scheduled time");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const moveTask = useMutation({
    mutationFn: async ({
      task,
      status,
      due_time,
    }: {
      task: Task;
      status?: TaskStatus;
      due_time?: string | null;
    }) => {
      const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
      if (status) patch.status = status;
      if (due_time !== undefined) {
        patch.due_time = due_time;
        if (due_time && !task.due_date) patch.due_date = localDateString();
      }
      const { data, error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", task.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("You are not authorized to move this task.");
    },
    onSuccess: () => {
      toast.success("Task moved");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error) => {
      toast.error(`Task move failed: ${(error as Error).message}`);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteWithConfirm = (task: Task) => {
    if (window.confirm(`Permanently delete “${task.title}”?`)) deleteTask.mutate(task);
  };
  const duplicate = (task: Task) => duplicateTask.mutate(task);
  const toggleComplete = (task: Task) => {
    if (statusRequests.current.has(task.id)) return;
    statusRequests.current.add(task.id);
    setStatus.mutate({ task, status: task.status === "done" ? "todo" : "done" });
  };
  const moveStatus = (task: Task, status: TaskStatus) => {
    if (me?.isStaff) moveTask.mutate({ task, status });
    else setStatus.mutate({ task, status });
  };

  const rows = useMemo(
    () =>
      (tasks.data ?? []).filter((t) => {
        if (fStatus === "archived") {
          if (!t.archived_at) return false;
        } else if (t.archived_at) return false;
        if (fStatus === "open" && t.status === "done") return false;
        if (fStatus === "overdue" && !isOverdue(t.due_date, t.status)) return false;
        if (STATUSES.includes(fStatus as TaskStatus) && t.status !== fStatus) return false;
        if (fCreator !== "all" && t.creator_id !== fCreator) return false;
        if (fPriority !== "all" && t.priority !== fPriority) return false;
        if (fMemberType !== "all" && t.member_type !== fMemberType) return false;
        if (mineOnly && t.owner_id !== me?.id) return false;
        const query = q.toLowerCase();
        return (
          t.title.toLowerCase().includes(query) ||
          (t.description ?? "").toLowerCase().includes(query)
        );
      }).sort(compareScheduledTasks),
    [tasks.data, fStatus, fCreator, fPriority, fMemberType, mineOnly, q, me?.id],
  );

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Agency-wide work, filtered to what you're allowed to see."
        actions={me?.isStaff ? <Button onClick={() => setEditing("new")}>New task</Button> : null}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {TASK_STATUS_LABEL[s]}
              </SelectItem>
            ))}
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fCreator} onValueChange={setFCreator}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All creators</SelectItem>
            {(creators.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.stage_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fPriority} onValueChange={setFPriority}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p.replace(/^./, (x) => x.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fMemberType} onValueChange={setFMemberType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Member type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All member types</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="creator">Creator</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={mineOnly} onCheckedChange={setMineOnly} />
          Mine
        </label>
        <Tabs value={view} onValueChange={setView} className="w-full overflow-x-auto sm:ml-auto sm:w-auto">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="calendar">By date</TabsTrigger>
            <TabsTrigger value="schedule">Daily schedule</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tasks.isLoading ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorNote error={tasks.error} retry={() => tasks.refetch()} />
      ) : rows.length === 0 && view !== "schedule" ? (
        <EmptyState title="No tasks match" body="Adjust filters or create a task." />
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="p-3">Task</th>
                <th className="p-3">Creator</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Status</th>
                <th className="p-3">Due</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-accent">
                  <td className="p-3">
                    <button
                      className="text-left hover:text-gold"
                      disabled={!me?.isStaff}
                      onClick={() => setEditing(t)}
                    >
                      {t.title}
                    </button>
                    {t.source !== "manual" && (
                      <span className="ml-2 text-xs text-muted-foreground">auto</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{t.creators?.stage_name ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{who(t.owner_id)}</td>
                  <td className="p-3">
                    <Pill value={t.priority} />
                  </td>
                  <td className="p-3">
                    <Select
                      value={t.status}
                      disabled={
                        !!t.archived_at ||
                        (!me?.isStaff && !(me?.isCreator && t.visible_to_creator))
                      }
                      onValueChange={(v) => setStatus.mutate({ task: t, status: v as TaskStatus })}
                    >
                      <SelectTrigger className="h-8 w-32 capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {TASK_STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td
                    className={
                      "p-3 " +
                      (isOverdue(t.due_date, t.status)
                        ? "text-destructive"
                        : "text-muted-foreground")
                    }
                  >
                    {t.due_date ?? "—"}
                    {t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ""}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <TaskActions
                      task={t}
                      onEdit={() => setEditing(t)}
                      onDelete={() => deleteWithConfirm(t)}
                      onDuplicate={() => duplicate(t)}
                      onToggleComplete={() => toggleComplete(t)}
                      canManage={!!me?.isStaff}
                      canDelete={canDeleteTask(t)}
                      canChangeStatus={!!(me?.isStaff || (me?.isCreator && t.visible_to_creator))}
                      disabled={setStatus.isPending || moveTask.isPending || deleteTask.isPending || duplicateTask.isPending}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === "board" ? (
        <div className="grid gap-4 overflow-x-auto md:grid-cols-5">
          {STATUSES.map((s) => (
            <div
              key={s}
              className="min-w-56 rounded-lg border bg-card/60 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/task-id");
                const task = rows.find((row) => row.id === id);
                if (task && task.status !== s) moveStatus(task, s);
              }}
            >
              <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                {TASK_STATUS_LABEL[s]} · {rows.filter((t) => t.status === s).length}
              </p>
              <div className="space-y-2">
                {rows
                  .filter((t) => t.status === s)
                  .map((t) => (
                    <div
                      key={t.id}
                      draggable={!!me?.isStaff && !t.archived_at}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/task-id", t.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      className="rounded-md border bg-card p-3 text-sm hover:border-gold/50"
                    >
                      <button
                        className="w-full text-left"
                        disabled={!me?.isStaff}
                        onClick={() => setEditing(t)}
                      >
                        <p>{t.title}</p>
                      </button>
                      <Select
                        value={t.status}
                        disabled={
                          !!t.archived_at ||
                          (!me?.isStaff && !(me?.isCreator && t.visible_to_creator))
                        }
                        onValueChange={(value) => moveStatus(t, value as TaskStatus)}
                      >
                        <SelectTrigger aria-label={`Move ${t.title}`} className="mt-2 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {TASK_STATUS_LABEL[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <Pill value={t.priority} />
                        <span className={isOverdue(t.due_date, t.status) ? "text-destructive" : ""}>
                          {t.due_date ?? ""}
                          {t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ""}
                        </span>
                      </div>
                      <TaskActions
                        task={t}
                        onEdit={() => setEditing(t)}
                        onDelete={() => deleteWithConfirm(t)}
                        onDuplicate={() => duplicate(t)}
                        onToggleComplete={() => toggleComplete(t)}
                        canManage={!!me?.isStaff}
                        canDelete={canDeleteTask(t)}
                        canChangeStatus={!!(me?.isStaff || (me?.isCreator && t.visible_to_creator))}
                        disabled={setStatus.isPending || moveTask.isPending || deleteTask.isPending || duplicateTask.isPending}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : view === "calendar" ? (
        <ByDate rows={rows} onOpen={(task) => me?.isStaff && setEditing(task)} />
      ) : (
        <DailySchedule
          rows={rows}
          onOpen={setEditing}
          blocks={blocks}
          onBlocksChange={setBlocks}
          onDelete={deleteWithConfirm}
          onDuplicate={duplicate}
          onToggleComplete={toggleComplete}
          onMove={(task, due_time) => moveTask.mutate({ task, due_time })}
          canChangeStatus={!!me?.isStaff || (me?.isCreator ?? false)}
          canManage={!!me?.isStaff}
          canDelete={canDeleteTask}
          disabled={setStatus.isPending || moveTask.isPending || deleteTask.isPending || duplicateTask.isPending}
        />
      )}
      {editing && (
        <TaskDialog
          task={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          creators={creators.data ?? []}
          people={people.data ?? []}
          meId={me?.id}
          canDelete={editing !== "new" && canDeleteTask(editing)}
        />
      )}
    </div>
  );
}

function DailySchedule({
  rows,
  onOpen,
  blocks,
  onBlocksChange,
  onDelete,
  onDuplicate,
  onToggleComplete,
  onMove,
  canManage,
  canDelete,
  canChangeStatus,
  disabled,
}: {
  rows: Task[];
  onOpen: (task: Task) => void;
  blocks: TimeBlock[];
  onBlocksChange: (blocks: TimeBlock[]) => void;
  onDelete: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  onMove: (task: Task, dueTime: string | null) => void;
  canManage: boolean;
  canDelete: (task: Task) => boolean;
  canChangeStatus: boolean;
  disabled: boolean;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<TimeBlock[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const blockFor = (time: string | null) => findTimeBlock(blocks, time);
  const update = (id: string, key: "label" | "start" | "end", value: string) => {
    setDraft(current => current.map(block => block.id === id ? { ...block, [key]: value } : block));
    setValidation(null);
  };
  const saveBlocks = () => {
    const next = [...draft].sort((a, b) => a.start.localeCompare(b.start));
    const error = validateTimeBlocks(next);
    setValidation(error);
    if (error) return;
    onBlocksChange(next);
    setShowSettings(false);
  };
  const dropOnBlock = (event: React.DragEvent<HTMLDivElement>, block: TimeBlock | null) => {
    event.preventDefault();
    setDragging(false);
    const task = rows.find((row) => row.id === event.dataTransfer.getData("text/task-id"));
    if (!task) return;
    if (canManage) onMove(task, block ? timeForBlock(block, task.due_time) : null);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="outline" size="sm" onClick={() => { setDraft(blocks.map(block => ({ ...block }))); setValidation(null); setShowSettings(true); }}>
          Configure time blocks
        </Button>
      </div>
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configure time blocks</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {draft.map(block => (
              <div key={block.id} className="space-y-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <Input aria-label="Block name" value={block.label} onChange={e => update(block.id, "label", e.target.value)} className="min-w-0" />
                  <Button variant="ghost" size="icon" aria-label={`Delete ${block.label} block`} onClick={() => setDraft(current => current.filter(item => item.id !== block.id))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0 space-y-1"><Label>Start</Label><Input className="min-w-0 w-full" aria-label={`${block.label} starts`} type="time" value={block.start} onChange={e => update(block.id, "start", e.target.value)} /></div>
                  <div className="min-w-0 space-y-1"><Label>End</Label><Input className="min-w-0 w-full" aria-label={`${block.label} ends`} value={block.end} placeholder="24:00" onChange={e => update(block.id, "end", e.target.value)} /></div>
                </div>
              </div>
            ))}
            {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDraft(current => [...current, { id: crypto.randomUUID(), label: "New block", start: "18:00", end: "24:00" }])}>Add block</Button>
              <Button onClick={saveBlocks}>Save blocks</Button>
              <Button variant="ghost" onClick={() => setShowSettings(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[...blocks, { id: "unscheduled", label: "Unscheduled", start: "", end: "" }].map(
          (block) => {
            const group =
              block.id === "unscheduled"
                ? rows.filter((task) => !task.due_time || !blockFor(task.due_time))
                : rows.filter((task) => blockFor(task.due_time)?.id === block.id);
            return (
              <div
                key={block.id}
                className={`min-h-36 rounded-lg border bg-card p-3 transition-colors ${dragging ? "border-dashed border-gold" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDragEnter={() => setDragging(true)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
                }}
                onDrop={(event) => dropOnBlock(event, block.id === "unscheduled" ? null : block)}
              >
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {block.label} · {group.length}
                </p>
                <div className="space-y-2">
                  {group.map((task) => (
                    <div
                      key={task.id}
                      draggable={canManage && !task.archived_at}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/task-id", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(true);
                      }}
                      onDragEnd={() => setDragging(false)}
                      className="min-w-0 rounded-md border p-3 text-sm hover:border-gold/50"
                    >
                      <button
                        className="flex w-full items-start justify-between gap-2 text-left"
                        disabled={!canManage}
                        onClick={() => onOpen(task)}
                      >
                        <span className="min-w-0 break-words">{task.title}</span>
                        <Pill value={task.priority} />
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.due_date ?? "No date"}
                        {task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ""}
                      </p>
                      <Select
                        value={blockFor(task.due_time)?.id ?? "unscheduled"}
                        disabled={!canManage}
                        onValueChange={(value) => {
                          const destination = blocks.find((item) => item.id === value);
                          onMove(
                            task,
                            destination ? timeForBlock(destination, task.due_time) : null,
                          );
                        }}
                      >
                        <SelectTrigger
                          aria-label={`Schedule ${task.title}`}
                          className="mt-2 h-8"
                          disabled={disabled || !canManage || !!task.archived_at}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {blocks.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label}
                            </SelectItem>
                          ))}
                          <SelectItem value="unscheduled">Unscheduled</SelectItem>
                        </SelectContent>
                      </Select>
                      <TaskActions
                        task={task}
                        onEdit={() => onOpen(task)}
                        onDelete={() => onDelete(task)}
                        onDuplicate={() => onDuplicate(task)}
                        onToggleComplete={() => onToggleComplete(task)}
                        canManage={canManage}
                        canDelete={canDelete(task)}
                        canChangeStatus={canManage || (canChangeStatus && task.visible_to_creator)}
                        disabled={disabled}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

function TaskActions({
  task,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleComplete,
  canManage,
  canDelete,
  canChangeStatus,
  disabled,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleComplete: () => void;
  canManage: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={task.status === "done" ? "Reopen task" : "Mark complete"}
        aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
        disabled={disabled || !!task.archived_at || !canChangeStatus}
        onClick={onToggleComplete}
      >
        <CheckCircle2 className={`h-4 w-4 ${task.status === "done" ? "text-success" : ""}`} />
      </Button>
      {canManage && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Duplicate task"
          aria-label={`Duplicate ${task.title}`}
          disabled={disabled}
          onClick={onDuplicate}
        >
          <Copy className="h-4 w-4" />
        </Button>
      )}
      {canManage && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Edit task"
          aria-label={`Edit ${task.title}`}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      {canManage && canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Delete task"
          aria-label={`Delete ${task.title}`}
          className="text-destructive"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ByDate({ rows, onOpen }: { rows: Task[]; onOpen: (t: Task) => void }) {
  const groups = new Map<string, Task[]>();
  for (const t of rows) {
    const k = t.due_date ?? "No date";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([d, ts]) => (
        <div key={d}>
          <p className="mb-2 text-sm font-medium text-gold">
            {d === "No date" ? d : new Date(d + "T00:00").toDateString()}
          </p>
          <div className="divide-y rounded-lg border bg-card">
            {ts.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpen(t)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"
              >
                <span>{t.title}</span>
                <Pill value={t.status} label={TASK_STATUS_LABEL[t.status]} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskDialog({
  task,
  onClose,
  creators,
  people,
  meId,
  canDelete,
}: {
  task: Task | null;
  onClose: () => void;
  meId?: string | undefined;
  creators: { id: string; stage_name: string }[];
  people: { id: string; full_name: string | null; email: string | null }[];
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? ("medium" as Priority),
    status: task?.status ?? ("todo" as TaskStatus),
    due_date: task?.due_date ?? "",
    due_time: task?.due_time ?? "",
    creator_id: task?.creator_id ?? "none",
    owner_id: task?.owner_id ?? "none",
    member_type: task?.member_type ?? "none",
    visible_to_creator: task?.visible_to_creator ?? false,
  });
  const payload = () => ({
    title: f.title.trim(),
    description: f.description || null,
    priority: f.priority,
    status: f.status,
    due_date: f.due_date || null,
    due_time: f.due_time || null,
    creator_id: f.creator_id === "none" ? null : f.creator_id,
    owner_id: f.owner_id === "none" ? null : f.owner_id,
    member_type: f.member_type === "none" ? null : f.member_type,
    visible_to_creator: f.visible_to_creator,
  });
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["tasks"] });
    onClose();
  };
  const err = (e: unknown) => toast.error((e as Error).message);
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = task
        ? await supabase.from("tasks").update(payload()).eq("id", task.id).select("id")
        : await supabase
            .from("tasks")
            .insert({ ...payload(), created_by: meId ?? null })
            .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("You are not authorized to save this task.");
    },
    onSuccess: () => done(task ? "Task updated" : "Task created"),
    onError: err,
  });
  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("tasks")
        .update({ archived_at: task!.archived_at ? null : new Date().toISOString() })
        .eq("id", task!.id);
      if (error) throw error;
    },
    onSuccess: () => done(task?.archived_at ? "Restored" : "Archived"),
    onError: err,
  });
  const del = useMutation({
    mutationFn: async () => {
      const { error, count } = await supabase
        .from("tasks")
        .delete({ count: "exact" })
        .eq("id", task!.id);
      if (error) throw error;
      if (!count) throw new Error("Only executives or the task creator can delete.");
    },
    onSuccess: () => done("Deleted"),
    onError: err,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Title</Label>
            <Input
              required
              maxLength={200}
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select
                value={f.priority}
                onValueChange={(v) => setF({ ...f, priority: v as Priority })}
              >
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={f.status}
                onValueChange={(v) => setF({ ...f, status: v as TaskStatus })}
              >
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {TASK_STATUS_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Due date</Label>
              <Input
                type="date"
                value={f.due_date}
                onChange={(e) => setF({ ...f, due_date: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Scheduled time</Label>
              <Input
                type="time"
                value={f.due_time}
                onChange={(e) => setF({ ...f, due_time: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Owner</Label>
              <Select value={f.owner_id} onValueChange={(v) => setF({ ...f, owner_id: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Member type</Label>
              <Select value={f.member_type} onValueChange={(v) => setF({ ...f, member_type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select member type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="creator">Creator</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Creator</Label>
            <Select value={f.creator_id} onValueChange={(v) => setF({ ...f, creator_id: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No creator</SelectItem>
                {creators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.stage_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.visible_to_creator}
              onCheckedChange={(v) => setF({ ...f, visible_to_creator: v })}
            />
            Show in creator's portal
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={save.isPending}>{task ? "Save" : "Create"}</Button>
            {task && (
              <Button type="button" variant="outline" onClick={() => archive.mutate()}>
                {task.archived_at ? "Restore" : "Archive"}
              </Button>
            )}
            {task && canDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => confirm("Delete this task permanently?") && del.mutate()}
              >
                Delete
              </Button>
            )}
          </div>
        </form>
        {task && <Comments taskId={task.id} />}
      </DialogContent>
    </Dialog>
  );
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Comments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const list = useQuery({
    queryKey: ["comments", taskId],
    queryFn: async () =>
      (
        await supabase
          .from("task_comments")
          .select("id,body,created_at,author_id")
          .eq("task_id", taskId)
          .order("created_at")
      ).data ?? [],
  });
  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("task_comments")
        .insert({ task_id: taskId, body: body.trim(), author_id: u.user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["comments", taskId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-sm font-medium">Comments</p>
      <div className="space-y-2">
        {(list.data ?? []).map((c) => (
          <div key={c.id} className="rounded-md bg-muted p-2 text-sm">
            <p>{c.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(c.created_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          maxLength={4000}
        />
        <Button size="sm" disabled={add.isPending}>
          Post
        </Button>
      </form>
    </div>
  );
}
