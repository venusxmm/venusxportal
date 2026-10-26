import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  Repeat2,
  Clock,
  GripVertical,
  ArrowRightLeft,
  Trash2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useMe } from "@/lib/me";
import {
  agencyDate,
  shiftDate,
  executionOverdue,
  canExecute,
  formatTime12,
  type Execution,
} from "@/lib/task-executions";
import {
  BOARD_BLOCKS,
  blockForTime,
  currentBlock,
  msToNextMinute,
  timeInBlock,
  canMoveExecution,
  titleCase,
  validateBlocks,
  type BoardBlock,
} from "@/lib/task-board";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MEMBER_TYPES = ["all", "creator", "employee", "executive", "partner"];
const metaDescription = "Your dated VenusX task agenda, recurring work and execution history.";
export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — VenusX Portal" },
      { name: "description", content: metaDescription },
      { property: "og:title", content: "Tasks — VenusX Portal" },
      { property: "og:description", content: metaDescription },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Tasks,
});

function Tasks() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [date, setDate] = useState(() => agencyDate());
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState("schedule");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [owner, setOwner] = useState("all");
  const [creator, setCreator] = useState("all");
  const [status, setStatus] = useState("all");
  const [details, setDetails] = useState<Execution | null>(null);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [moving, setMoving] = useState<Execution | null>(null);
  const [dragging, setDragging] = useState<Execution | null>(null);
  const [dropBlock, setDropBlock] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Execution[]>([]);
  useEffect(() => {
    // One clock, re-aligned to each minute boundary so "Now" switches blocks on time.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = new Date();
      setNow((prev) => {
        const prevDay = agencyDate(prev);
        setDate((d) => (d === prevDay ? agencyDate(next) : d));
        return next;
      });
      timer = setTimeout(tick, msToNextMinute(next));
    };
    timer = setTimeout(tick, msToNextMinute());
    return () => clearTimeout(timer);
  }, []);
  const agenda = useQuery({
    queryKey: ["tasks", "agenda", date, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("task_agenda", { _date: date });
      if (error) throw error;
      return data as unknown as Execution[];
    },
  });
  const blockRows = useQuery({
    queryKey: ["tasks", "time-blocks"],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_time_blocks")
        .select("id,label,start_time,end_time,position")
        .order("position");
      if (error) throw error;
      return data;
    },
  });
  const blocks: BoardBlock[] = blockRows.data?.length
    ? blockRows.data.map((b) => ({
        id: b.id,
        label: b.label,
        start: b.start_time.slice(0, 5),
        end: b.end_time.slice(0, 5) === "00:00" ? "24:00" : b.end_time.slice(0, 5),
      }))
    : BOARD_BLOCKS;
  const [editingBlocks, setEditingBlocks] = useState(false);
  const configurations = useQuery({
    queryKey: ["tasks", "configurations"],
    enabled: !!me?.isExec,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const people = useQuery({
    queryKey: ["tasks", "people"],
    enabled: !!me?.isExec,
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,email")
          .is("membership_removed_at", null)
          .is("access_revoked_at", null),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      return profiles.data.map((p) => ({
        ...p,
        roles: roles.data.filter((r) => r.user_id === p.id).map((r) => r.role as string),
      }));
    },
  });
  const [deleteChoice, setDeleteChoice] = useState<Execution | null>(null);
  const trashSeries = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.rpc("trash_task_series", { _task_id: taskId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setDeleteChoice(null);
      setDetails(null);
      toast.success("Moved to Trash; restore it from Trash anytime");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const creators = useQuery({
    queryKey: ["tasks", "creators"],
    enabled: !!me?.isExec,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators")
        .select("id,stage_name,user_id")
        .is("archived_at", null);
      if (error) throw error;
      return data;
    },
  });
  const move = useMutation({
    mutationFn: async ({
      task,
      time,
      targetDate,
    }: {
      task: Execution;
      time: string;
      targetDate?: string;
    }) => {
      const { error } = await supabase.rpc("move_task_execution", {
        _id: task.projected ? "00000000-0000-0000-0000-000000000000" : task.id,
        _task_id: task.task_id,
        _occurrence_date: task.occurrence_date ?? task.scheduled_date ?? date,
        _time: time,
        ...(targetDate ? { _date: targetDate } : {}),
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["execution-events"] });
      toast.success(
        `Scheduled ${variables.targetDate ?? variables.task.scheduled_date} at ${variables.time}`,
      );
      setMoving(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const archive = useMutation({
    mutationFn: async (tasks: Execution[]) => {
      const only = tasks[0];
      if (tasks.length === 1 && only?.projected && only.scheduled_date) {
        const { error } = await supabase.rpc("task_future_action", {
          _task_id: only.task_id,
          _date: only.scheduled_date,
          _action: "archive",
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("archive_task_executions", {
        _ids: tasks.map((t) => t.id),
        _confirm_count: tasks.length,
        _completed_only: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["execution-events"] });
      setDeleting([]);
      setDeleteChoice(null);
      setSelected([]);
      setDetails(null);
      toast.success("Moved to Trash; other dates unchanged");
    },
    onError: (error) => toast.error(error.message),
  });
  const dropTask = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (dragging && block && canMoveExecution(dragging, !!me?.isExec)) {
      const time = timeInBlock(block, dragging, agenda.data ?? []);
      if (time) move.mutate({ task: dragging, time });
      else toast.error("This block is full. Choose an exact time.");
    }
    setDragging(null);
    setDropBlock(null);
  };
  const action = useMutation({
    mutationFn: async ({
      task,
      action,
      body,
    }: {
      task: Execution;
      action: string;
      body?: string | undefined;
    }) => {
      const { error } =
        task.projected && task.scheduled_date
          ? await supabase.rpc("task_future_action", {
              _task_id: task.task_id,
              _date: task.scheduled_date,
              _action: action,
              ...(body === undefined ? {} : { _body: body }),
            })
          : await supabase.rpc("task_execution_action", {
              _id: task.id,
              _action: action,
              ...(body === undefined ? {} : { _body: body }),
            });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["execution-events"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const rows = (agenda.data ?? [])
    .filter(
      (t) =>
        !t.archived_at &&
        t.title.toLowerCase().includes(search.toLowerCase()) &&
        (priority === "all" || t.priority === priority) &&
        (owner === "all" || t.owner_id === owner) &&
        (creator === "all" || t.creator_id === creator) &&
        (status === "all" ||
          (status === "open"
            ? !["done", "skipped", "cancelled"].includes(t.status)
            : t.status === status)),
    )
    .sort(
      (a, b) =>
        (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999") ||
        (a.due_time ?? "24:00").localeCompare(b.due_time ?? "24:00"),
    );
  const eligible = rows.filter((t) => !t.projected && t.status !== "cancelled");
  const isSeries = (t: Execution) => {
    const c = configurations.data?.find((x) => x.id === t.task_id);
    return c ? c.recurrence !== "once" : t.recurring;
  };
  const active = rows.filter((t) => !["done", "skipped", "cancelled"].includes(t.status));
  const overdue = active.filter((t) => executionOverdue(t, now));
  const todayRows = active.filter((t) => t.scheduled_date === date);
  const completed = rows.filter(
    (t) => ["done", "skipped", "cancelled"].includes(t.status) && t.scheduled_date === date,
  );
  const who = (id: string | null) =>
    id === me?.id
      ? "You"
      : people.data?.find((p) => p.id === id)?.full_name ||
        people.data?.find((p) => p.id === id)?.email ||
        (id ? "Assigned member" : "Unassigned");
  const renderCard = (t: Execution) => {
    const allowed =
      !!me &&
      !t.archived_at &&
      t.status !== "cancelled" &&
      (canExecute(t, me.id, me.isExec) || !!t.visible_to_creator);
    const overdueState = executionOverdue(t, now);
    return (
      <article key={t.id} className="min-w-0 rounded-md border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          {canMoveExecution(t, !!me?.isExec) && t.scheduled_date ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-grab"
              aria-label={`Drag ${t.title}`}
              title="Drag to a time block or choose Move"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", t.id);
                e.dataTransfer.effectAllowed = "move";
                setDragging(t);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropBlock(null);
              }}
            >
              <GripVertical className="h-4 w-4" />
            </Button>
          ) : (
            <span />
          )}
          {me?.isExec && view === "list" && !t.projected && (
            <Checkbox
              aria-label={`Select ${t.title}`}
              checked={selected.includes(t.id)}
              onCheckedChange={(checked) =>
                setSelected((ids) => (checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)))
              }
            />
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <p
              className={`mb-2 flex items-center gap-2 text-sm font-medium ${overdueState ? "text-destructive" : "text-gold"}`}
            >
              <Clock className="h-4 w-4 shrink-0" />
              {formatTime12(t.due_time)}
              {t.recurring && <Repeat2 className="h-4 w-4 shrink-0" aria-label="Recurring" />}
            </p>
            <h3
              className={`break-words font-medium ${t.status === "done" ? "text-muted-foreground" : ""}`}
            >
              {t.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.scheduled_date || "No date"} · {who(t.owner_id)}
            </p>
          </div>
          <Pill
            value={overdueState ? "overdue" : t.status}
            label={
              overdueState
                ? "Overdue"
                : t.status === "skipped"
                  ? "Skipped"
                  : t.skip_state === "pending"
                    ? "Skip Requested"
                    : t.status === "todo"
                      ? "Pending"
                      : undefined
            }
          />
        </div>
        {t.skip_state === "pending" && (
          <p className="mt-3 text-sm text-warning">
            Skip requested{t.skip_reason ? ` · ${t.skip_reason}` : ""}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setDetails(t)}>
            View Details
          </Button>
          {!["cancelled", "skipped"].includes(t.status) && (
            <Button
              className="min-h-11"
              variant={t.status === "done" ? "outline" : "default"}
              disabled={!allowed || action.isPending}
              onClick={() =>
                action.mutate({ task: t, action: t.status === "done" ? "reopen" : "complete" })
              }
            >
              {t.status === "done" ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t.status === "done" ? "Reopen" : "Complete"}
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {me?.isExec && configurations.data?.some((c) => c.id === t.task_id) && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit ${t.title}`}
              onClick={() => {
                const c = configurations.data?.find((x) => x.id === t.task_id);
                if (c) setEditing(c);
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {canMoveExecution(t, !!me?.isExec) && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${t.title}`}
              onClick={() => setMoving(t)}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Move
            </Button>
          )}
          {me?.isExec && !t.archived_at && t.status !== "cancelled" && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${t.title}`}
              onClick={() => setDeleteChoice(t)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </article>
    );
  };
  const section = (title: string, tasks: Execution[]) => (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <span className="text-muted-foreground">{tasks.length}</span>
      </h2>
      {tasks.length ? (
        <div className="grid gap-3 lg:grid-cols-2">{tasks.map(renderCard)}</div>
      ) : (
        <p className="border-t py-4 text-sm text-muted-foreground">No tasks</p>
      )}
    </section>
  );
  const currentDetails = details
    ? ((agenda.data ?? []).find((t) => t.id === details.id) ??
      details)
    : null;
  if (me?.isCreator && !me.isStaff) return <Navigate to="/portal" />;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Tasks"
        subtitle="America/Bogota · UTC−5"
        actions={
          me?.isExec && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => setEditingBlocks(true)}>
                <Clock className="h-4 w-4" />
                Edit Time Blocks
              </Button>
              <Button className="min-h-11" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" />
                New Task
              </Button>
            </div>
          )
        }
      />
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex">
        <Button
          size="icon"
          variant="outline"
          className="h-11 w-11 shrink-0"
          aria-label="Previous date"
          onClick={() => setDate(shiftDate(date, -1))}
        >
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Schedule date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-11 min-w-0 sm:w-44"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-11 w-11 shrink-0"
          aria-label="Next date"
          onClick={() => setDate(shiftDate(date, 1))}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          className="col-span-3 min-h-11 sm:ml-2"
          onClick={() => setDate(agencyDate())}
        >
          Today
        </Button>
        <p className="hidden text-sm text-muted-foreground sm:ml-auto sm:block">
          {new Date(`${date}T12:00:00Z`).toLocaleDateString("en", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:flex sm:w-fit">
          <TabsTrigger className="min-h-11" value="schedule">
            Daily Schedule
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="overdue">
            Overdue
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="list">
            List
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="board">
            Board
          </TabsTrigger>
          {me?.isExec && (
            <TabsTrigger className="min-h-11" value="trash">
              Trash
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      <details
        className="group border-b pb-3"
        open={
          search !== "" ||
          priority !== "all" ||
          owner !== "all" ||
          creator !== "all" ||
          status !== "all"
        }
      >
        <summary className="cursor-pointer text-sm font-medium">Filters</summary>
        <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11"
          />
          <Filter
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={[
              { value: "all", label: "All priorities" },
              ...["low", "medium", "high", "critical"].map((value) => ({ value, label: value })),
            ]}
          />
          <Filter
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "open", label: "Open" },
              ...["done", "skipped", "cancelled"].map((value) => ({ value, label: value })),
            ]}
          />
          {me?.isExec && (
            <>
              <Filter
                label="Owner"
                value={owner}
                onChange={setOwner}
                options={[
                  { value: "all", label: "All owners" },
                  ...(people.data ?? []).map((p) => ({
                    value: p.id,
                    label: p.full_name || p.email || "Member",
                  })),
                ]}
              />
              <Filter
                label="Creator"
                value={creator}
                onChange={setCreator}
                options={[
                  { value: "all", label: "All creators" },
                  ...(creators.data ?? []).map((c) => ({ value: c.id, label: c.stage_name })),
                ]}
              />
            </>
          )}
        </div>
      </details>
      {me?.isExec && view === "list" && eligible.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              setSelected(selected.length === eligible.length ? [] : eligible.map((t) => t.id))
            }
          >
            {selected.length > 0 && selected.length === eligible.length
              ? "Clear Selection"
              : `Select All (${eligible.length})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleting(eligible.filter((t) => selected.includes(t.id)))}
            disabled={!eligible.some((t) => selected.includes(t.id))}
          >
            <Trash2 className="h-4 w-4" />
            Move Selected Occurrences To Trash (
            {eligible.filter((t) => selected.includes(t.id)).length})
          </Button>
        </div>
      )}
      {agenda.error ? (
        <ErrorNote error={agenda.error} retry={() => agenda.refetch()} />
      ) : agenda.isLoading ? (
        <Loading />
      ) : view === "trash" && me?.isExec ? (
        <TrashView search={search} who={who} />
      ) : view === "overdue" ? (
        section("Overdue · Original Dates", overdue)
      ) : view === "board" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {["todo", "done", "skipped"].map((s) => (
            <section key={s} className="space-y-3">
              <h2 className="font-medium">
                {s === "todo" ? "Pending" : s === "done" ? "Completed" : "Skipped"}
              </h2>
              {rows
                .filter((t) =>
                  s === "todo"
                    ? !["done", "skipped", "cancelled"].includes(t.status)
                    : t.status === s,
                )
                .map(renderCard)}
            </section>
          ))}
        </div>
      ) : view === "list" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(renderCard)}
          {!rows.length && <EmptyState title="No tasks match" />}
        </div>
      ) : (
        <div className="space-y-7">
          <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {blocks.map((block) => {
              const blockRows = todayRows.filter(
                (t) => blockForTime(t.due_time, blocks)?.id === block.id,
              );
              const current = date === agencyDate(now) && currentBlock(now, blocks)?.id === block.id;
              return (
                <section
                  key={block.id}
                  aria-label={`${block.label} time block`}
                  data-block={block.id}
                  className={`min-w-0 border-t-2 pt-3 ${current || dropBlock === block.id ? "border-gold" : "border-border"}`}
                  onDragOver={(e) => {
                    if (dragging) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropBlock(block.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropBlock(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropTask(block.id);
                  }}
                >
                  <header className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">
                        {block.label}{" "}
                        {current && <span className="ml-1 text-xs text-gold">Now</span>}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {formatTime12(block.start)}–{formatTime12(block.end)}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{blockRows.length}</span>
                  </header>
                  <div
                    className={`min-h-24 space-y-2 ${dragging ? "rounded-md border border-dashed border-gold p-2" : ""}`}
                  >
                    {blockRows.map(renderCard)}
                    {!blockRows.length && (
                      <p className="py-5 text-center text-xs text-muted-foreground">
                        {dragging ? "Drop Here" : "No Tasks"}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          {todayRows.some((t) => t.due_time && !blockForTime(t.due_time, blocks)) &&
            section(
              "Unscheduled Hours",
              todayRows.filter((t) => t.due_time && !blockForTime(t.due_time, blocks)),
            )}
          {section(
            "No Time",
            todayRows.filter((t) => !t.due_time),
          )}
          {active.some((t) => !t.scheduled_date) &&
            section(
              "No date",
              active.filter((t) => !t.scheduled_date),
            )}
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Done & Skipped · {completed.length}
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">{completed.map(renderCard)}</div>
          </details>
        </div>
      )}
      {currentDetails && (
        <ExecutionDetails
          task={currentDetails}
          executive={!!me?.isExec}
          allowed={
            !!me &&
            !currentDetails.archived_at &&
            currentDetails.status !== "cancelled" &&
            (me.isExec || currentDetails.owner_id === me.id || !!currentDetails.visible_to_creator)
          }
          pending={action.isPending}
          onClose={() => setDetails(null)}
          onAction={(act, body) => action.mutate({ task: currentDetails, action: act, body })}
        />
      )}
      {moving && (
        <MoveDialog
          task={moving}
          blocks={blocks}
          rows={agenda.data ?? []}
          pending={move.isPending}
          onClose={() => setMoving(null)}
          onSave={(time, targetDate) => move.mutate({ task: moving, time, targetDate })}
        />
      )}
      {editingBlocks && me?.isExec && (
        <TimeBlocksDialog blocks={blocks} onClose={() => setEditingBlocks(false)} />
      )}
      {deleteChoice && me?.isExec && (
        <Dialog open onOpenChange={(open) => !open && setDeleteChoice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{deleteChoice.title}”?</DialogTitle>
              <DialogDescription>
                {isSeries(deleteChoice)
                  ? "Choose what to delete. Both go to Trash and can be restored."
                  : "This one-time task moves to Trash and disappears from every view and Creator's Portal. You can restore it from Trash."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {isSeries(deleteChoice) ? (
                <>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={archive.isPending || trashSeries.isPending}
                    onClick={() => archive.mutate([deleteChoice])}
                  >
                    Delete This Occurrence ({deleteChoice.scheduled_date ?? "No date"})
                  </Button>
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    disabled={archive.isPending || trashSeries.isPending}
                    onClick={() => trashSeries.mutate(deleteChoice.task_id)}
                  >
                    Delete Entire Series
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={trashSeries.isPending}
                  onClick={() => trashSeries.mutate(deleteChoice.task_id)}
                >
                  Move To Trash
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDeleteChoice(null)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {deleting.length > 0 && (
        <Dialog open onOpenChange={(open) => !open && setDeleting([])}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Move {deleting.length} Occurrence{deleting.length === 1 ? "" : "s"} To Trash?
              </DialogTitle>
              <DialogDescription>
                Only these dated occurrences move to Trash. Recurring rules and other dates are not
                changed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleting([])}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => archive.mutate(deleting)}
              >
                Move To Trash ({deleting.length})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {editing && me?.isExec && (
        <ConfigurationDialog
          task={editing === "new" ? null : editing}
          people={people.data ?? []}
          creators={creators.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={!!disabled}>
      <SelectTrigger aria-label={label} className="h-11 min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.value === "all" ||
            o.value === "none" ||
            [
              "low",
              "medium",
              "high",
              "critical",
              "done",
              "skipped",
              "cancelled",
              "enabled",
              "paused",
              "disabled",
              "once",
              "daily",
              "weekdays",
            ].includes(o.value)
              ? titleCase(o.label)
              : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function ExecutionDetails({
  task,
  executive,
  allowed,
  pending,
  onClose,
  onAction,
}: {
  task: Execution;
  executive: boolean;
  allowed: boolean;
  pending: boolean;
  onClose: () => void;
  onAction: (action: string, body?: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const events = useQuery({
    queryKey: ["execution-events", task.id],
    enabled: !task.projected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_execution_events")
        .select("*")
        .eq("execution_id", task.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] min-w-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">{task.title}</DialogTitle>
          <DialogDescription>
            {task.scheduled_date || "No date"} · {formatTime12(task.due_time)} ·
            America/Bogota
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {allowed && !["cancelled", "skipped"].includes(task.status) && (
            <Button
              disabled={pending}
              onClick={() => onAction(task.status === "done" ? "reopen" : "complete")}
            >
              <Check className="h-4 w-4" />
              {task.status === "done" ? "Reopen" : "Complete"}
            </Button>
          )}
          <section>
            <h3 className="mb-2 font-medium">Description & Instructions</h3>
            <p className="whitespace-pre-wrap break-words text-sm">
              {task.description || "No description"}
            </p>
          </section>
          <div className="flex flex-wrap gap-2">
            <Pill value={task.status} />
            <Pill value={task.priority} />
            {task.recurring && <Pill value="recurring" />}
          </div>
          {allowed && task.recurring && !["done", "skipped", "cancelled"].includes(task.status) && (
            <section className="space-y-2 border-t pt-4">
              {task.skip_state === "pending" ? (
                <>
                  <p className="text-sm text-warning">
                    Skip awaiting approval{task.skip_reason ? ` · ${task.skip_reason}` : ""}
                  </p>
                  {executive && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button disabled={pending} onClick={() => onAction("approve_skip")}>
                        Approve skip
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => onAction("reject_skip")}
                      >
                        Reject skip
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Label htmlFor="skip-reason">Skip this execution</Label>
                  <Input
                    id="skip-reason"
                    placeholder="Reason (optional)"
                    maxLength={4000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => onAction("request_skip", reason)}
                  >
                    Request skip
                  </Button>
                </>
              )}
            </section>
          )}
          <section className="border-t pt-4">
            <h3 className="mb-3 font-medium">Comments & History</h3>
            {events.error && <ErrorNote error={events.error} />}
            <ol className="space-y-3">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="border-l-2 border-gold-soft pl-3">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {e.action === "comment" ? e.body : titleCase(e.action)}
                    {e.action !== "comment" && e.body ? ` · ${eventBody(e.action, e.body)}` : ""}
                  </p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("en", { timeZone: "America/Bogota" })}
                  </time>
                </li>
              ))}
            </ol>
            {allowed && (
              <form
                className="mt-4 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) {
                    onAction("comment", comment);
                    setComment("");
                  }
                }}
              >
                <Label htmlFor="execution-comment">Add Comment</Label>
                <Textarea
                  id="execution-comment"
                  maxLength={4000}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button disabled={pending || !comment.trim()}>Post Comment</Button>
              </form>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
type TrashItem = {
  key: string;
  kind: "series" | "occurrence";
  id: string;
  title: string;
  owner_id: string | null;
  label: string;
  deletedAt: string | null;
};
function TrashView({ search, who }: { search: string; who: (id: string | null) => string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ op: "restore" | "purge"; items: TrashItem[] } | null>(
    null,
  );
  const trash = useQuery({
    queryKey: ["tasks", "trash"],
    queryFn: async () => {
      const [tasks, execs] = await Promise.all([
        supabase.from("tasks").select("*").not("trashed_at", "is", null),
        supabase
          .from("task_executions")
          .select("*")
          .not("archived_at", "is", null)
          .is("purged_at", null),
      ]);
      if (tasks.error) throw tasks.error;
      if (execs.error) throw execs.error;
      const trashedIds = new Set(tasks.data.map((t) => t.id));
      const items: TrashItem[] = [
        ...tasks.data.map((t) => ({
          key: `s:${t.id}`,
          kind: "series" as const,
          id: t.id,
          title: t.title,
          owner_id: t.owner_id,
          label:
            t.recurrence === "once"
              ? "One-time task"
              : `Entire series · ${t.recurrence === "daily" ? "Daily" : t.weekdays.map((d) => WEEKDAYS[d]).join(", ")}`,
          deletedAt: t.trashed_at,
        })),
        ...execs.data
          .filter((e) => !trashedIds.has(e.task_id))
          .map((e) => ({
            key: `o:${e.id}`,
            kind: "occurrence" as const,
            id: e.id,
            title: e.title,
            owner_id: e.owner_id,
            label: `Occurrence · ${e.scheduled_date ?? "No date"} · ${formatTime12(e.due_time)}`,
            deletedAt: e.archived_at,
          })),
      ];
      return items.sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
    },
  });
  const run = useMutation({
    mutationFn: async ({ op, items }: { op: "restore" | "purge"; items: TrashItem[] }) => {
      const series = items.filter((i) => i.kind === "series").map((i) => i.id);
      const occ = items.filter((i) => i.kind === "occurrence").map((i) => i.id);
      if (op === "restore") {
        for (const id of series) {
          const { error } = await supabase.rpc("restore_task_series", { _task_id: id });
          if (error) throw error;
        }
        if (occ.length) {
          const { error } = await supabase.rpc("restore_task_executions", {
            _ids: occ,
            _confirm_count: occ.length,
          });
          if (error) throw error;
        }
      } else {
        if (occ.length) {
          const { error } = await supabase.rpc("purge_task_executions", {
            _ids: occ,
            _confirm_count: occ.length,
          });
          if (error) throw error;
        }
        if (series.length) {
          const { error } = await supabase.rpc("purge_tasks", {
            _ids: series,
            _confirm_count: series.length,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setSelected([]);
      setConfirm(null);
      toast.success(v.op === "restore" ? "Restored" : "Deleted permanently");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const items = (trash.data ?? []).filter((i) =>
    i.title.toLowerCase().includes(search.toLowerCase()),
  );
  const chosen = items.filter((i) => selected.includes(i.key));
  if (trash.error) return <ErrorNote error={trash.error} retry={() => trash.refetch()} />;
  if (trash.isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              setSelected(selected.length === items.length ? [] : items.map((i) => i.key))
            }
          >
            {selected.length > 0 && selected.length === items.length
              ? "Clear Selection"
              : `Select All (${items.length})`}
          </Button>
          <Button
            variant="outline"
            disabled={!chosen.length}
            onClick={() => setConfirm({ op: "restore", items: chosen })}
          >
            <RotateCcw className="h-4 w-4" />
            Restore Selected ({chosen.length})
          </Button>
          <Button
            variant="outline"
            disabled={!chosen.length}
            onClick={() => setConfirm({ op: "purge", items: chosen })}
          >
            <Trash2 className="h-4 w-4" />
            Delete Permanently ({chosen.length})
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="Trash is empty" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((i) => (
            <article key={i.key} className="min-w-0 rounded-md border bg-card p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  aria-label={`Select ${i.title}`}
                  checked={selected.includes(i.key)}
                  onCheckedChange={(c) =>
                    setSelected((s) => (c ? [...s, i.key] : s.filter((k) => k !== i.key)))
                  }
                />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-medium">{i.title}</h3>
                  <p className="mt-1 text-xs text-gold">{i.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {who(i.owner_id)}
                    {i.deletedAt
                      ? ` · Deleted ${new Date(i.deletedAt).toLocaleString("en", { timeZone: "America/Bogota" })}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setConfirm({ op: "restore", items: [i] })}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restore
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setConfirm({ op: "purge", items: [i] })}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Permanently
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirm.op === "restore" ? "Restore" : "Permanently delete"} {confirm.items.length}{" "}
                item{confirm.items.length === 1 ? "" : "s"}?
              </DialogTitle>
              <DialogDescription>
                {confirm.op === "restore"
                  ? "Occurrences return to their date only. Series return with their schedule and portal visibility."
                  : "This cannot be undone. Series lose all their executions, history and comments."}{" "}
                Series: {confirm.items.filter((i) => i.kind === "series").length} · Occurrences:{" "}
                {confirm.items.filter((i) => i.kind === "occurrence").length}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm.op === "purge" ? "destructive" : "default"}
                disabled={run.isPending}
                onClick={() => run.mutate(confirm)}
              >
                {confirm.op === "restore" ? "Restore" : "Delete Permanently"} (
                {confirm.items.length})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function eventBody(action: string, body: string) {
  if (action !== "rescheduled") return body;
  try {
    const event = JSON.parse(body) as {
      from_date: string | null;
      from_time: string | null;
      to_date: string;
      to_time: string;
    };
    return `${event.from_date ?? "No Date"} ${event.from_time?.slice(0, 5) ?? "No Time"} → ${event.to_date} ${event.to_time.slice(0, 5)}`;
  } catch {
    return body;
  }
}
function ConfigurationDialog({
  task,
  people,
  creators,
  onClose,
}: {
  task: Task | null;
  people: { id: string; full_name: string | null; email: string | null; roles: string[] }[];
  creators: { id: string; stage_name: string; user_id: string | null }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [applyToday, setApplyToday] = useState(true);
  const [memberType, setMemberType] = useState("all");
  const [f, setF] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    owner_id: task?.owner_id ?? "",
    creator_id: task?.creator_id ?? "",
    priority: task?.priority ?? "medium",
    due_date: task?.due_date ?? agencyDate(),
    due_time: task?.due_time?.slice(0, 5) ?? "",
    recurrence: task?.recurrence ?? "once",
    weekdays: task?.weekdays.length ? task.weekdays : [1, 2, 3, 4, 5],
    recurrence_state: task?.recurrence_state ?? "enabled",
    visible_to_creator: task?.visible_to_creator ?? false,
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("save_task_configuration", {
        _task_id: task?.id ?? "00000000-0000-0000-0000-000000000000",
        _config: { ...f, apply_today: !!task && applyToday },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(task ? "Task updated" : "Task created");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const field = (name: "title" | "description" | "due_date" | "due_time", value: string) =>
    setF((current) => ({ ...current, [name]: value }));
  const ownerCreator = creators.find((c) => !!c.user_id && c.user_id === f.owner_id);
  const canPublish = !!ownerCreator && f.creator_id === ownerCreator.id;
  const setOwner = (id: string) => {
    const linked = creators.find((c) => !!c.user_id && c.user_id === id);
    setF((cur) => ({
      ...cur,
      owner_id: id,
      creator_id: linked ? linked.id : cur.creator_id,
      visible_to_creator: linked ? cur.visible_to_creator : false,
    }));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Task" : "New Task"}</DialogTitle>
          <DialogDescription>
            {task
              ? "Changes apply from tomorrow or the selected future date. Existing history stays unchanged."
              : "Task configuration"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              required
              maxLength={200}
              value={f.title}
              onChange={(e) => field("title", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-description">Description & Instructions</Label>
            <Textarea
              id="task-description"
              value={f.description}
              onChange={(e) => field("description", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Member Type</Label>
              <Filter
                label="Member Type"
                value={memberType}
                onChange={setMemberType}
                options={MEMBER_TYPES.map((value) => ({ value, label: titleCase(value) }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Owner</Label>
              <Filter
                label="Task Owner"
                value={f.owner_id || "none"}
                onChange={(v) => setOwner(v === "none" ? "" : v)}
                options={[
                  { value: "none", label: "Unassigned" },
                  ...people
                    .filter(
                      (p) =>
                        memberType === "all" ||
                        p.roles.includes(memberType) ||
                        p.id === f.owner_id,
                    )
                    .map((p) => ({
                      value: p.id,
                      label: p.full_name || p.email || "Member",
                    })),
                ]}
              />
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Filter
                label="Task priority"
                value={f.priority}
                onChange={(v) => setF({ ...f, priority: v as Task["priority"] })}
                options={["low", "medium", "high", "critical"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-date">{f.recurrence === "once" ? "Date" : "Start Date"}</Label>
              <Input
                id="task-date"
                type="date"
                required={f.recurrence !== "once"}
                value={f.due_date}
                onChange={(e) => field("due_date", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-time">Time</Label>
              <Input
                id="task-time"
                type="time"
                value={f.due_time}
                onChange={(e) => field("due_time", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Recurrence</Label>
              <Filter
                label="Recurrence"
                value={f.recurrence}
                onChange={(v) => setF({ ...f, recurrence: v })}
                options={[
                  { value: "once", label: "One-time" },
                  { value: "daily", label: "Every day" },
                  { value: "weekdays", label: "Selected weekdays" },
                ]}
              />
            </div>
            {f.recurrence !== "once" && (
              <div className="space-y-1">
                <Label>Recurrence State</Label>
                <Filter
                  label="Recurrence State"
                  value={f.recurrence_state}
                  onChange={(v) => setF({ ...f, recurrence_state: v })}
                  options={["enabled", "paused", "disabled"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </div>
            )}
          </div>
          {f.recurrence === "weekdays" && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Weekdays</legend>
              <div className="grid grid-cols-4 gap-2">
                {WEEKDAYS.map((day, index) => (
                  <label
                    key={day}
                    className="flex min-h-11 items-center gap-2 rounded-md border px-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={f.weekdays.includes(index)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          weekdays: e.target.checked
                            ? [...f.weekdays, index]
                            : f.weekdays.filter((d) => d !== index),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="space-y-1">
            <Label>Linked Creator</Label>
            <Filter
              label="Linked Creator"
              value={f.creator_id || "none"}
              disabled={!!ownerCreator}
              onChange={(v) =>
                setF({
                  ...f,
                  creator_id: v === "none" ? "" : v,
                  visible_to_creator: v === "none" ? false : f.visible_to_creator,
                })
              }
              options={[
                { value: "none", label: "No creator" },
                ...creators.map((c) => ({ value: c.id, label: c.stage_name })),
              ]}
            />
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id="creator-visible"
              disabled={!canPublish && !f.visible_to_creator}
              checked={f.visible_to_creator}
              onCheckedChange={(checked) => setF({ ...f, visible_to_creator: checked === true })}
            />
            <Label htmlFor="creator-visible">Visible In Creator's Portal</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {ownerCreator
              ? "The owner is a creator, so Linked Creator follows the owner. Publishing stays a separate choice."
              : "Only tasks owned by a creator can appear in that creator's portal. Linked Creator is just a reference here."}
          </p>
          {f.visible_to_creator && !canPublish && (
            <p className="text-sm text-warning">
              This task is published but its owner isn't the linked creator. Set the owner to the
              creator or turn off portal visibility before saving.
            </p>
          )}
          {task && f.recurrence_state === "enabled" && (
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="apply-today"
                checked={applyToday}
                onCheckedChange={(checked) => setApplyToday(checked === true)}
              />
              <Label htmlFor="apply-today">Also Update Today's Pending Execution</Label>
            </div>
          )}
          {save.error && <ErrorNote error={save.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || (f.recurrence === "weekdays" && !f.weekdays.length)}
            >
              {save.isPending ? "Saving…" : "Save Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  task,
  blocks,
  rows,
  pending,
  onClose,
  onSave,
}: {
  task: Execution;
  blocks: BoardBlock[];
  rows: Execution[];
  pending: boolean;
  onClose: () => void;
  onSave: (time: string, date: string) => void;
}) {
  const [time, setTime] = useState(task.due_time?.slice(0, 5) ?? "09:00");
  const [date, setDate] = useState(task.scheduled_date ?? agencyDate());
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Execution</DialogTitle>
          <DialogDescription>{task.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label>Move To Time Block</Label>
          <Filter
            label="Move To Time Block"
            value={blockForTime(time, blocks)?.id ?? blocks[0]?.id ?? ""}
            onChange={(id) => {
              const block = blocks.find((b) => b.id === id);
              if (block) {
                const next = timeInBlock(block, { ...task, scheduled_date: date }, rows);
                if (next) setTime(next);
                else toast.error("This block is full. Choose a time.");
              }
            }}
            options={blocks.map((b) => ({
              value: b.id,
              label: `${b.label} · ${formatTime12(b.start)}–${formatTime12(b.end)}`,
            }))}
          />
          <Label htmlFor="move-date">Date</Label>
          <Input
            id="move-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Label htmlFor="move-time">Exact Time</Label>
          <Input
            id="move-time"
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending || !date || !time} onClick={() => onSave(time, date)}>
              Save Schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimeBlocksDialog({ blocks, onClose }: { blocks: BoardBlock[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BoardBlock[]>(blocks.map((b) => ({ ...b })));
  const error = validateBlocks(draft);
  const save = useMutation({
    mutationFn: async (next: BoardBlock[]) => {
      const { data: existing, error: readError } = await supabase
        .from("task_time_blocks")
        .select("id");
      if (readError) throw readError;
      const rows = next.map((b, position) => ({
        label: b.label.trim(),
        start_time: b.start,
        end_time: b.end === "24:00" ? "00:00" : b.end,
        position,
      }));
      const { error: insertError } = await supabase.from("task_time_blocks").insert(rows);
      if (insertError) throw insertError;
      const old = (existing ?? []).map((r) => r.id);
      if (old.length) {
        const { error: deleteError } = await supabase
          .from("task_time_blocks")
          .delete()
          .in("id", old);
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", "time-blocks"] });
      toast.success("Time blocks saved; task times unchanged");
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const set = (i: number, patch: Partial<BoardBlock>) =>
    setDraft((d) => d.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Time Blocks</DialogTitle>
          <DialogDescription>
            Tasks group automatically by their time. Blocks may cross midnight but must not
            overlap. Task dates and times never change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {draft.map((b, i) => (
            <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_auto] gap-2">
              <Input
                aria-label="Block name"
                value={b.label}
                maxLength={40}
                onChange={(e) => set(i, { label: e.target.value })}
              />
              <Input
                aria-label={`${b.label} start`}
                type="time"
                value={b.start}
                onChange={(e) => set(i, { start: e.target.value })}
              />
              <Input
                aria-label={`${b.label} end`}
                type="time"
                value={b.end === "24:00" ? "00:00" : b.end}
                onChange={(e) => set(i, { end: e.target.value === "00:00" ? "24:00" : e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${b.label}`}
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setDraft((d) => [
                    ...d,
                    { id: `new-${Date.now()}`, label: "New Block", start: "12:00", end: "13:00" },
                  ])
                }
              >
                Add Block
              </Button>
              <Button variant="ghost" onClick={() => setDraft(BOARD_BLOCKS.map((b) => ({ ...b })))}>
                Reset Defaults
              </Button>
            </div>
            <Button disabled={!!error || !draft.length || save.isPending} onClick={() => save.mutate(draft)}>
              Save Blocks
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
