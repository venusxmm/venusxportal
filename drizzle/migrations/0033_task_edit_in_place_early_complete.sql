CREATE OR REPLACE FUNCTION public.task_execution_action(_id uuid, _action text, _body text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE e public.task_executions; exec boolean := public.is_executive(); BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF; SELECT * INTO e FROM public.task_executions WHERE id=_id FOR UPDATE; IF NOT FOUND OR NOT public.can_read_execution(_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF e.status='cancelled' OR e.archived_at IS NOT NULL OR e.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Execution archived or cancelled'; END IF;
IF _action='comment' THEN IF nullif(trim(_body),'') IS NULL OR length(_body)>4000 THEN RAISE EXCEPTION 'Invalid comment'; END IF;
ELSIF _action='complete' THEN IF e.status IN ('done','skipped') THEN RETURN; END IF; UPDATE public.task_executions SET status='done',completed_at=now(),skip_state='none' WHERE id=_id;
ELSIF _action='reopen' THEN IF e.status<>'done' THEN RAISE EXCEPTION 'Only completed executions can reopen'; END IF; UPDATE public.task_executions SET status='todo',skip_state='none' WHERE id=_id;
ELSIF _action='request_skip' THEN IF NOT e.recurring OR e.status IN ('done','skipped') OR e.skip_state='pending' THEN RAISE EXCEPTION 'Skip request not applicable'; END IF; UPDATE public.task_executions SET skip_state='pending',skip_reason=_body WHERE id=_id;
ELSIF _action IN ('approve_skip','reject_skip') THEN IF NOT exec OR e.skip_state<>'pending' THEN RAISE EXCEPTION 'Executive approval required'; END IF; UPDATE public.task_executions SET skip_state=CASE WHEN _action='approve_skip' THEN 'approved' ELSE 'rejected' END,status=CASE WHEN _action='approve_skip' THEN 'skipped' ELSE status END WHERE id=_id;
ELSE RAISE EXCEPTION 'Invalid action'; END IF;
INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(_id,auth.uid(),_action,_body);
IF NOT e.recurring AND _action IN ('complete','reopen') THEN UPDATE public.tasks SET status=CASE WHEN _action='complete' THEN 'done'::public.task_status ELSE 'todo'::public.task_status END WHERE id=e.task_id; END IF; END $function$;

CREATE OR REPLACE FUNCTION public.save_task_configuration(_task_id uuid, _config jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE tid uuid; rid uuid; start_date date; effective date; today date := (now() AT TIME ZONE 'America/Bogota')::date; mode text; state text; days integer[]; affected uuid; visible boolean; oid uuid; cid uuid; ttl text; dsc text; pri public.task_priority; tm time; one uuid; BEGIN
IF NOT public.is_active_member(auth.uid()) OR NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
_task_id:=nullif(_task_id,'00000000-0000-0000-0000-000000000000'::uuid); PERFORM set_config('venusx.task_configuration','saving',true); PERFORM pg_advisory_xact_lock(7458321); PERFORM public.materialize_task_executions();
mode:=coalesce(_config->>'recurrence','once'); state:=coalesce(_config->>'recurrence_state','enabled'); SELECT coalesce(array_agg(value::integer),'{}') INTO days FROM jsonb_array_elements_text(coalesce(_config->'weekdays','[]'));
IF mode NOT IN ('once','daily','weekdays') OR state NOT IN ('enabled','paused','disabled') OR (mode='weekdays' AND cardinality(days)=0) OR EXISTS(SELECT 1 FROM unnest(days) d WHERE d<0 OR d>6) THEN RAISE EXCEPTION 'Invalid recurrence'; END IF;
IF nullif(trim(_config->>'title'),'') IS NULL OR length(_config->>'title')>200 THEN RAISE EXCEPTION 'Title required (maximum 200 characters)'; END IF;
start_date:=nullif(_config->>'due_date','')::date; IF mode<>'once' AND start_date IS NULL THEN RAISE EXCEPTION 'Recurring tasks need a start date'; END IF;
oid:=nullif(_config->>'owner_id','')::uuid; cid:=nullif(_config->>'creator_id','')::uuid; visible:=coalesce((_config->>'visible_to_creator')::boolean,false);
ttl:=trim(_config->>'title'); dsc:=_config->>'description'; pri:=coalesce(_config->>'priority','medium')::public.task_priority; tm:=nullif(_config->>'due_time','')::time;
IF visible AND cid IS NULL THEN RAISE EXCEPTION 'Select a linked creator before publishing'; END IF;
IF oid IS NOT NULL AND EXISTS(SELECT 1 FROM public.creators WHERE user_id=oid AND archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.creators WHERE user_id=oid AND id IS NOT DISTINCT FROM cid) THEN RAISE EXCEPTION 'A creator owner must be the linked creator'; END IF;
IF visible AND NOT EXISTS(SELECT 1 FROM public.creators WHERE id=cid AND user_id IS NOT DISTINCT FROM oid AND oid IS NOT NULL) THEN RAISE EXCEPTION 'Portal publishing requires the owner to be the linked creator'; END IF;
IF oid IS NOT NULL AND NOT public.is_active_member(oid) THEN RAISE EXCEPTION 'Owner must be an active member'; END IF;
IF cid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.creators WHERE id=cid AND archived_at IS NULL) THEN RAISE EXCEPTION 'Creator not available'; END IF;
IF _task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=_task_id) THEN RAISE EXCEPTION 'Task not found'; END IF;
effective:=CASE WHEN _task_id IS NULL THEN greatest(coalesce(start_date,today),today) ELSE greatest(coalesce(start_date,today+1),today+1) END;
IF _task_id IS NULL THEN INSERT INTO public.tasks(title,description,owner_id,creator_id,visible_to_creator,priority,due_date,due_time,recurrence,weekdays,recurrence_state,created_by) VALUES(ttl,dsc,oid,cid,visible,pri,start_date,tm,mode,days,state,auth.uid()) RETURNING id INTO tid;
ELSE tid:=_task_id; UPDATE public.task_revisions SET effective_until=least(coalesce(effective_until,effective-1),effective-1) WHERE task_id=tid;
UPDATE public.tasks SET title=ttl,description=dsc,owner_id=oid,creator_id=cid,visible_to_creator=visible,priority=pri,due_date=start_date,due_time=tm,recurrence=mode,weekdays=days,recurrence_state=state WHERE id=tid; END IF;
INSERT INTO public.task_revisions(task_id,effective_from,title,description,owner_id,creator_id,visible_to_creator,priority,due_time,recurrence,weekdays,enabled) VALUES(tid,effective,ttl,dsc,oid,cid,visible,pri,tm,mode,days,state='enabled') RETURNING id INTO rid;
IF mode='once' THEN
 -- Edit the existing execution in place; a cleared date stays null. Completion state is never changed by an edit.
 SELECT id INTO one FROM public.task_executions WHERE task_id=tid AND archived_at IS NULL AND purged_at IS NULL AND status<>'cancelled' ORDER BY (status='done'), created_at DESC LIMIT 1;
 IF one IS NOT NULL THEN
  UPDATE public.task_executions SET revision_id=rid,title=ttl,description=dsc,owner_id=oid,creator_id=cid,visible_to_creator=visible,priority=pri,due_time=tm,scheduled_date=CASE WHEN status='done' THEN scheduled_date ELSE start_date END WHERE id=one;
  INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(one,auth.uid(),'edited','Updated from task edit');
 ELSIF state='enabled' THEN
  INSERT INTO public.task_executions(task_id,revision_id,scheduled_date,occurrence_date,due_time,title,description,owner_id,creator_id,visible_to_creator,priority) VALUES(tid,rid,start_date,CASE WHEN _task_id IS NULL THEN start_date ELSE NULL END,tm,ttl,dsc,oid,cid,visible,pri);
 END IF;
ELSIF _task_id IS NOT NULL THEN
 -- Recurring: update future pending rows in place; trash only dates the new pattern no longer covers.
 FOR affected IN UPDATE public.task_executions SET archived_at=now() WHERE task_id=tid AND coalesce(occurrence_date,scheduled_date)>=effective AND status NOT IN ('done','skipped','cancelled') AND archived_at IS NULL AND purged_at IS NULL
   AND NOT (state='enabled' AND (mode='daily' OR extract(dow FROM coalesce(occurrence_date,scheduled_date))::integer=ANY(days))) RETURNING id LOOP
  INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(affected,auth.uid(),'archived','Date no longer in the recurrence'); END LOOP;
 FOR affected IN UPDATE public.task_executions SET revision_id=rid,title=ttl,description=dsc,owner_id=oid,creator_id=cid,visible_to_creator=visible,priority=pri,due_time=tm WHERE task_id=tid AND coalesce(occurrence_date,scheduled_date)>=effective AND status NOT IN ('done','skipped','cancelled') AND archived_at IS NULL AND purged_at IS NULL RETURNING id LOOP
  INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(affected,auth.uid(),'edited','Updated from task edit'); END LOOP;
 IF coalesce((_config->>'apply_today')::boolean,false) AND state='enabled' THEN FOR affected IN UPDATE public.task_executions SET revision_id=rid,title=ttl,description=dsc,owner_id=oid,creator_id=cid,visible_to_creator=visible,priority=pri,due_time=tm WHERE task_id=tid AND scheduled_date=today AND status NOT IN ('done','skipped','cancelled') AND archived_at IS NULL AND purged_at IS NULL RETURNING id LOOP INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) VALUES(affected,auth.uid(),'rescheduled','Updated from task edit'); END LOOP; END IF;
END IF;
RETURN tid; END $function$;