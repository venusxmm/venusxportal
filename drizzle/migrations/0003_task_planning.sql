alter table public.tasks
  add column if not exists due_time time,
  add column if not exists member_type text;

alter table public.tasks
  drop constraint if exists tasks_member_type_check;
alter table public.tasks
  add constraint tasks_member_type_check
  check (member_type is null or member_type in ('employee', 'creator', 'partner'));