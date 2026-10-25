import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Repeat2, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useMe } from "@/lib/me";
import {
  agencyDate,
  shiftDate,
  executionOverdue,
  canExecute,
  type Execution,
} from "@/lib/task-executions";
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
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
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
  const history = useQuery({
    queryKey: ["tasks", "history", me?.id],
    enabled: !!me && view === "history",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_executions")
        .select("*")
        .order("scheduled_date", { ascending: false });
      if (error) throw error;
      return data as Execution[];
    },
  });
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
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .is("membership_removed_at", null)
        .is("access_revoked_at", null);
      if (error) throw error;
      return data;
    },
  });
  const creators = useQuery({
    queryKey: ["tasks", "creators"],
    enabled: !!me?.isExec,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators")
        .select("id,stage_name")
        .is("archived_at", null);
      if (error) throw error;
      return data;
    },
  });
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
      const { error } = await supabase.rpc("task_execution_action", {
        _id: task.id,
        _action: action,
        ... (body === undefined ? {} : { _body: body }),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["execution-events"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const rows = (view === "history" ? (history.data ?? []) : (agenda.data ?? []))
    .filter(
      (t) =>
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
  const active = rows.filter((t) => !["done", "skipped", "cancelled"].includes(t.status));
  const overdue = active.filter((t) => executionOverdue(t, now));
  const todayRows = active.filter((t) => t.scheduled_date === date && !executionOverdue(t, now));
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
    const allowed = !!me && canExecute(t, me.id, me.isExec);
    const overdueState = executionOverdue(t, now);
    return (
      <article key={t.id} className="min-w-0 rounded-lg border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <p
              className={`mb-2 flex items-center gap-2 text-sm font-medium ${overdueState ? "text-destructive" : "text-gold"}`}
            >
              <Clock className="h-4 w-4 shrink-0" />
              {t.due_time?.slice(0, 5) || "No time"}
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
            label={overdueState ? "Overdue" : t.status === "todo" ? "Pending" : undefined}
          />
        </div>
        {t.skip_state === "pending" && (
          <p className="mt-3 text-sm text-warning">
            Skip requested{t.skip_reason ? ` · ${t.skip_reason}` : ""}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button variant="outline" className="min-h-11" onClick={() => setDetails(t)}>
            View details
          </Button>
          {!["cancelled", "skipped"].includes(t.status) && (
            <Button
              className="min-h-11"
              variant={t.status === "done" ? "outline" : "default"}
              disabled={
                !allowed ||
                action.isPending ||
                (!!t.scheduled_date && t.scheduled_date > agencyDate(now))
              }
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
      history.data?.find((t) => t.id === details.id) ??
      details)
    : null;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Tasks"
        subtitle="America/Bogota · UTC−5"
        actions={
          me?.isExec && (
            <Button className="min-h-11" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              New task
            </Button>
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
          <TabsTrigger className="min-h-11" value="list">
            List
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="board">
            Board
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="history">
            History
          </TabsTrigger>
          {me?.isExec && (
            <TabsTrigger className="min-h-11" value="manage">
              Manage
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
      {agenda.error ? (
        <ErrorNote error={agenda.error} retry={() => agenda.refetch()} />
      ) : agenda.isLoading ? (
        <Loading />
      ) : view === "manage" && me?.isExec ? (
        <div className="space-y-3">
          {configurations.error && <ErrorNote error={configurations.error} />}
          {(configurations.data ?? [])
            .filter(
              (t) =>
                t.title.toLowerCase().includes(search.toLowerCase()) &&
                (owner === "all" || t.owner_id === owner) &&
                (creator === "all" || t.creator_id === creator) &&
                (priority === "all" || t.priority === priority),
            )
            .map((t) => (
              <article
                key={t.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-card p-4"
              >
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{t.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {who(t.owner_id)} ·{" "}
                    {t.recurrence === "once"
                      ? "One-time"
                      : t.recurrence === "daily"
                        ? "Every day"
                        : t.weekdays.map((d) => WEEKDAYS[d]).join(", ")}{" "}
                    · {t.recurrence_state}
                  </p>
                </div>
                <Button variant="outline" className="min-h-11" onClick={() => setEditing(t)}>
                  Edit
                </Button>
              </article>
            ))}
        </div>
      ) : view === "history" ? (
        <div className="space-y-4">
          {history.error && <ErrorNote error={history.error} />}
          {history.isLoading ? (
            <Loading />
          ) : rows.length ? (
            [...rows].reverse().map(renderCard)
          ) : (
            <EmptyState title="No history matches" />
          )}
        </div>
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
          {overdue.length > 0 && section("Overdue · original dates", overdue)}
          {section(
            "Scheduled",
            todayRows.filter((t) => t.due_time),
          )}
          {section(
            "No time",
            todayRows.filter((t) => !t.due_time),
          )}
          {active.some((t) => !t.scheduled_date) &&
            section(
              "No date",
              active.filter((t) => !t.scheduled_date),
            )}
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Completed & cancelled · {completed.length}
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">{completed.map(renderCard)}</div>
          </details>
        </div>
      )}
      {currentDetails && (
        <ExecutionDetails
          task={currentDetails}
          executive={!!me?.isExec}
          allowed={!!me && canExecute(currentDetails, me.id, me.isExec)}
          pending={action.isPending}
          onClose={() => setDetails(null)}
          onAction={(act, body) => action.mutate({ task: currentDetails, action: act, body })}
        />
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-11 min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
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
            {task.scheduled_date || "No date"} · {task.due_time?.slice(0, 5) || "No time"} ·
            America/Bogota
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 font-medium">Description & instructions</h3>
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
            <h3 className="mb-3 font-medium">Comments & history</h3>
            {events.error && <ErrorNote error={events.error} />}
            <ol className="space-y-3">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="border-l-2 border-gold-soft pl-3">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {e.action === "comment" ? e.body : e.action.replaceAll("_", " ")}
                    {e.action !== "comment" && e.body ? ` · ${e.body}` : ""}
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
                <Label htmlFor="execution-comment">Add comment</Label>
                <Textarea
                  id="execution-comment"
                  maxLength={4000}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button disabled={pending || !comment.trim()}>Post comment</Button>
              </form>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function ConfigurationDialog({
  task,
  people,
  creators,
  onClose,
}: {
  task: Task | null;
  people: { id: string; full_name: string | null; email: string | null }[];
  creators: { id: string; stage_name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    owner_id: task?.owner_id ?? "",
    creator_id: task?.creator_id ?? "",
    priority: task?.priority ?? "medium",
    due_date: task?.due_date ?? agencyDate(),
    due_time: task?.due_time?.slice(0, 5) ?? "",
    recurrence: task?.recurrence ?? "once",
    weekdays: task?.weekdays ?? [1, 2, 3, 4, 5],
    recurrence_state: task?.recurrence_state ?? "enabled",
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("save_task_configuration", {
        _task_id: task?.id ?? "00000000-0000-0000-0000-000000000000",
        _config: f,
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
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
            <Label htmlFor="task-description">Description & instructions</Label>
            <Textarea
              id="task-description"
              value={f.description}
              onChange={(e) => field("description", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Owner</Label>
              <Filter
                label="Task owner"
                value={f.owner_id || "none"}
                onChange={(v) => setF({ ...f, owner_id: v === "none" ? "" : v })}
                options={[
                  { value: "none", label: "Unassigned" },
                  ...people.map((p) => ({
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
              <Label htmlFor="task-date">{f.recurrence === "once" ? "Date" : "Start date"}</Label>
              <Input
                id="task-date"
                type="date"
                required={f.recurrence !== "once"}
                value={f.due_date}
                onChange={(e) => field("due_date", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-time">Time (optional)</Label>
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
                <Label>Recurrence state</Label>
                <Filter
                  label="Recurrence state"
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
            <Label>Linked creator (optional)</Label>
            <Filter
              label="Linked creator"
              value={f.creator_id || "none"}
              onChange={(v) => setF({ ...f, creator_id: v === "none" ? "" : v })}
              options={[
                { value: "none", label: "No creator" },
                ...creators.map((c) => ({ value: c.id, label: c.stage_name })),
              ]}
            />
          </div>
          {save.error && <ErrorNote error={save.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || (f.recurrence === "weekdays" && !f.weekdays.length)}
            >
              {save.isPending ? "Saving…" : "Save task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
