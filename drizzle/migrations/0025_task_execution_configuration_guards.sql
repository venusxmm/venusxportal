CREATE OR REPLACE FUNCTION public.task_configuration_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','completed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at','updated_at']) AND current_setting('venusx.task_configuration',true) IS DISTINCT FROM 'saving' THEN RAISE EXCEPTION 'Use executive task configuration action'; END IF;
RETURN NEW; END $$;
CREATE TRIGGER task_configuration_guard BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.task_configuration_guard();
CREATE OR REPLACE FUNCTION public.task_new_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE rid uuid; BEGIN
IF current_setting('venusx.task_configuration',true)='saving' THEN RETURN NEW; END IF;
INSERT INTO public.task_revisions(task_id,effective_from,title,description,owner_id,creator_id,priority,due_time,recurrence,enabled) VALUES(NEW.id,coalesce(NEW.due_date,(now() AT TIME ZONE 'America/Bogota')::date),NEW.title,NEW.description,NEW.owner_id,NEW.creator_id,NEW.priority,NEW.due_time,'once',NEW.archived_at IS NULL) RETURNING id INTO rid;
INSERT INTO public.task_executions(task_id,revision_id,scheduled_date,due_time,title,description,owner_id,creator_id,priority,status,completed_at) VALUES(NEW.id,rid,NEW.due_date,NEW.due_time,NEW.title,NEW.description,NEW.owner_id,NEW.creator_id,NEW.priority,NEW.status::text,NEW.completed_at); RETURN NEW; END $$;
CREATE TRIGGER task_new_execution AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.task_new_execution();
DO $$ DECLARE definition text; BEGIN SELECT pg_get_functiondef('public.save_task_configuration(uuid,jsonb)'::regprocedure) INTO definition;
definition := replace(definition,'PERFORM pg_advisory_xact_lock(7458321);','_task_id := nullif(_task_id, ''00000000-0000-0000-0000-000000000000''::uuid); PERFORM set_config(''venusx.task_configuration'',''saving'',true); PERFORM pg_advisory_xact_lock(7458321);');
EXECUTE definition; END $$;
CREATE OR REPLACE FUNCTION public.task_future_action(_task_id uuid,_date date,_action text,_body text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.task_revisions; eid uuid; BEGIN
IF NOT public.is_active_member(auth.uid()) OR _action NOT IN ('comment','request_skip') OR _date<=(now() AT TIME ZONE 'America/Bogota')::date THEN RAISE EXCEPTION 'Invalid future action'; END IF;
PERFORM pg_advisory_xact_lock(7458321);
SELECT * INTO r FROM public.task_revisions WHERE task_id=_task_id AND enabled AND recurrence<>'once' AND effective_from<=_date AND (effective_until IS NULL OR effective_until>=_date) AND (recurrence='daily' OR extract(dow FROM _date)::integer=ANY(weekdays)) ORDER BY created_at DESC LIMIT 1;
IF NOT FOUND OR NOT (public.is_executive() OR coalesce(r.owner_id=auth.uid(),false)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
INSERT INTO public.task_executions(task_id,revision_id,scheduled_date,due_time,title,description,owner_id,creator_id,priority,recurring) VALUES(r.task_id,r.id,_date,r.due_time,r.title,r.description,r.owner_id,r.creator_id,r.priority,true) ON CONFLICT(task_id,scheduled_date) WHERE status<>'cancelled' DO NOTHING;
SELECT id INTO eid FROM public.task_executions WHERE task_id=_task_id AND scheduled_date=_date AND status<>'cancelled';
PERFORM public.task_execution_action(eid,_action,_body); RETURN eid; END $$;
REVOKE ALL ON FUNCTION public.task_future_action(uuid,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.task_future_action(uuid,date,text,text) TO authenticated;
DO $$ DECLARE definition text; BEGIN SELECT pg_get_functiondef('public.task_agenda(date)'::regprocedure) INTO definition;
definition:=replace(definition,'AND (public.is_executive() OR r.owner_id=auth.uid());','AND (public.is_executive() OR r.owner_id=auth.uid()) AND NOT EXISTS(SELECT 1 FROM public.task_executions e WHERE e.task_id=r.task_id AND e.scheduled_date=_date AND e.status<>''cancelled'');'); EXECUTE definition; END $$;