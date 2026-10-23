lock table public.creators in share row exclusive mode;

create table if not exists public.creator_private_details (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  internal_notes text,
  internal_photo_path text
);

grant select, insert, update, delete on public.creator_private_details to authenticated;
grant all on public.creator_private_details to service_role;
alter table public.creator_private_details enable row level security;

drop policy if exists "creator private details staff access" on public.creator_private_details;
drop policy if exists "creator private details staff read" on public.creator_private_details;
drop policy if exists "creator private details staff manage" on public.creator_private_details;
drop policy if exists "creator private details staff insert" on public.creator_private_details;
drop policy if exists "creator private details staff update" on public.creator_private_details;
drop policy if exists "creator private details staff delete" on public.creator_private_details;
create policy "creator private details staff read" on public.creator_private_details
  for select to authenticated
  using (
    public.is_active_member(auth.uid())
    and (
      public.is_executive()
      or (
        public.has_role(auth.uid(), 'employee')
        and public.can_access_creator(creator_id)
      )
    )
  );
create policy "creator private details staff insert" on public.creator_private_details
  for insert to authenticated
  with check (
    public.is_active_member(auth.uid())
    and (public.is_executive() or public.has_area('creator_management'))
  );
create policy "creator private details staff update" on public.creator_private_details
  for update to authenticated
  using (
    public.is_active_member(auth.uid())
    and (public.is_executive() or public.has_area('creator_management'))
  )
  with check (
    public.is_active_member(auth.uid())
    and (public.is_executive() or public.has_area('creator_management'))
  );
create policy "creator private details staff delete" on public.creator_private_details
  for delete to authenticated
  using (
    public.is_active_member(auth.uid())
    and (public.is_executive() or public.has_area('creator_management'))
  );

do $$
declare
  notes_expr text;
  photo_expr text;
begin
  notes_expr := case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'creators' and column_name = 'internal_notes'
    ) then 'internal_notes'
    else 'null::text'
  end;
  photo_expr := case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'creators' and column_name = 'internal_photo_path'
    ) then 'internal_photo_path'
    else 'null::text'
  end;

  if notes_expr <> 'null::text' or photo_expr <> 'null::text' then
    execute format(
      'insert into public.creator_private_details (creator_id, internal_notes, internal_photo_path)
       select id, %s, %s from public.creators
       where %s is not null or %s is not null
       on conflict (creator_id) do update set
         internal_notes = coalesce(excluded.internal_notes, creator_private_details.internal_notes),
         internal_photo_path = coalesce(excluded.internal_photo_path, creator_private_details.internal_photo_path)',
      notes_expr, photo_expr, notes_expr, photo_expr
    );
  end if;
end
$$;

alter table public.creators drop column if exists internal_notes;
alter table public.creators drop column if exists internal_photo_path;

drop policy if exists "comments read" on public.task_comments;
create policy "comments read" on public.task_comments for select to authenticated
  using (
    public.is_active_member(auth.uid())
    and (
      public.is_executive()
      or (
        public.has_role(auth.uid(), 'employee')
        and public.can_see_task(task_id)
      )
    )
  );
