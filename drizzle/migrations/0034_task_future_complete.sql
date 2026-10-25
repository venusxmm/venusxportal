DO $$ DECLARE d text; BEGIN
d := pg_get_functiondef('public.task_future_action(uuid,date,text,text)'::regprocedure);
d := replace(d, $q$_action NOT IN ('comment','request_skip','archive')$q$, $q$_action NOT IN ('comment','request_skip','archive','complete')$q$);
IF position($q$'complete')$q$ in d)=0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
EXECUTE d; END $$;