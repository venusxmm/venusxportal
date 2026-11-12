ALTER TABLE public.task_time_blocks ADD COLUMN IF NOT EXISTS sort_mode text NOT NULL DEFAULT 'manual' CHECK (sort_mode IN ('manual','time','priority'));
CREATE OR REPLACE FUNCTION public.set_execution_priority(_id uuid, _task_id uuid, _occurrence_date date, _priority public.task_priority) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.task_executions; eid uuid := _id; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF eid IS NULL OR NOT EXISTS (SELECT 1 FROM public.task_executions WHERE id=eid) THEN
  IF _task_id IS NULL OR _occurrence_date IS NULL THEN RAISE EXCEPTION 'Unknown execution'; END IF;
  IF NOT public.can_see_task(_task_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  eid := public.task_resolve_execution(_task_id,_occurrence_date);
END IF;
SELECT * INTO e FROM public.task_executions WHERE id=eid FOR UPDATE;
IF e.archived_at IS NOT NULL OR e.purged_at IS NOT NULL OR NOT (public.is_executive() OR coalesce(e.owner_id=auth.uid(),false)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
UPDATE public.task_executions SET priority=_priority WHERE id=eid;
INSERT INTO public.audit_events(actor_id,entity,entity_id,action,details) VALUES (auth.uid(),'task_executions',eid,'priority',jsonb_build_object('from',e.priority,'to',_priority));
RETURN eid; END $$;
REVOKE ALL ON FUNCTION public.set_execution_priority(uuid,uuid,date,public.task_priority) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_execution_priority(uuid,uuid,date,public.task_priority) TO authenticated;