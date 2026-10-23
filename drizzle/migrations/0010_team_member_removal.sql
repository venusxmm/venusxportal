alter table public.profiles
  add column if not exists membership_removed_at timestamptz,
  add column if not exists access_revoked_at timestamptz;

revoke update on public.profiles from authenticated;
grant update (full_name, nickname, description, avatar_url) on public.profiles to authenticated;

create or replace function public.is_active_member(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
      where id = _user_id
        and membership_removed_at is null
        and access_revoked_at is null
  )
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member(_user_id)
    and exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_own_creator(_creator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member(auth.uid())
    and exists (
      select 1 from public.creators where id = _creator_id and user_id = auth.uid()
    )
$$;

create or replace function public.can_access_creator(_creator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member(auth.uid()) and (
    public.is_executive()
    or exists (
      select 1 from public.creator_assignments
      where creator_id = _creator_id and user_id = auth.uid()
    )
    or public.has_area('creator_management')
  )
$$;

create or replace function public.can_see_task(_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member(auth.uid()) and exists (
    select 1 from public.tasks t where t.id = _task_id and (
      public.is_executive()
      or t.owner_id = auth.uid() or t.created_by = auth.uid()
      or (t.creator_id is not null and public.has_role(auth.uid(), 'employee') and public.can_access_creator(t.creator_id))
      or (t.visible_to_creator and t.creator_id is not null and public.is_own_creator(t.creator_id))
    )
  )
$$;

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_member(auth.uid()))
  with check (id = auth.uid() and public.is_active_member(auth.uid()));
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (public.is_active_member(auth.uid()) and (
    id = auth.uid() or public.is_executive() or public.has_role(auth.uid(), 'employee')
  ));
drop policy if exists "profiles exec update" on public.profiles;
create policy "profiles exec update" on public.profiles for update to authenticated
  using (public.is_active_member(auth.uid()) and public.is_executive())
  with check (public.is_active_member(auth.uid()) and public.is_executive());

drop policy if exists "roles read" on public.user_roles;
create policy "roles read" on public.user_roles for select to authenticated
  using (public.is_active_member(auth.uid()) and (
    user_id = auth.uid() or public.is_executive()
  ));
drop policy if exists "areas read" on public.user_areas;
create policy "areas read" on public.user_areas for select to authenticated
  using (public.is_active_member(auth.uid()) and (
    user_id = auth.uid() or public.is_executive()
  ));

drop policy if exists "creators read" on public.creators;
create policy "creators read" on public.creators for select to authenticated
  using (public.is_active_member(auth.uid()) and (
    (public.has_role(auth.uid(), 'employee') and public.can_access_creator(id))
    or public.is_executive()
    or user_id = auth.uid()
  ));

drop policy if exists "assign read" on public.creator_assignments;
create policy "assign read" on public.creator_assignments for select to authenticated
  using (public.is_active_member(auth.uid()) and (
    public.is_executive() or user_id = auth.uid() or public.has_area('creator_management')
  ));

drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_active_member(auth.uid()) and (
    public.is_executive()
    or (public.has_role(auth.uid(), 'employee') and created_by = auth.uid())
  ));

drop policy if exists "comments delete" on public.task_comments;
create policy "comments delete" on public.task_comments for delete to authenticated
  using (public.is_active_member(auth.uid()) and author_id = auth.uid());

drop policy if exists "notif own read" on public.notifications;
create policy "notif own read" on public.notifications for select to authenticated
  using (public.is_active_member(auth.uid()) and user_id = auth.uid());
drop policy if exists "notif own update" on public.notifications;
create policy "notif own update" on public.notifications for update to authenticated
  using (public.is_active_member(auth.uid()) and user_id = auth.uid());
drop policy if exists "notif own delete" on public.notifications;
create policy "notif own delete" on public.notifications for delete to authenticated
  using (public.is_active_member(auth.uid()) and user_id = auth.uid());

drop policy if exists "profile photos own insert" on storage.objects;
create policy "profile photos own insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and public.is_active_member(auth.uid())
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "profile photos own update" on storage.objects;
create policy "profile photos own update" on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and public.is_active_member(auth.uid())
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and public.is_active_member(auth.uid())
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "profile photos own delete" on storage.objects;
create policy "profile photos own delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and public.is_active_member(auth.uid())
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.revoke_team_member_access(_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_executive() then
    raise exception 'Only executives can revoke team access';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot revoke your own team access here';
  end if;
  perform 1 from public.profiles where id = _user_id for update;
  if not found then
    raise exception 'Member profile was not found';
  end if;
  perform pg_advisory_xact_lock(4242);
  if not exists (
    select 1 from public.user_roles where user_id = _user_id
    union all
    select 1 from public.user_areas where user_id = _user_id
  ) then
    raise exception 'This member has no access to revoke';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user_id and role = 'executive')
    and (select count(*) from public.user_roles where role = 'executive') <= 1 then
    raise exception 'Cannot revoke the last executive';
  end if;

  delete from public.user_areas where user_id = _user_id;
  delete from public.user_roles where user_id = _user_id;
  update public.profiles set access_revoked_at = now() where id = _user_id;
  update public.invitations
  set revoked_at = now()
  where lower(email) = lower((select email from public.profiles where id = _user_id))
    and accepted_at is null and revoked_at is null;
  return true;
end
$$;

create or replace function public.remove_team_member(_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_executive() then
    raise exception 'Only executives can remove team members';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot remove your own account';
  end if;
  perform 1 from public.profiles where id = _user_id for update;
  if not found then
    raise exception 'Member profile was not found';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user_id)
    or exists (select 1 from public.user_areas where user_id = _user_id) then
    raise exception 'Revoke all roles and work areas before removing this member';
  end if;
  if not exists (
    select 1 from public.profiles where id = _user_id and access_revoked_at is not null
  ) then
    raise exception 'Revoke access before removing this member from the roster';
  end if;

  update public.profiles
  set membership_removed_at = now()
  where id = _user_id and membership_removed_at is null;
  if not found then
    raise exception 'Member was not found or was already removed';
  end if;

  insert into public.audit_events (actor_id, entity, entity_id, action, details)
  values (auth.uid(), 'profiles', _user_id, 'remove_from_team', '{"access_revoked":true}'::jsonb);
  update public.invitations
  set revoked_at = now()
  where lower(email) = lower((select email from public.profiles where id = _user_id))
    and accepted_at is null and revoked_at is null;
  return true;
end
$$;

create or replace function public.restore_team_member_on_role_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set membership_removed_at = null, access_revoked_at = null
  where id = new.user_id;
  return new;
end
$$;

create or replace function public.protect_last_executive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'executive' then
    perform pg_advisory_xact_lock(4242);
    if not exists (
      select 1 from public.user_roles where role = 'executive' and id <> old.id
    ) then
      raise exception 'Cannot remove the last executive account';
    end if;
  end if;
  return old;
end
$$;

create or replace function public.claim_first_executive()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_member(auth.uid()) then
    return false;
  end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.user_roles where role = 'executive') then
    return false;
  end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), 'executive');
  return true;
end
$$;

revoke execute on function public.is_active_member(uuid) from public, anon;
grant execute on function public.is_active_member(uuid) to authenticated;
revoke execute on function public.claim_first_executive() from public, anon;
grant execute on function public.claim_first_executive() to authenticated;

drop trigger if exists restore_team_member_on_role_grant on public.user_roles;
create trigger restore_team_member_on_role_grant
  after insert on public.user_roles
  for each row execute function public.restore_team_member_on_role_grant();

revoke execute on function public.remove_team_member(uuid) from public, anon;
grant execute on function public.remove_team_member(uuid) to authenticated;
revoke execute on function public.revoke_team_member_access(uuid) from public, anon;
grant execute on function public.revoke_team_member_access(uuid) to authenticated;
