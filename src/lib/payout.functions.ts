import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const postCreatorPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    id: z.string().uuid(), creator_id: z.string().uuid(), amount: z.number().positive(),
    currency: z.enum(["USD", "EUR", "COP"]), occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z.string().trim().min(1), description: z.string().nullable(),
    external_ref: z.string().nullable(), shared_with_creator: z.boolean(),
  }))
  .handler(async ({ data, context }) => {
    // A narrow untyped RPC boundary is temporary until the reviewed SQL is applied and types regenerate.
    const { data: id, error } = await context.supabase.rpc("post_creator_payout" as never, {
      _id: data.id, _creator_id: data.creator_id, _amount: data.amount,
      _currency: data.currency, _occurred_on: data.occurred_on, _category: data.category,
      _description: data.description, _external_ref: data.external_ref,
      _shared_with_creator: data.shared_with_creator,
    } as never);
    if (error) {
      if (error.code === "PGRST202") throw new Error("Payout posting is unavailable until financial safeguards are applied. No payout was saved.");
      throw new Error(error.message);
    }
    return id;
  });