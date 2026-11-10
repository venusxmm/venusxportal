ALTER TABLE public.task_executions ADD COLUMN IF NOT EXISTS sort_order integer;
CREATE OR REPLACE FUNCTION public.reorder_task_executions(_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.task_executions; n integer := 0; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF _ids IS NULL OR cardinality(_ids)=0 OR cardinality(_ids)>500 THEN RAISE EXCEPTION 'Provide 1-500 executions'; END IF;
FOR e IN SELECT * FROM public.task_executions WHERE id=ANY(_ids) FOR UPDATE LOOP
  IF e.archived_at IS NOT NULL OR e.purged_at IS NOT NULL OR NOT (public.is_executive() OR coalesce(e.owner_id=auth.uid(),false)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  n := n+1; END LOOP;
IF n<>(SELECT count(DISTINCT x) FROM unnest(_ids) x) THEN RAISE EXCEPTION 'Unknown execution'; END IF;
UPDATE public.task_executions t SET sort_order=o.pos FROM unnest(_ids) WITH ORDINALITY o(id,pos) WHERE t.id=o.id;
INSERT INTO public.audit_events(actor_id,entity,action,details) VALUES (auth.uid(),'task_executions','reorder',jsonb_build_object('ids',to_jsonb(_ids)));
RETURN n; END $$;
REVOKE ALL ON FUNCTION public.reorder_task_executions(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reorder_task_executions(uuid[]) TO authenticated;