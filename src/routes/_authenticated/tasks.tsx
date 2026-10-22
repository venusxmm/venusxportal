import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useMe } from "@/lib/me";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill, isOverdue } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TaskStatus = Database["public"]["Enums"]["task_status"];
type Priority = Database["public"]["Enums"]["task_priority"];
const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "review", "done"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks — VenusX Portal" }] }),
  component: Tasks,
});

type Task = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: Priority;
  due_date: string | null; creator_id: string | null; owner_id: string | null; visible_to_creator: boolean;
  source: string; archived_at: string | null; creators: { stage_name: string } | null;
};

function Tasks() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [view, setView] = useState("list");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("open");
  const [fCreator, setFCreator] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [editing, setEditing] = useState<Task | "new" | null>(null);

  const tasks = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,description,status,priority,due_date,creator_id,owner_id,visible_to_creator,source,archived_at,creators(stage_name)")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data as Task[];
    },
  });
  const creators = useQuery({
    queryKey: ["creators", "options"],
    queryFn: async () => (await supabase.from("creators").select("id,stage_name").is("archived_at", null).order("stage_name")).data ?? [],
  });
  const people = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name,email").order("full_name")).data ?? [],
  });
  const who = (id: string | null) => { const p = people.data?.find((x) => x.id === id); return p ? p.full_name || p.email : "Unassigned"; };

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const rows = useMemo(() => (tasks.data ?? []).filter((t) => {
    if (fStatus === "archived") { if (!t.archived_at) return false; }
    else if (t.archived_at) return false;
    if (fStatus === "open" && t.status === "done") return false;
    if (fStatus === "overdue" && !isOverdue(t.due_date, t.status)) return false;
    if (STATUSES.includes(fStatus as TaskStatus) && t.status !== fStatus) return false;
    if (fCreator !== "all" && t.creator_id !== fCreator) return false;
    if (mineOnly && t.owner_id !== me?.id) return false;
    return t.title.toLowerCase().includes(q.toLowerCase());
  }), [tasks.data, fStatus, fCreator, mineOnly, q, me?.id]);

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Agency-wide work, filtered to what you're allowed to see." actions={<Button onClick={() => setEditing("new")}>New task</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fCreator} onValueChange={setFCreator}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All creators</SelectItem>
            {(creators.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.stage_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={mineOnly} onCheckedChange={setMineOnly} />Mine</label>
        <Tabs value={view} onValueChange={setView} className="ml-auto">
          <TabsList><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="board">Board</TabsTrigger><TabsTrigger value="calendar">By date</TabsTrigger></TabsList>
        </Tabs>
      </div>

      {tasks.isLoading ? <Loading /> : tasks.error ? <ErrorNote error={tasks.error} retry={() => tasks.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="No tasks match" body="Adjust filters or create a task." />
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted-foreground">
              <tr><th className="p-3">Task</th><th className="p-3">Creator</th><th className="p-3">Owner</th><th className="p-3">Priority</th><th className="p-3">Status</th><th className="p-3">Due</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-accent">
                  <td className="p-3"><button className="text-left hover:text-gold" onClick={() => setEditing(t)}>{t.title}</button>{t.source !== "manual" && <span className="ml-2 text-xs text-muted-foreground">auto</span>}</td>
                  <td className="p-3 text-muted-foreground">{t.creators?.stage_name ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{who(t.owner_id)}</td>
                  <td className="p-3"><Pill value={t.priority} /></td>
                  <td className="p-3">
                    <Select value={t.status} onValueChange={(v) => setStatus.mutate({ id: t.id, status: v as TaskStatus })}>
                      <SelectTrigger className="h-8 w-32 capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className={"p-3 " + (isOverdue(t.due_date, t.status) ? "text-destructive" : "text-muted-foreground")}>{t.due_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === "board" ? (
        <div className="grid gap-4 overflow-x-auto md:grid-cols-5">
          {STATUSES.map((s) => (
            <div key={s} className="min-w-56 rounded-lg border bg-card/60 p-3">
              <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">{s.replace("_", " ")} · {rows.filter((t) => t.status === s).length}</p>
              <div className="space-y-2">
                {rows.filter((t) => t.status === s).map((t) => (
                  <button key={t.id} onClick={() => setEditing(t)} className="block w-full rounded-md border bg-card p-3 text-left text-sm hover:border-gold/50">
                    <p>{t.title}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <Pill value={t.priority} /><span className={isOverdue(t.due_date, t.status) ? "text-destructive" : ""}>{t.due_date ?? ""}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ByDate rows={rows} onOpen={setEditing} />
      )}
      {editing && <TaskDialog task={editing === "new" ? null : editing} onClose={() => setEditing(null)} creators={creators.data ?? []} people={people.data ?? []} meId={me?.id} />}
    </div>
  );
}

function ByDate({ rows, onOpen }: { rows: Task[]; onOpen: (t: Task) => void }) {
  const groups = new Map<string, Task[]>();
  for (const t of rows) { const k = t.due_date ?? "No date"; groups.set(k, [...(groups.get(k) ?? []), t]); }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([d, ts]) => (
        <div key={d}>
          <p className="mb-2 text-sm font-medium text-gold">{d === "No date" ? d : new Date(d + "T00:00").toDateString()}</p>
          <div className="divide-y rounded-lg border bg-card">
            {ts.map((t) => <button key={t.id} onClick={() => onOpen(t)} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"><span>{t.title}</span><Pill value={t.status} /></button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskDialog({ task, onClose, creators, people, meId }: {
  task: Task | null; onClose: () => void; meId?: string | undefined;
  creators: { id: string; stage_name: string }[]; people: { id: string; full_name: string | null; email: string | null }[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: task?.title ?? "", description: task?.description ?? "", priority: task?.priority ?? ("medium" as Priority),
    status: task?.status ?? ("todo" as TaskStatus), due_date: task?.due_date ?? "", creator_id: task?.creator_id ?? "none",
    owner_id: task?.owner_id ?? meId ?? "none", visible_to_creator: task?.visible_to_creator ?? false,
  });
  const payload = () => ({
    title: f.title.trim(), description: f.description || null, priority: f.priority, status: f.status,
    due_date: f.due_date || null, creator_id: f.creator_id === "none" ? null : f.creator_id,
    owner_id: f.owner_id === "none" ? null : f.owner_id, visible_to_creator: f.visible_to_creator,
  });
  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); };
  const err = (e: unknown) => toast.error((e as Error).message);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = task
        ? await supabase.from("tasks").update(payload()).eq("id", task.id)
        : await supabase.from("tasks").insert({ ...payload(), created_by: meId ?? null });
      if (error) throw error;
    },
    onSuccess: () => done(task ? "Task updated" : "Task created"), onError: err,
  });
  const archive = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("tasks").update({ archived_at: task!.archived_at ? null : new Date().toISOString() }).eq("id", task!.id); if (error) throw error; },
    onSuccess: () => done(task?.archived_at ? "Restored" : "Archived"), onError: err,
  });
  const del = useMutation({
    mutationFn: async () => { const { error, count } = await supabase.from("tasks").delete({ count: "exact" }).eq("id", task!.id); if (error) throw error; if (!count) throw new Error("Only executives or the task creator can delete."); },
    onSuccess: () => done("Deleted"), onError: err,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1"><Label>Title</Label><Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Priority</Label>
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v as Priority })}><SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as TaskStatus })}><SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Due date</Label><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Owner</Label>
              <Select value={f.owner_id} onValueChange={(v) => setF({ ...f, owner_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Unassigned</SelectItem>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label>Creator</Label>
            <Select value={f.creator_id} onValueChange={(v) => setF({ ...f, creator_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{creators.map((c) => <SelectItem key={c.id} value={c.id}>{c.stage_name}</SelectItem>)}</SelectContent></Select></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.visible_to_creator} onCheckedChange={(v) => setF({ ...f, visible_to_creator: v })} />Show in creator's portal</label>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={save.isPending}>{task ? "Save" : "Create"}</Button>
            {task && <Button type="button" variant="outline" onClick={() => archive.mutate()}>{task.archived_at ? "Restore" : "Archive"}</Button>}
            {task && <Button type="button" variant="ghost" className="text-destructive" onClick={() => confirm("Delete this task permanently?") && del.mutate()}>Delete</Button>}
          </div>
        </form>
        {task && <Comments taskId={task.id} />}
      </DialogContent>
    </Dialog>
  );
}

function Comments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const list = useQuery({
    queryKey: ["comments", taskId],
    queryFn: async () => (await supabase.from("task_comments").select("id,body,created_at,author_id").eq("task_id", taskId).order("created_at")).data ?? [],
  });
  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body: body.trim(), author_id: u.user!.id });
      if (error) throw error;
    },
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["comments", taskId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-sm font-medium">Comments</p>
      <div className="space-y-2">
        {(list.data ?? []).map((c) => <div key={c.id} className="rounded-md bg-muted p-2 text-sm"><p>{c.body}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</p></div>)}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" maxLength={4000} />
        <Button size="sm" disabled={add.isPending}>Post</Button>
      </form>
    </div>
  );
}
