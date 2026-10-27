import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OM_SOURCE, externalRef, toLedgerRow, windows, type OmTxn } from "./onlymonster";

const BASE = "https://omapi.onlymonster.ai";
const INITIAL_DAYS = 90;
const OVERLAP_DAYS = 3;

function token() {
  const t = process.env["ONLYMONSTER_API_KEY"];
  if (!t) throw new Error("OnlyMonster API key is not configured on the server.");
  return t;
}

async function omGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "x-om-auth-token": token(), accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      detail = [j.code, j.message, j.details?.required_permission].filter(Boolean).join(" · ");
    } catch {
      /* keep raw */
    }
    lastErr = `OnlyMonster ${res.status}: ${detail || res.statusText}`;
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw new Error(lastErr);
}

export async function fetchOmAccounts() {
  const all: { id: number; platform: string; platform_account_id: string; name: string; username: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await omGet<{ accounts: typeof all; nextCursor?: string }>("/api/v0/accounts", {
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    all.push(...r.accounts);
    cursor = r.nextCursor;
  } while (cursor);
  return all;
}

async function fetchPaged<T>(path: string, start: string, end: string) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const r = await omGet<{ items: T[]; cursor?: string }>(path, {
      start,
      end,
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    items.push(...r.items);
    cursor = r.cursor;
  } while (cursor);
  return items;
}

/** Refresh the account list (never changes existing creator mappings). */
export async function refreshAccounts() {
  const accounts = await fetchOmAccounts();
  if (accounts.length) {
    const { error } = await supabaseAdmin.from("onlymonster_accounts").upsert(
      accounts.map((a) => ({
        id: String(a.id),
        platform: a.platform,
        platform_account_id: String(a.platform_account_id),
        name: a.name,
        username: a.username,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (error) throw new Error(error.message);
  }
  return accounts.length;
}

export async function runSync(trigger: "manual" | "schedule", actorId: string | null) {
  const { data: run } = await supabaseAdmin
    .from("integration_sync_runs")
    .insert({ provider: OM_SOURCE, trigger, actor_id: actorId })
    .select("id")
    .single();
  const stats = { fetched: 0, inserted: 0, updated: 0, voided: 0 };
  try {
    await refreshAccounts();
    const { data: accs, error } = await supabaseAdmin
      .from("onlymonster_accounts")
      .select("*")
      .not("creator_id", "is", null)
      .not("agency_share_pct", "is", null);
    if (error) throw new Error(error.message);
    const now = new Date();
    for (const a of accs ?? []) {
      const acc = {
        platform: a.platform,
        platform_account_id: a.platform_account_id,
        creator_id: a.creator_id!,
        agency_share_pct: Number(a.agency_share_pct),
        currency: a.currency.trim(),
      };
      const start = a.last_synced_at
        ? new Date(new Date(a.last_synced_at).getTime() - OVERLAP_DAYS * 86400_000)
        : new Date(now.getTime() - INITIAL_DAYS * 86400_000);
      const base = `/api/v0/platforms/${a.platform}/accounts/${a.platform_account_id}`;
      const txns: OmTxn[] = [];
      const cbIds = new Set<string>();
      for (const [s, e] of windows(start, now)) {
        txns.push(...(await fetchPaged<OmTxn>(`${base}/transactions`, s, e)));
        for (const c of await fetchPaged<{ id: string }>(`${base}/chargebacks`, s, e)) cbIds.add(c.id);
      }
      stats.fetched += txns.length;
      const rows = new Map(txns.map((t) => [t.id, toLedgerRow(t, acc, cbIds.has(t.id))]));

      // Existing imported rows for these refs (chunked IN filter).
      const refs = [...rows.values()].map((r) => r.external_ref);
      const existing = new Map<string, { id: string; amount: number; external_status: string | null; archived_at: string | null }>();
      for (let i = 0; i < refs.length; i += 150) {
        const { data, error: e } = await supabaseAdmin
          .from("transactions")
          .select("id,external_ref,amount,external_status,archived_at")
          .eq("source", OM_SOURCE)
          .in("external_ref", refs.slice(i, i + 150));
        if (e) throw new Error(e.message);
        for (const r of data ?? []) existing.set(r.external_ref!, r as never);
      }
      const inserts = [];
      for (const row of rows.values()) {
        const ex = existing.get(row.external_ref);
        if (!ex) {
          inserts.push(row);
          if (row.archived_at) stats.voided++;
          continue;
        }
        const wasVoid = !!ex.archived_at;
        const isVoid = !!row.archived_at;
        if (Number(ex.amount) === row.amount && ex.external_status === row.external_status && wasVoid === isVoid) continue;
        const { error: ue } = await supabaseAdmin
          .from("transactions")
          .update({
            amount: row.amount,
            external_status: row.external_status,
            archived_at: isVoid ? (ex.archived_at ?? row.archived_at) : null,
          })
          .eq("id", ex.id);
        if (ue) throw new Error(ue.message);
        stats.updated++;
        if (isVoid && !wasVoid) stats.voided++;
      }
      // Chargebacks whose original transaction is outside this window but already imported.
      const orphanRefs = [...cbIds].filter((id) => !rows.has(id)).map((id) => externalRef(acc.platform, acc.platform_account_id, id));
      if (orphanRefs.length) {
        const { data: v, error: ve } = await supabaseAdmin
          .from("transactions")
          .update({ external_status: "chargeback", archived_at: now.toISOString() })
          .eq("source", OM_SOURCE)
          .is("archived_at", null)
          .in("external_ref", orphanRefs)
          .select("id");
        if (ve) throw new Error(ve.message);
        stats.voided += v?.length ?? 0;
        stats.updated += v?.length ?? 0;
      }
      for (let i = 0; i < inserts.length; i += 500) {
        const { error: ie } = await supabaseAdmin.from("transactions").insert(inserts.slice(i, i + 500));
        if (ie) throw new Error(ie.message);
      }
      stats.inserted += inserts.length;
      await supabaseAdmin.from("onlymonster_accounts").update({ last_synced_at: now.toISOString() }).eq("id", a.id);
    }
    if (run) await supabaseAdmin.from("integration_sync_runs").update({ ...stats, ok: true, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: true as const, ...stats };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    console.error("[onlymonster sync]", msg);
    if (run) await supabaseAdmin.from("integration_sync_runs").update({ ...stats, ok: false, error: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: false as const, error: msg, ...stats };
  }
}
