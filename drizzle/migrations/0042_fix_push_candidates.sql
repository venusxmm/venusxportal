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
  JOIN public.creators c ON c.id = e.creator_id AND c.user_id = e.owner_id
  LEFT JOIN public.notification_preferences p ON p.user_id = e.owner_id
  WHERE e.archived_at IS NULL AND e.purged_at IS NULL AND e.visible_to_creator
    AND e.status NOT IN ('done','skipped','cancelled')
    AND e.scheduled_date IS NOT NULL
    AND e.scheduled_date BETWEEN (now() AT TIME ZONE 'America/Bogota')::date - 1 AND (now() AT TIME ZONE 'America/Bogota')::date + 120
    AND public.is_active_member(e.owner_id)
    AND coalesce(p.enabled, true) AND (p.paused_until IS NULL OR p.paused_until < now())
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = e.owner_id);
END $$;
REVOKE ALL ON FUNCTION public.push_reminder_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_reminder_candidates() TO service_role;