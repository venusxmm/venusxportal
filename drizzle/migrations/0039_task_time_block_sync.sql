CREATE OR REPLACE FUNCTION public.task_execution_block_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.due_time IS DISTINCT FROM OLD.due_time AND NEW.block_id IS NOT DISTINCT FROM OLD.block_id THEN
    IF NEW.due_time IS NOT NULL THEN
      NEW.block_id := NULL;
    ELSIF NEW.block_id IS NULL AND OLD.due_time IS NOT NULL THEN
      SELECT b.id INTO NEW.block_id FROM public.task_time_blocks b
      WHERE (b.start_time <= b.end_time AND OLD.due_time >= b.start_time AND OLD.due_time < b.end_time)
         OR (b.start_time > b.end_time AND (OLD.due_time >= b.start_time OR OLD.due_time < b.end_time))
      ORDER BY b.position LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS task_execution_block_sync ON public.task_executions;
CREATE TRIGGER task_execution_block_sync BEFORE UPDATE OF due_time, block_id ON public.task_executions
FOR EACH ROW EXECUTE FUNCTION public.task_execution_block_sync();