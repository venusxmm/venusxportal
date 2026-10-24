-- A completed team removal is different from a security revocation. Older
-- versions left both markers set, which made normal reinvitation impossible.
update public.profiles
set access_revoked_at = null
where membership_removed_at is not null
  and access_revoked_at is not null;

create or replace function public.create_invitation(
  _email text,
  _token_hash text,
  _role public.app_role,
  _areas public.work_area[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.invitations;
  normalized_email text;
  target_creator_id uuid;
  target_creator_user_id uuid;
  creator_matches integer;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can create invitations';
  end if;

  normalized_email := public._normalize_email_address(_email);
  if normalized_email is null
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception using errcode = '22023', message = 'A valid email address is required';
  end if;
  if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' or _role is null then
    raise exception using errcode = '22023', message = 'Invalid invitation';
  end if;
  if _role <> 'employee' and coalesce(array_length(_areas, 1), 0) > 0 then
    raise exception using errcode = '22023', message = 'Only employees can receive employee areas';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 614273));

  if exists (
    select 1
    from public.invitations
    where public._normalize_email_address(email) = normalized_email
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception using errcode = '23505', message = 'A pending invitation already exists for this email';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where public._normalize_email_address(u.email) = normalized_email
      and p.access_revoked_at is not null
  ) then
    raise exception using
      errcode = '42501',
      message = 'This account access was revoked. Invitations cannot restore it.';
  end if;

  if _role = 'creator' then
    select count(*)
    into creator_matches
    from public.creators
    where archived_at is null
      and public._normalize_email_address(email) = normalized_email;

    if creator_matches = 0 then
      raise exception using errcode = '22023', message = 'No active Creator profile matches this invitation.';
    end if;
    if creator_matches <> 1 then
      raise exception using errcode = '22023', message = 'More than one active Creator profile matches this invitation.';
    end if;

    select id, user_id
    into target_creator_id, target_creator_user_id
    from public.creators
    where archived_at is null
      and public._normalize_email_address(email) = normalized_email
    for update;

    if target_creator_user_id is not null and not exists (
      select 1
      from auth.users
      where id = target_creator_user_id
        and public._normalize_email_address(email) = normalized_email
    ) then
      raise exception using errcode = '42501', message = 'This Creator profile is already linked to another account.';
    end if;
  end if;

  insert into public.invitations (email, token_hash, role, areas, creator_id)
  values (normalized_email, _token_hash, _role, coalesce(_areas, '{}'), target_creator_id)
  returning * into result;

  return jsonb_build_object(
    'id', result.id,
    'email', result.email,
    'role', result.role,
    'expires_at', result.expires_at
  );
end;
$$;

