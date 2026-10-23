import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useMe } from "@/lib/me";
import { DEFAULT_AGENCY_SHARE_PCT, inRange, monthly, money, summarize } from "@/lib/finance";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill, Stat } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Kind = Database["public"]["Enums"]["txn_kind"];
type Transaction = {
  id: string;
  kind: Kind;
  amount: number;
  currency: string;
  occurred_on: string;
  category: string;
  description: string | null;
  creator_id: string | null;
  agency_share_pct: number | null;
  external_ref: string | null;
  shared_with_creator: boolean;
  archived_at: string | null;
  creators: { stage_name: string } | null;
};

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance — VenusX Portal" }] }),
  component: Finance,
});

function Finance() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [from, setFrom] = useState(new Date().getFullYear() + "-01-01");
  const [to, setTo] = useState("");
  const [creator, setCreator] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const txns = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, creators(stage_name)")
        .order("occurred_on", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as Transaction[];
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
  const archive = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { data, error } = await supabase
        .from("transactions")
        .update({ archived_at: on ? new Date().toISOString() : null })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Transaction was not found or update was not authorized.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const deleteTxn = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length)
        throw new Error("Transaction was not found or deletion was not authorized.");
    },
    onSuccess: () => {
      toast.success("Transaction deleted");
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = useMemo(
    () =>
      inRange(txns.data ?? [], from || undefined, to || undefined).filter(
        (t) => creator === "all" || t.creator_id === creator,
      ),
    [txns.data, from, to, creator],
  );
  const sums = summarize(filtered);
  const primary = sums[0]?.currency;
  const chart = primary
    ? monthly(
        filtered.filter((t) => !t.archived_at),
        primary,
      )
    : [];

  if (!me?.isExec)
    return <EmptyState title="Restricted" body="Finance is limited to executives." />;

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Every figure is computed from ledger entries below. Currencies are never combined."
        actions={<NewTxn creators={creators.data ?? []} />}
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Select value={creator} onValueChange={setCreator}>
          <SelectTrigger className="w-48">
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
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show voided
        </label>
      </div>

      {txns.isLoading ? (
        <Loading />
      ) : txns.error ? (
        <ErrorNote error={txns.error} retry={() => txns.refetch()} />
      ) : (
        <>
          {sums.length === 0 ? (
            <EmptyState
              title="No entries in this range"
              body="Record revenue, expenses or payouts to build your ledger."
            />
          ) : (
            sums.map((s) => (
              <div key={s.currency} className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
                <Stat label={`Revenue · ${s.currency}`} value={money(s.revenue, s.currency)} />
                <Stat label="Creator share" value={money(s.creatorRevenue, s.currency)} />
                <Stat label="Agency share" value={money(s.agencyRevenue, s.currency)} />
                <Stat
                  label="Expenses"
                  value={money(s.expenses, s.currency)}
                  hint={`Payouts recorded: ${money(s.payouts, s.currency)}`}
                />
                <Stat
                  label="Net profit"
                  value={<span className="text-gold">{money(s.netProfit, s.currency)}</span>}
                  hint={s.margin == null ? "—" : `${(s.margin * 100).toFixed(1)}% margin`}
                />
              </div>
            ))
          )}
          {chart.length > 0 && (
            <div className="mb-6 h-64 rounded-lg border bg-card p-4">
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  />
                  <Bar
                    dataKey="agencyRevenue"
                    name={`Agency revenue (${primary})`}
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenses"
                    fill="var(--chart-4)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Creator</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">Agency %</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered
                  .filter((t) => showArchived || !t.archived_at)
                  .map((t) => (
                    <tr key={t.id} className={t.archived_at ? "opacity-50 line-through" : ""}>
                      <td className="p-3">{t.occurred_on}</td>
                      <td className="p-3">
                        <Pill value={t.kind} />
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {t.category}
                        {t.description ? ` · ${t.description}` : ""}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {t.creators?.stage_name ?? "Agency"}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {money(Number(t.amount), t.currency)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {t.kind === "revenue" ? `${t.agency_share_pct ?? 100}%` : "—"}
                      </td>
                      <td className="p-3 text-right">
                        {!t.archived_at && (
                          <Button
                            aria-label={`Edit ${t.category}`}
                            title="Edit transaction"
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditing(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          aria-label={
                            t.archived_at ? `Restore ${t.category}` : `Void ${t.category}`
                          }
                          title={t.archived_at ? "Restore transaction" : "Void transaction"}
                          variant="ghost"
                          size="icon"
                          disabled={archive.isPending}
                          onClick={() => {
                            const action = t.archived_at ? "Restore" : "Void";
                            if (confirm(`${action} ${t.category}?`))
                              archive.mutate({ id: t.id, on: !t.archived_at });
                          }}
                        >
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={`Permanently delete ${t.category}`}
                          title="Permanently delete transaction"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          disabled={deleteTxn.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Permanently delete ${t.category}? This cannot be undone. An audit event will remain.`,
                              )
                            )
                              deleteTxn.mutate(t.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && (
        <NewTxn
          key={editing.id}
          creators={creators.data ?? []}
          transaction={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function NewTxn({
  creators,
  transaction,
  onClose,
}: {
  creators: { id: string; stage_name: string }[];
  transaction?: Transaction | null;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!!transaction);
  const makeInitialForm = () => ({
    kind: transaction?.kind ?? "none",
    amount: transaction ? String(transaction.amount) : "",
    currency: transaction?.currency ?? "none",
    occurred_on: transaction?.occurred_on ?? localDateString(),
    category: transaction?.category ?? "",
    description: transaction?.description ?? "",
    creator_id: transaction?.creator_id ?? "none",
    agency_share_pct:
      transaction?.agency_share_pct == null ? "" : String(transaction.agency_share_pct),
    external_ref: transaction?.external_ref ?? "",
    shared_with_creator: transaction?.shared_with_creator ?? false,
  });
  const [f, setF] = useState(makeInitialForm);
  const [agencyShareEdited, setAgencyShareEdited] = useState(transaction?.agency_share_pct != null);
  const m = useMutation({
    mutationFn: async () => {
      const amt = Number(f.amount);
      if (!Number.isFinite(amt) || !(amt > 0))
        throw new Error("Amount must be a finite number greater than 0");
      if (!isCurrencyCode(f.currency)) throw new Error("Select USD, EUR, or COP.");
      const pct = f.agency_share_pct === "" ? null : Number(f.agency_share_pct);
      if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100))
        throw new Error("Agency % must be a number from 0 to 100");
      if (f.kind === "none") throw new Error("Select a transaction type");
      if (f.kind === "revenue" && pct == null)
        throw new Error("Enter the agency share percentage for this revenue.");
      if (!f.category.trim()) throw new Error("Enter a category.");
      const payload = {
        kind: f.kind as Kind,
        amount: amt,
        currency: f.currency,
        occurred_on: f.occurred_on,
        category: f.category.trim(),
        description: f.description || null,
        creator_id: f.creator_id === "none" ? null : f.creator_id,
        agency_share_pct: f.kind === "revenue" ? pct : null,
        external_ref: f.external_ref.trim() || null,
        shared_with_creator: f.shared_with_creator,
      };
      const { data, error } = transaction
        ? await supabase.from("transactions").update(payload).eq("id", transaction.id).select("id")
        : await supabase.from("transactions").insert(payload).select("id");
      if (error)
        throw error.message.includes("external_ref")
          ? new Error("An entry with this reference already exists (duplicate import prevented).")
          : error;
      if (!data?.length)
        throw new Error("Transaction was not found or this change was not authorized.");
    },
    onSuccess: () => {
      toast.success(transaction ? "Entry updated" : "Entry recorded");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setOpen(false);
      onClose?.();
      if (!transaction) {
        setF(makeInitialForm());
        setAgencyShareEdited(false);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClose?.();
      }}
    >
      {!transaction && (
        <DialogTrigger asChild>
          <Button>New entry</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{transaction ? "Edit ledger entry" : "New ledger entry"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={f.kind}
              onValueChange={(value) =>
                setF((current) => ({
                  ...current,
                  kind: value as Kind | "none",
                  agency_share_pct:
                    value === "revenue"
                      ? agencyShareEdited
                        ? current.agency_share_pct
                        : current.agency_share_pct || String(DEFAULT_AGENCY_SHARE_PCT)
                      : current.agency_share_pct,
                }))
              }
            >
              <SelectTrigger className="capitalize">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select type</SelectItem>
                {(["revenue", "expense", "payout"] as Kind[]).map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Date</Label>
            <Input
              type="date"
              required
              value={f.occurred_on}
              onChange={(e) => setF({ ...f, occurred_on: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select currency</SelectItem>
                <SelectItem value="USD">USD — US Dollar</SelectItem>
                <SelectItem value="EUR">EUR — Euro</SelectItem>
                <SelectItem value="COP">COP — Colombian Peso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Input
              placeholder="Enter a category"
              required
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Creator</Label>
            <Select value={f.creator_id} onValueChange={(v) => setF({ ...f, creator_id: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No creator attribution</SelectItem>
                {creators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.stage_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {f.kind === "revenue" && (
            <div className="space-y-1">
              <Label>Agency share %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                required
                placeholder={String(DEFAULT_AGENCY_SHARE_PCT)}
                value={f.agency_share_pct}
                onChange={(e) => {
                  setAgencyShareEdited(true);
                  setF({ ...f, agency_share_pct: e.target.value });
                }}
              />
              <p className="text-xs text-muted-foreground">
                {f.amount && f.currency !== "none" && f.agency_share_pct ? (
                  <>
                    Agency:{" "}
                    {money((Number(f.amount) * Number(f.agency_share_pct)) / 100, f.currency)}
                    {" · Creator: "}
                    {money(
                      Number(f.amount) - (Number(f.amount) * Number(f.agency_share_pct)) / 100,
                      f.currency,
                    )}
                  </>
                ) : (
                  "Enter an amount to preview the revenue split."
                )}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label>External reference</Label>
            <Input
              placeholder="Prevents duplicates"
              value={f.external_ref}
              onChange={(e) => setF({ ...f, external_ref: e.target.value })}
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Description</Label>
            <Input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          {f.creator_id !== "none" && (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Switch
                checked={f.shared_with_creator}
                onCheckedChange={(v) => setF({ ...f, shared_with_creator: v })}
              />
              Visible to this creator
            </label>
          )}
          <Button className="col-span-2" disabled={m.isPending}>
            {transaction ? "Save changes" : "Record"}
          </Button>
        </form>
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

function isCurrencyCode(value: string): value is "USD" | "EUR" | "COP" {
  return value === "USD" || value === "EUR" || value === "COP";
}
