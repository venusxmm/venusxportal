ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS trashed_at timestamptz, ADD COLUMN IF NOT EXISTS trashed_by uuid;
ALTER TABLE public.task_executions ADD COLUMN IF NOT EXISTS trashed_by_series boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS purged_at timestamptz;
COMMENT ON COLUMN public.task_executions.purged_at IS 'Permanently deleted occurrence of a still-active recurring rule; content stripped, row kept only so the date is not regenerated';

CREATE OR REPLACE FUNCTION public.can_read_execution(_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
SELECT public.is_active_member(auth.uid()) AND EXISTS(SELECT 1 FROM public.task_executions e JOIN public.tasks t ON t.id=e.task_id WHERE e.id=_id AND e.purged_at IS NULL AND (public.is_executive() OR (t.trashed_at IS NULL AND (e.owner_id=auth.uid() OR (e.visible_to_creator AND public.is_own_creator(e.creator_id) AND e.owner_id=auth.uid()))))) $f$;

CREATE OR REPLACE FUNCTION public.can_see_task(_task_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
SELECT public.is_active_member(auth.uid()) AND EXISTS(SELECT 1 FROM public.tasks WHERE id=_task_id AND (public.is_executive() OR (trashed_at IS NULL AND (owner_id=auth.uid() OR (visible_to_creator AND public.is_own_creator(creator_id) AND owner_id=auth.uid()))))) $f$;

CREATE OR REPLACE FUNCTION public.materialize_task_executions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE today date := (now() AT TIME ZONE 'America/Bogota')::date; BEGIN
INSERT INTO public.task_executions(task_id,revision_id,scheduled_date,occurrence_date,due_time,title,description,owner_id,creator_id,priority,recurring,visible_to_creator)
SELECT r.task_id,r.id,d::date,d::date,r.due_time,r.title,r.description,r.owner_id,r.creator_id,r.priority,true,r.visible_to_creator FROM public.task_revisions r JOIN public.tasks t ON t.id=r.task_id AND t.trashed_at IS NULL CROSS JOIN LATERAL generate_series(r.effective_from::timestamp,least(coalesce(r.effective_until,today),today)::timestamp,interval '1 day') d WHERE r.enabled AND r.recurrence<>'once' AND (r.recurrence='daily' OR extract(dow FROM d)::integer=ANY(r.weekdays)) ON CONFLICT DO NOTHING; END $f$;

CREATE OR REPLACE FUNCTION public.task_agenda(_date date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE today date := (now() AT TIME ZONE 'America/Bogota')::date; result jsonb; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF; PERFORM public.materialize_task_executions();
SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('projected',false) ORDER BY e.scheduled_date,e.due_time),'[]'::jsonb) INTO result FROM public.task_executions e JOIN public.tasks t ON t.id=e.task_id AND t.trashed_at IS NULL WHERE e.archived_at IS NULL AND e.purged_at IS NULL AND public.can_read_execution(e.id) AND (e.scheduled_date=_date OR e.scheduled_date IS NULL OR (e.status NOT IN ('done','skipped','cancelled') AND e.due_time IS NOT NULL AND (e.scheduled_date+e.due_time)<(now() AT TIME ZONE 'America/Bogota')));
IF _date>today THEN SELECT result||coalesce(jsonb_agg(jsonb_build_object('id',r.id::text||':'||_date::text,'task_id',r.task_id,'scheduled_date',_date,'occurrence_date',_date,'due_time',r.due_time,'title',r.title,'description',r.description,'owner_id',r.owner_id,'creator_id',r.creator_id,'visible_to_creator',r.visible_to_creator,'priority',r.priority,'status','todo','recurring',true,'skip_state','none','projected',true)),'[]'::jsonb) INTO result FROM public.task_revisions r JOIN public.tasks t ON t.id=r.task_id AND t.trashed_at IS NULL WHERE r.enabled AND r.recurrence<>'once' AND r.effective_from<=_date AND (r.effective_until IS NULL OR r.effective_until>=_date) AND (r.recurrence='daily' OR extract(dow FROM _date)::integer=ANY(r.weekdays)) AND (public.is_executive() OR r.owner_id=auth.uid() OR (r.visible_to_creator AND public.is_own_creator(r.creator_id) AND r.owner_id=auth.uid())) AND NOT EXISTS(SELECT 1 FROM public.task_executions e WHERE e.task_id=r.task_id AND e.occurrence_date=_date AND e.status<>'cancelled'); END IF; RETURN result; END $f$;

CREATE OR REPLACE FUNCTION public.creator_portal_tasks(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE today date := (now() AT TIME ZONE 'America/Bogota')::date; stored jsonb; projected jsonb; BEGIN
IF NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
IF _from IS NULL OR _to IS NULL OR _to<_from OR _to-_from>62 THEN RAISE EXCEPTION 'Invalid range'; END IF;
PERFORM public.materialize_task_executions();
SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('projected',false,'recurrence',coalesce(r.recurrence,'once'),'weekdays',coalesce(r.weekdays,'{}'))),'[]'::jsonb) INTO stored FROM public.task_executions e JOIN public.tasks t ON t.id=e.task_id AND t.trashed_at IS NULL LEFT JOIN public.task_revisions r ON r.id=e.revision_id
 WHERE e.archived_at IS NULL AND e.purged_at IS NULL AND e.status<>'cancelled' AND e.visible_to_creator AND e.owner_id=auth.uid() AND public.is_own_creator(e.creator_id)
 AND (e.scheduled_date BETWEEN _from AND _to OR (e.scheduled_date<_from AND e.status NOT IN ('done','skipped')));
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id::text||':'||d::date::text,'task_id',r.task_id,'scheduled_date',d::date,'occurrence_date',d::date,'due_time',r.due_time,'title',r.title,'description',r.description,'owner_id',r.owner_id,'creator_id',r.creator_id,'visible_to_creator',true,'priority',r.priority,'status','todo','recurring',true,'skip_state','none','projected',true,'recurrence',r.recurrence,'weekdays',r.weekdays)),'[]'::jsonb) INTO projected
 FROM generate_series(greatest(_from,today+1)::timestamp,_to::timestamp,interval '1 day') d JOIN public.task_revisions r ON r.enabled AND r.recurrence<>'once' AND r.effective_from<=d::date AND (r.effective_until IS NULL OR r.effective_until>=d::date) AND (r.recurrence='daily' OR extract(dow FROM d)::integer=ANY(r.weekdays)) JOIN public.tasks t ON t.id=r.task_id AND t.trashed_at IS NULL
 WHERE r.visible_to_creator AND r.owner_id=auth.uid() AND public.is_own_creator(r.creator_id) AND NOT EXISTS(SELECT 1 FROM public.task_executions e WHERE e.task_id=r.task_id AND e.occurrence_date=d::date AND e.status<>'cancelled');
