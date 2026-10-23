-- Canonical creator area is creator_management. The legacy enum value remains
-- because PostgreSQL enum removal is not safely reversible in a live database.
insert into public.user_areas (user_id, area)
select user_id, 'creator_management'::public.work_area
from public.user_areas
where area = 'creator_manager'::public.work_area
on conflict (user_id, area) do nothing;
delete from public.user_areas where area = 'creator_manager'::public.work_area;

insert into public.creator_assignments (creator_id, user_id, area)
select creator_id, user_id, 'creator_management'::public.work_area
from public.creator_assignments
where area = 'creator_manager'::public.work_area
on conflict (creator_id, user_id, area) do nothing;
delete from public.creator_assignments where area = 'creator_manager'::public.work_area;

alter table public.user_areas
  add constraint user_areas_no_legacy_creator_manager
  check (area <> 'creator_manager'::public.work_area);
alter table public.creator_assignments
  add constraint creator_assignments_no_legacy_creator_manager
  check (area <> 'creator_manager'::public.work_area);

drop policy if exists "roles exec delete" on public.user_roles;
create policy "roles exec delete" on public.user_roles for delete to authenticated
  using (public.is_executive() and (user_id <> auth.uid() or role <> 'executive'));
