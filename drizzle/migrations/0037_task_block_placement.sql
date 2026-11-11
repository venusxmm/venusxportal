ALTER TABLE public.task_executions ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES public.task_time_blocks(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.place_task_execution(_id uuid, _task_id uuid, _occurrence_date date, _block_id uuid, _before_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.task_executions; eid uuid := _id; ids uuid[]; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.task_time_blocks WHERE id=_block_id) THEN RAISE EXCEPTION 'Unknown block'; END IF;
IF eid IS NULL OR NOT EXISTS (SELECT 1 FROM public.task_executions WHERE id=eid) THEN
  IF _task_id IS NULL OR _occurrence_date IS NULL THEN RAISE EXCEPTION 'Unknown execution'; END IF;
  IF NOT public.can_see_task(_task_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  eid := public.task_resolve_execution(_task_id,_occurrence_date);
END IF;
SELECT * INTO e FROM public.task_executions WHERE id=eid FOR UPDATE;
IF e.archived_at IS NOT NULL OR e.purged_at IS NOT NULL OR NOT (public.is_executive() OR coalesce(e.owner_id=auth.uid(),false)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
UPDATE public.task_executions SET block_id=_block_id WHERE id=eid;
SELECT array_agg(id ORDER BY coalesce(sort_order,1000000000), due_time NULLS LAST, created_at) INTO ids
  FROM public.task_executions WHERE scheduled_date IS NOT DISTINCT FROM e.scheduled_date AND block_id=_block_id AND id<>eid AND archived_at IS NULL AND purged_at IS NULL;
ids := coalesce(ids,'{}');
IF _before_id IS NOT NULL AND _before_id=ANY(ids) THEN
  ids := ids[1:array_position(ids,_before_id)-1] || eid || ids[array_position(ids,_before_id):];
ELSE ids := ids || eid; END IF;
UPDATE public.task_executions t SET sort_order=o.pos FROM unnest(ids) WITH ORDINALITY o(id,pos) WHERE t.id=o.id;
INSERT INTO public.audit_events(actor_id,entity,entity_id,action,details) VALUES (auth.uid(),'task_executions',eid,'place',jsonb_build_object('block_id',_block_id,'before_id',_before_id));
RETURN eid; END $$;
REVOKE ALL ON FUNCTION public.place_task_execution(uuid,uuid,date,uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.place_task_execution(uuid,uuid,date,uuid,uuid) TO authenticated;