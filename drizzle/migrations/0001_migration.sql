alter type public.work_area add value if not exists 'creator_manager';
alter type public.work_area add value if not exists 'admin';

create or replace function public.protect_last_executive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'executive' and not exists (
    select 1 from public.user_roles where role = 'executive' and id <> old.id
  ) then
    raise exception 'Cannot remove the last executive account';
  end if;
  return old;
end $$;
create trigger protect_last_exec before delete on public.user_roles
  for each row execute function public.protect_last_executive();