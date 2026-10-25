DO $$ DECLARE f text; d text; BEGIN
FOREACH f IN ARRAY ARRAY['public.can_read_execution(uuid)','public.can_see_task(uuid)','public.task_agenda(date)','public.task_resolve_execution(uuid,date)'] LOOP
d:=pg_get_functiondef(f::regprocedure);
d:=regexp_replace(d,'visible_to_creator AND public\.is_own_creator\((\w+\.)?creator_id\)','visible_to_creator AND public.is_own_creator(\1creator_id) AND \1owner_id=auth.uid()','g');
EXECUTE d; END LOOP;
d:=pg_get_functiondef('public.task_future_action(uuid,date,text,text)'::regprocedure);
d:=replace(d,'IN (''comment'',''request_skip'')','IN (''comment'',''request_skip'',''archive'')');
d:=replace(d,'PERFORM public.task_execution_action(eid,_action,_body);','IF _action=''archive'' THEN PERFORM public.archive_task_executions(ARRAY[eid],1,false); ELSE PERFORM public.task_execution_action(eid,_action,_body); END IF;');
EXECUTE d;
d:=pg_get_functiondef('public.save_task_configuration(uuid,jsonb)'::regprocedure);
d:=replace(d,'cid uuid; BEGIN','cid uuid; applied boolean:=false; BEGIN');
d:=replace(d,'IF oid IS NOT NULL AND NOT public.is_active_member(oid)','IF oid IS NOT NULL AND EXISTS(SELECT 1 FROM public.creators WHERE user_id=oid AND archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.creators WHERE user_id=oid AND id IS NOT DISTINCT FROM cid) THEN RAISE EXCEPTION ''A creator owner must be the linked creator''; END IF;
IF visible AND NOT EXISTS(SELECT 1 FROM public.creators WHERE id=cid AND user_id IS NOT DISTINCT FROM oid AND oid IS NOT NULL) THEN RAISE EXCEPTION ''Portal publishing requires the owner to be the linked creator''; END IF;
IF oid IS NOT NULL AND NOT public.is_active_member(oid)');
d:=replace(d,'IF mode=''once'' AND state=''enabled'' THEN INSERT','IF _task_id IS NOT NULL AND coalesce((_config->>''apply_today'')::boolean,false) AND state=''enabled'' THEN FOR affected IN UPDATE public.task_executions SET revision_id=rid,title=trim(_config->>''title''),description=_config->>''description'',owner_id=oid,creator_id=cid,visible_to_creator=visible,priority=coalesce(_config->>''priority'',''medium'')::public.task_priority,due_time=nullif(_config->>''due_time'','''')::time WHERE task_id=tid AND scheduled_date=today AND status NOT IN (''done'',''skipped'',''cancelled'') AND archived_at IS NULL RETURNING id LOOP applied:=true; INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(affected,auth.uid(),''rescheduled'',''Updated from task edit''); END LOOP; END IF;
IF mode=''once'' AND state=''enabled'' AND NOT applied THEN INSERT');
EXECUTE d; END $$;

CREATE OR REPLACE FUNCTION public.creator_portal_tasks(_from date,_to date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE today date := (now() AT TIME ZONE 'America/Bogota')::date; stored jsonb; projected jsonb; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF _from IS NULL OR _to IS NULL OR _to<_from OR _to-_from>62 THEN RAISE EXCEPTION 'Invalid range'; END IF;
PERFORM public.materialize_task_executions();
SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('projected',false,'recurrence',coalesce(r.recurrence,'once'),'weekdays',coalesce(r.weekdays,'{}'))),'[]'::jsonb) INTO stored FROM public.task_executions e LEFT JOIN public.task_revisions r ON r.id=e.revision_id
 WHERE e.archived_at IS NULL AND e.status<>'cancelled' AND e.visible_to_creator AND e.owner_id=auth.uid() AND public.is_own_creator(e.creator_id)
 AND (e.scheduled_date BETWEEN _from AND _to OR (e.scheduled_date<_from AND e.status NOT IN ('done','skipped')));
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id::text||':'||d::date::text,'task_id',r.task_id,'scheduled_date',d::date,'occurrence_date',d::date,'due_time',r.due_time,'title',r.title,'description',r.description,'owner_id',r.owner_id,'creator_id',r.creator_id,'visible_to_creator',true,'priority',r.priority,'status','todo','recurring',true,'skip_state','none','projected',true,'recurrence',r.recurrence,'weekdays',r.weekdays)),'[]'::jsonb) INTO projected
 FROM generate_series(greatest(_from,today+1)::timestamp,_to::timestamp,interval '1 day') d JOIN public.task_revisions r ON r.enabled AND r.recurrence<>'once' AND r.effective_from<=d::date AND (r.effective_until IS NULL OR r.effective_until>=d::date) AND (r.recurrence='daily' OR extract(dow FROM d)::integer=ANY(r.weekdays))
 WHERE r.visible_to_creator AND r.owner_id=auth.uid() AND public.is_own_creator(r.creator_id) AND NOT EXISTS(SELECT 1 FROM public.task_executions e WHERE e.task_id=r.task_id AND e.occurrence_date=d::date AND e.status<>'cancelled');
RETURN stored||projected; END $$;
REVOKE ALL ON FUNCTION public.creator_portal_tasks(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_portal_tasks(date,date) TO authenticated;

CREATE TABLE public.task_time_blocks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),start_time time NOT NULL,end_time time NOT NULL,position integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),CHECK (start_time<>end_time));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.task_time_blocks TO authenticated;
GRANT ALL ON public.task_time_blocks TO service_role;
ALTER TABLE public.task_time_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time blocks read" ON public.task_time_blocks FOR SELECT TO authenticated USING (public.is_active_member(auth.uid()));
CREATE POLICY "time blocks exec insert" ON public.task_time_blocks FOR INSERT TO authenticated WITH CHECK (public.is_active_member(auth.uid()) AND public.is_executive());
CREATE POLICY "time blocks exec update" ON public.task_time_blocks FOR UPDATE TO authenticated USING (public.is_active_member(auth.uid()) AND public.is_executive()) WITH CHECK (public.is_executive());
CREATE POLICY "time blocks exec delete" ON public.task_time_blocks FOR DELETE TO authenticated USING (public.is_active_member(auth.uid()) AND public.is_executive());
INSERT INTO public.task_time_blocks(label,start_time,end_time,position) VALUES('Night','00:00','04:00',0),('Early Morning','04:00','06:00',1),('Morning','06:00','12:00',2),('Midday','12:00','15:00',3),('Afternoon','15:00','18:00',4),('Evening','18:00','00:00',5);