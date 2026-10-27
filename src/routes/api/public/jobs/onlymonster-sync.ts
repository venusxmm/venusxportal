import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/onlymonster-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { runSync } = await import("@/lib/onlymonster.server");
        const r = await runSync("schedule", null);
        // Counts only; no financial or personal data in the response.
        return Response.json(
          { ok: r.ok, inserted: r.inserted, updated: r.updated, voided: r.voided },
          { status: r.ok ? 200 : 502 },
        );
      },
    },
  },
});
