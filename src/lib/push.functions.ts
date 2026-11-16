import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVapidPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ key: process.env["VAPID_PUBLIC_KEY"] ?? "" }));

/** Sends a test push to the caller's own devices only (RLS-scoped read). */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendPush } = await import("./push-send.server");
    const { data, error } = await context.supabase
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    let sent = 0;
    for (const s of data ?? []) {
      const r = await sendPush(s, {
        title: "🌟 ¡Notificaciones activadas!",
        body: "Así te avisaremos de tus tareas en VenusX.",
        url: "/portal",
        tag: "test",
      });
      if (r === "ok") sent++;
      if (r === "gone") await context.supabase.from("push_subscriptions").delete().eq("id", s.id);
    }
    return { sent };
  });
