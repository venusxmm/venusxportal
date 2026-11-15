CREATE OR REPLACE FUNCTION public.sync_my_portal_notifications()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'America/Bogota')::date;
  r record; _tid text; _d date; _h text; _n integer := 0; _c integer;
BEGIN
  IF _uid IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT e FROM jsonb_array_elements(coalesce(public.creator_portal_tasks(_today - 7, _today + 14), '[]'::jsonb)) e LOOP
    IF coalesce((r.e->>'visible_to_creator')::boolean, false) IS NOT TRUE
       OR (r.e->>'owner_id')::uuid IS DISTINCT FROM _uid
       OR r.e->>'status' IN ('done','skipped','cancelled') THEN CONTINUE; END IF;
    _tid := r.e->>'task_id';
    _d := nullif(r.e->>'scheduled_date','')::date;
    IF coalesce((r.e->>'recurring')::boolean,false) AND _d > _today THEN CONTINUE; END IF;
    _h := md5(coalesce(r.e->>'title','') || '|' || coalesce(r.e->>'due_time',''));
    IF NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=_uid AND dedupe_key LIKE 'task:'||_tid||':%') THEN
      INSERT INTO notifications(user_id,title,body,link,dedupe_key)
      VALUES (_uid,'Nueva tarea asignada',r.e->>'title','/portal','task:'||_tid||':'||coalesce(_d::text,'-')||':'||_h)
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=_uid AND dedupe_key LIKE 'task:'||_tid||':'||coalesce(_d::text,'-')||':%') THEN
      IF coalesce((r.e->>'recurring')::boolean,false) THEN
        -- new recurring date: silent baseline
        INSERT INTO notifications(user_id,title,body,link,dedupe_key,read_at)
        VALUES (_uid,'Tarea programada',r.e->>'title','/portal','task:'||_tid||':'||coalesce(_d::text,'-')||':'||_h, now())
        ON CONFLICT (dedupe_key) DO NOTHING;
      ELSE
        INSERT INTO notifications(user_id,title,body,link,dedupe_key)
        VALUES (_uid,'Cambio de fecha en tu tarea',r.e->>'title','/portal','task:'||_tid||':'||coalesce(_d::text,'-')||':'||_h)
        ON CONFLICT (dedupe_key) DO NOTHING;
      END IF;
    ELSE
      INSERT INTO notifications(user_id,title,body,link,dedupe_key)
      VALUES (_uid,'Tarea actualizada',r.e->>'title','/portal','task:'||_tid||':'||coalesce(_d::text,'-')||':'||_h)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    IF _d IS NOT NULL AND _d < _today THEN
      INSERT INTO notifications(user_id,title,body,link,dedupe_key)
      VALUES (_uid,'Tarea vencida',r.e->>'title','/portal','overdue:'||_tid||':'||_d)
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF _d IS NOT NULL AND _d <= _today + 1 THEN
      INSERT INTO notifications(user_id,title,body,link,dedupe_key)
      VALUES (_uid, CASE WHEN _d=_today THEN 'Tu tarea vence hoy' ELSE 'Tu tarea vence mañana' END, r.e->>'title','/portal','due:'||_tid||':'||_d)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    GET DIAGNOSTICS _c = ROW_COUNT; _n := _n + _c;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.sync_my_portal_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_portal_notifications() TO authenticated;