RETURN stored||projected; END $f$;

CREATE OR REPLACE FUNCTION public.trash_task_series(_task_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE n integer; BEGIN
IF NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
PERFORM set_config('venusx.task_configuration','saving',true);
UPDATE public.tasks SET trashed_at=now(), trashed_by=auth.uid() WHERE id=_task_id AND trashed_at IS NULL;
IF NOT FOUND THEN RAISE EXCEPTION 'Task not found or already in Trash'; END IF;
WITH x AS (UPDATE public.task_executions SET archived_at=now(), trashed_by_series=true WHERE task_id=_task_id AND archived_at IS NULL AND purged_at IS NULL AND status NOT IN ('done','skipped') RETURNING id)
INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) SELECT id,auth.uid(),'archived','Series moved to Trash' FROM x;
GET DIAGNOSTICS n = ROW_COUNT;
INSERT INTO public.audit_events(actor_id,entity,entity_id,action,details) VALUES(auth.uid(),'tasks',_task_id,'trash_series',jsonb_build_object('executions',n));
RETURN n; END $f$;

CREATE OR REPLACE FUNCTION public.restore_task_series(_task_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE n integer; BEGIN
IF NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
PERFORM set_config('venusx.task_configuration','saving',true);
UPDATE public.tasks SET trashed_at=NULL, trashed_by=NULL WHERE id=_task_id AND trashed_at IS NOT NULL;
IF NOT FOUND THEN RAISE EXCEPTION 'Task is not in Trash'; END IF;
WITH x AS (UPDATE public.task_executions SET archived_at=NULL, trashed_by_series=false WHERE task_id=_task_id AND trashed_by_series AND purged_at IS NULL RETURNING id)
INSERT INTO public.task_execution_events(execution_id,actor_id,action,body) SELECT id,auth.uid(),'restored','Series restored' FROM x;
GET DIAGNOSTICS n = ROW_COUNT;
INSERT INTO public.audit_events(actor_id,entity,entity_id,action,details) VALUES(auth.uid(),'tasks',_task_id,'restore_series',jsonb_build_object('executions',n));
RETURN n; END $f$;

CREATE OR REPLACE FUNCTION public.restore_task_executions(_ids uuid[], _confirm_count integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE n integer; BEGIN
IF NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
IF _ids IS NULL OR cardinality(_ids)=0 OR cardinality(_ids)>500 OR _confirm_count<>cardinality(_ids) OR (SELECT count(DISTINCT x) FROM unnest(_ids) x)<>_confirm_count THEN RAISE EXCEPTION 'Confirm the exact number of executions'; END IF;
IF EXISTS(SELECT 1 FROM public.task_executions e JOIN public.tasks t ON t.id=e.task_id WHERE e.id=ANY(_ids) AND t.trashed_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the entire series instead'; END IF;
UPDATE public.task_executions SET archived_at=NULL, trashed_by_series=false WHERE id=ANY(_ids) AND archived_at IS NOT NULL AND purged_at IS NULL;
GET DIAGNOSTICS n = ROW_COUNT; IF n<>_confirm_count THEN RAISE EXCEPTION 'Selection changed; review confirmation'; END IF;
INSERT INTO public.task_execution_events(execution_id,actor_id,action) SELECT x,auth.uid(),'restored' FROM unnest(_ids) x;
RETURN n; END $f$;

CREATE OR REPLACE FUNCTION public.purge_task_executions(_ids uuid[], _confirm_count integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ DECLARE n integer; BEGIN
IF NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
IF _ids IS NULL OR cardinality(_ids)=0 OR cardinality(_ids)>500 OR _confirm_count<>cardinality(_ids) OR (SELECT count(DISTINCT x) FROM unnest(_ids) x)<>_confirm_count THEN RAISE EXCEPTION 'Confirm the exact number of executions'; END IF;
IF (SELECT count(*) FROM public.task_executions WHERE id=ANY(_ids) AND archived_at IS NOT NULL AND purged_at IS NULL)<>_confirm_count THEN RAISE EXCEPTION 'Only items in Trash can be deleted permanently'; END IF;
DELETE FROM public.task_execution_events WHERE execution_id=ANY(_ids);
-- Occurrences of a live recurring rule keep a contentless tombstone so the date is never regenerated.
UPDATE public.task_executions e SET purged_at=now(), description=NULL, skip_reason=NULL FROM public.tasks t WHERE e.id=ANY(_ids) AND t.id=e.task_id AND e.occurrence_date IS NOT NULL AND t.recurrence<>'once';
DELETE FROM public.task_executions WHERE id=ANY(_ids) AND purged_at IS NULL;
INSERT INTO public.audit_events(actor_id,entity,action,details) VALUES(auth.uid(),'task_executions','purge',jsonb_build_object('ids',to_jsonb(_ids)));
RETURN _confirm_count; END $f$;

CREATE OR REPLACE FUNCTION public.purge_tasks(_ids uuid[], _confirm_count integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN
IF NOT public.is_executive() THEN RAISE EXCEPTION 'Executive required'; END IF;
IF _ids IS NULL OR cardinality(_ids)=0 OR cardinality(_ids)>200 OR _confirm_count<>cardinality(_ids) OR (SELECT count(DISTINCT x) FROM unnest(_ids) x)<>_confirm_count THEN RAISE EXCEPTION 'Confirm the exact number of tasks'; END IF;
IF (SELECT count(*) FROM public.tasks WHERE id=ANY(_ids) AND trashed_at IS NOT NULL)<>_confirm_count THEN RAISE EXCEPTION 'Only tasks in Trash can be deleted permanently'; END IF;
DELETE FROM public.task_execution_events WHERE execution_id IN (SELECT id FROM public.task_executions WHERE task_id=ANY(_ids));
DELETE FROM public.task_executions WHERE task_id=ANY(_ids);
DELETE FROM public.task_revisions WHERE task_id=ANY(_ids);
DELETE FROM public.task_comments WHERE task_id=ANY(_ids);
DELETE FROM public.tasks WHERE id=ANY(_ids);
INSERT INTO public.audit_events(actor_id,entity,action,details) VALUES(auth.uid(),'tasks','purge',jsonb_build_object('ids',to_jsonb(_ids)));
RETURN _confirm_count; END $f$;

REVOKE ALL ON FUNCTION public.trash_task_series(uuid), public.restore_task_series(uuid), public.restore_task_executions(uuid[],integer), public.purge_task_executions(uuid[],integer), public.purge_tasks(uuid[],integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_task_series(uuid), public.restore_task_series(uuid), public.restore_task_executions(uuid[],integer), public.purge_task_executions(uuid[],integer), public.purge_tasks(uuid[],integer) TO authenticated;