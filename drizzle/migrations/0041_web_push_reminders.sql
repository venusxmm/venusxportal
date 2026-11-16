CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subs" ON public.push_subscriptions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  enabled boolean NOT NULL DEFAULT true,
  paused_until timestamptz,
  quiet_start smallint NOT NULL DEFAULT 21,
  quiet_end smallint NOT NULL DEFAULT 8,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prefs" ON public.notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.push_reminder_candidates()
RETURNS TABLE(execution_id uuid, user_id uuid, title text, assigned_at timestamptz, deadline timestamptz, quiet_start smallint, quiet_end smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.materialize_task_executions();
  RETURN QUERY
  SELECT e.id, e.owner_id, e.title, e.created_at,
    ((e.scheduled_date + coalesce(e.due_time, time '23:59')) AT TIME ZONE 'America/Bogota'),
    coalesce(p.quiet_start, 21::smallint), coalesce(p.quiet_end, 8::smallint)
  FROM public.task_executions e
  JOIN public.tasks t ON t.id = e.task_id AND t.trashed_at IS NULL
  LEFT JOIN public.notification_preferences p ON p.user_id = e.owner_id
  WHERE e.archived_at IS NULL AND e.purged_at IS NULL AND e.visible_to_creator
    AND e.status NOT IN ('done','skipped','cancelled')
    AND e.scheduled_date IS NOT NULL
    AND e.scheduled_date BETWEEN (now() AT TIME ZONE 'America/Bogota')::date - 1 AND (now() AT TIME ZONE 'America/Bogota')::date + 120
    AND public.is_own_creator_for(e.owner_id, e.creator_id)
    AND coalesce(p.enabled, true) AND (p.paused_until IS NULL OR p.paused_until < now())
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = e.owner_id);
END $$;
REVOKE ALL ON FUNCTION public.push_reminder_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_reminder_candidates() TO service_role;