create or replace function public.revoke_invitation(_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_invitation public.invitations;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can delete invitations';
  end if;

  delete from public.invitations
  where id = _id
    and accepted_at is null
    and revoked_at is null
  returning * into deleted_invitation;

  if not found then
    return false;
  end if;

  insert into public.audit_events (actor_id, entity, entity_id, action, details)
  values (
    auth.uid(),
    'invitations',
    deleted_invitation.id,
    'delete_pending_invitation',
    jsonb_build_object('email', deleted_invitation.email, 'role', deleted_invitation.role)
  );

  return true;
end;
$$;

create or replace function public.remove_team_member(_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can remove team members';
  end if;
  if _user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'You cannot remove your own account';
  end if;

  select email
  into target_email
  from public.profiles
  where id = _user_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Member profile was not found';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user_id)
    or exists (select 1 from public.user_areas where user_id = _user_id)
  then
    raise exception using errcode = '22023', message = 'Revoke all roles and work areas before removing this member';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = _user_id
      and access_revoked_at is not null
      and membership_removed_at is null
  ) then
    raise exception using errcode = '22023', message = 'Revoke access before removing this member from the roster';
  end if;

  update public.profiles
  set access_revoked_at = null,
      membership_removed_at = now()
  where id = _user_id;

  insert into public.audit_events (actor_id, entity, entity_id, action, details)
  values (
    auth.uid(),
    'profiles',
    _user_id,
    'remove_from_team',
    jsonb_build_object('access_revoked', false, 'membership_removed', true)
  );

  update public.invitations
  set revoked_at = now()
  where public._normalize_email_address(email) = public._normalize_email_address(target_email)
    and accepted_at is null
    and revoked_at is null;

  return true;
end;
$$;

create or replace function public.create_recovery_invitation(
  _user_id uuid,
  _token_hash text,
  _role public.app_role,
  _areas public.work_area[] default '{}',
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
  normalized_email text;
  result public.invitations;
  target_creator_id uuid;
  target_creator_user_id uuid;
  creator_matches integer;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can create recovery invitations';
  end if;
  if _user_id is null or _user_id = auth.uid() then
    raise exception using errcode = '22023', message = 'Choose another member to recover';
  end if;
  if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' or _role is null then
    raise exception using errcode = '22023', message = 'Invalid recovery invitation';
  end if;
  if length(trim(coalesce(_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'Enter a recovery reason between 10 and 500 characters';
  end if;
  if _role <> 'employee' and coalesce(array_length(_areas, 1), 0) > 0 then
    raise exception using errcode = '22023', message = 'Only employees can receive employee areas';
  end if;

  select email
  into target_email
  from public.profiles
  where id = _user_id
    and access_revoked_at is not null
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'This account is not in a recoverable access state';
  end if;
  if target_email is null then
    raise exception using errcode = '22023', message = 'The member has no email address on record';
  end if;

  select public._normalize_email_address(email)
  into normalized_email
  from auth.users
  where id = _user_id;

  if normalized_email is null
    or normalized_email = ''
    or normalized_email <> public._normalize_email_address(target_email)
  then
    raise exception using errcode = '22023', message = 'The account email does not match its profile';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user_id)
    or exists (select 1 from public.user_areas where user_id = _user_id)
  then
    raise exception using errcode = '22023', message = 'This account still has roles or work areas; review it before recovery';
  end if;
  if _role <> 'creator' and exists (
    select 1 from public.creators where user_id = _user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'This account is linked to a Creator profile and can only be recovered with the Creator role';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 614273));

  if _role = 'creator' then
    select count(*)
    into creator_matches
    from public.creators
    where archived_at is null
      and public._normalize_email_address(email) = normalized_email;

    if creator_matches = 0 then
      raise exception using errcode = '22023', message = 'No active Creator profile matches this account';
    end if;
    if creator_matches <> 1 then
      raise exception using errcode = '22023', message = 'More than one active Creator profile matches this account';
    end if;

    select id, user_id
    into target_creator_id, target_creator_user_id
    from public.creators
    where archived_at is null
      and public._normalize_email_address(email) = normalized_email
    for update;

    if target_creator_user_id is not null and target_creator_user_id <> _user_id then
      raise exception using errcode = '22023', message = 'This Creator profile is linked to another account';
    end if;
  end if;

  if exists (
    select 1
    from public.invitations
    where public._normalize_email_address(email) = normalized_email
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception using errcode = '23505', message = 'A pending invitation already exists for this email';
  end if;

  insert into public.invitations (
    email, token_hash, role, areas, creator_id, recovery_user_id
  )
  values (
    normalized_email, _token_hash, _role, coalesce(_areas, '{}'), target_creator_id, _user_id
  )
  returning * into result;

  insert into public.audit_events (actor_id, entity, entity_id, action, details)
  values (
    auth.uid(),
    'invitations',
    result.id,
    'create_recovery_invitation',
    jsonb_build_object('member_id', _user_id, 'role', _role, 'reason', trim(_reason))
  );

  return jsonb_build_object(
    'id', result.id,
    'email', result.email,
    'role', result.role,
    'expires_at', result.expires_at
  );
end;
$$;

create or replace function public.accept_invitation(_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.invitations;
  current_email text;
  email_confirmed_at timestamptz;
  revoked_at timestamptz;
  removed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in before accepting an invitation';
  end if;
  if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invitation is invalid or expired';
  end if;

  select *
  into invite
  from public.invitations
  where token_hash = _token_hash
  for update;

  if invite.id is null then
    raise exception using errcode = '22023', message = 'Invitation is invalid or expired';
  end if;

  select email, auth.users.email_confirmed_at
  into current_email, email_confirmed_at
  from auth.users
  where id = auth.uid();

  if current_email is null
    or public._normalize_email_address(current_email) <> public._normalize_email_address(invite.email)
  then
    raise exception using errcode = '42501', message = 'Sign in with the invited email address';
  end if;
  if email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'Confirm your email address before accepting the invitation';
  end if;

  if invite.accepted_at is not null then
    if invite.revoked_at is not null
      or (invite.recovery_user_id is not null and invite.recovery_user_id <> auth.uid())
      or not public.is_active_member(auth.uid())
      or not exists (
        select 1 from public.user_roles
        where user_id = auth.uid() and role = invite.role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'This invitation was already used, but its access is no longer active. Ask an Executive for access.';
    end if;
    if invite.role = 'creator' then
      perform public._link_creator_from_invitation(auth.uid(), invite.id);
    end if;
    return true;
  end if;

  if invite.revoked_at is not null or invite.expires_at <= now() then
    raise exception using errcode = '22023', message = 'Invitation is invalid or expired';
  end if;

  select access_revoked_at, membership_removed_at
  into revoked_at, removed_at
  from public.profiles
  where id = auth.uid()
  for update;

  if invite.recovery_user_id is null then
    if not found or revoked_at is not null then
      raise exception using errcode = '42501', message = 'This account access was revoked. Ask an Executive for access.';
    end if;
    if removed_at is not null then
      if exists (select 1 from public.user_roles where user_id = auth.uid())
        or exists (select 1 from public.user_areas where user_id = auth.uid())
      then
        raise exception using errcode = '42501', message = 'This account still has access assignments; ask an Executive to review it.';
      end if;
      update public.profiles
      set membership_removed_at = null
      where id = auth.uid();
    elsif not public.is_active_member(auth.uid()) then
      raise exception using errcode = '42501', message = 'Active account access is required to accept an invitation';
    end if;
  else
    if invite.recovery_user_id <> auth.uid() then
      raise exception using errcode = '42501', message = 'This recovery invitation belongs to another account';
    end if;
    if not found or revoked_at is null then
      raise exception using errcode = '42501', message = 'This account is not awaiting explicit access recovery.';
    end if;
    if exists (select 1 from public.user_roles where user_id = auth.uid())
      or exists (select 1 from public.user_areas where user_id = auth.uid())
    then
      raise exception using errcode = '42501', message = 'The account already has access; ask an Executive to review it.';
    end if;
    update public.profiles
    set access_revoked_at = null,
        membership_removed_at = null
    where id = auth.uid();
  end if;

  if invite.role = 'creator' then
    perform public._link_creator_from_invitation(auth.uid(), invite.id);
  end if;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), invite.role)
  on conflict do nothing;

  insert into public.user_areas (user_id, area)
  select auth.uid(), unnest(invite.areas)
  on conflict do nothing;

  update public.invitations
  set accepted_at = now()
  where id = invite.id;

  if invite.recovery_user_id is not null then
    insert into public.audit_events (actor_id, entity, entity_id, action, details)
    values (
      auth.uid(),
      'invitations',
      invite.id,
      'accept_recovery_invitation',
      jsonb_build_object('member_id', auth.uid(), 'role', invite.role)
    );
  end if;

  return true;
end;
$$;

create or replace function public.complete_pending_invitation()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  pending_count integer;
  pending_hash text;
  profile_access_revoked_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to continue';
  end if;

  select public._normalize_email_address(u.email), p.access_revoked_at
  into normalized_email, profile_access_revoked_at
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;

  if normalized_email is null then
    raise exception using errcode = '42501', message = 'Confirm your email address before continuing';
  end if;

  select count(*), min(token_hash)
  into pending_count, pending_hash
  from public.invitations
  where public._normalize_email_address(email) = normalized_email
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if pending_count > 1 then
    raise exception using
      errcode = '22023',
      message = 'More than one pending invitation matches your account. Ask an Executive to review it.';
  end if;
  if pending_count = 1 then
    return public.accept_invitation(pending_hash);
  end if;
  if profile_access_revoked_at is not null then
    raise exception using errcode = '42501', message = 'Account access is revoked';
  end if;
  return false;
end;
$$;

revoke all on function public.create_invitation(text, text, public.app_role, public.work_area[])
  from public, anon;
grant execute on function public.create_invitation(text, text, public.app_role, public.work_area[])
  to authenticated;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
revoke all on function public.remove_team_member(uuid) from public, anon;
grant execute on function public.remove_team_member(uuid) to authenticated;
revoke all on function public.create_recovery_invitation(uuid, text, public.app_role, public.work_area[], text)
  from public, anon;
grant execute on function public.create_recovery_invitation(uuid, text, public.app_role, public.work_area[], text)
  to authenticated;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
revoke all on function public.complete_pending_invitation() from public, anon;
grant execute on function public.complete_pending_invitation() to authenticated;