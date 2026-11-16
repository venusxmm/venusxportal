import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { computeReminders, reminderText } from "@/lib/push-reminders";

const LOOKBACK = 6 * 3600_000; // missed reminders older than this are skipped silently

export const Route = createFileRoute("/api/public/jobs/push-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPush } = await import("@/lib/push-send.server");
        const { data: rows, error } = await supabaseAdmin.rpc("push_reminder_candidates");
        if (error) return Response.json({ error: error.message }, { status: 500 });
        const now = Date.now();
        let pushed = 0;
        const subsCache = new Map<string, { id: string; endpoint: string; p256dh: string; auth: string }[]>();
        for (const r of rows ?? []) {
          const deadline = new Date(r.deadline);
          const due = computeReminders(new Date(r.assigned_at), deadline, r.quiet_start, r.quiet_end).filter(
            (x) => x.at.getTime() <= now,
          );
          if (!due.length) continue;
          const latest = due[due.length - 1];
          const keyFor = (n: number) => `push:${r.user_id}:${r.execution_id}:${deadline.toISOString()}:${n}`;
          // Earlier reminders that were missed are recorded silently so they never fire late.
          const silent = due.slice(0, -1).map((x) => ({
            user_id: r.user_id, title: reminderText(x.n, r.title, deadline).title, body: r.title,
            link: `/portal#task-${r.execution_id}`, dedupe_key: keyFor(x.n), read_at: new Date().toISOString(),
          }));
          if (silent.length) await supabaseAdmin.from("notifications").upsert(silent, { onConflict: "dedupe_key", ignoreDuplicates: true });
          if (now - latest.at.getTime() > LOOKBACK) continue;
          const text = reminderText(latest.n, r.title, deadline);
          const link = `/portal#task-${r.execution_id}`;
          const { data: ins } = await supabaseAdmin
            .from("notifications")
            .upsert([{ user_id: r.user_id, title: text.title, body: text.body, link, dedupe_key: keyFor(latest.n) }], { onConflict: "dedupe_key", ignoreDuplicates: true })
            .select("id");
          if (!ins?.length) continue; // already sent
          if (!subsCache.has(r.user_id)) {
            const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", r.user_id);
            subsCache.set(r.user_id, subs ?? []);
          }
          for (const s of subsCache.get(r.user_id) ?? []) {
            const res = await sendPush(s, { ...text, url: link, tag: `${r.execution_id}`.slice(0, 32) }).catch(() => "error" as const);
            if (res === "gone") await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
            if (res === "ok") { pushed++; await supabaseAdmin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id); }
          }
        }
        return Response.json({ candidates: rows?.length ?? 0, pushed });
      },
    },
  },
});
