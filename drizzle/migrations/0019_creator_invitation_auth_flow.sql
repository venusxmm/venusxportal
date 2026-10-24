create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    public._normalize_email_address(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public._normalize_email_address(_email text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(_email, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
$$;

revoke all on function public._normalize_email_address(text) from public, anon, authenticated;

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
begin
  if not public.is_executive() then
    raise exception 'Only executives can create invitations';
  end if;

  normalized_email := public._normalize_email_address(_email);
  if normalized_email is null
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'A valid email address is required';
  end if;
  if _token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token';
  end if;
  if _role <> 'employee' and coalesce(array_length(_areas, 1), 0) > 0 then
    raise exception 'Only employees can receive employee areas';
  end if;
  if exists (
    select 1
    from public.invitations
    where public._normalize_email_address(email) = normalized_email
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception 'A pending invitation already exists for this email';
  end if;

  insert into public.invitations (email, token_hash, role, areas)
  values (normalized_email, _token_hash, _role, coalesce(_areas, '{}'))
  returning * into result;
  return jsonb_build_object(
    'id', result.id,
    'email', result.email,
    'role', result.role,
    'expires_at', result.expires_at
  );
end;
$$;

create or replace function public.get_invitation_status(_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invite public.invitations;
  invited_user_email_confirmed_at timestamptz;
  account_state text;
begin
  if _token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select *
  into invite
  from public.invitations
  where token_hash = _token_hash;

  if invite.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select email_confirmed_at
  into invited_user_email_confirmed_at
  from auth.users
  where public._normalize_email_address(email) =
    public._normalize_email_address(invite.email);

  account_state := case
    when not found then 'new'
    when invited_user_email_confirmed_at is null then 'unverified'
    else 'verified'
  end;

  return jsonb_build_object(
    'status',
    case
      when invite.revoked_at is not null then 'revoked'
      when invite.accepted_at is not null then 'accepted'
      when invite.expires_at <= now() then 'expired'
      else 'pending'
    end,
    'email', invite.email,
    'role', invite.role,
    'expires_at', invite.expires_at,
    'account_state', account_state
  );
end;
$$;

create or replace function public._link_creator_from_invitation(_user_id uuid, _invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.invitations;
  user_email text;
  email_confirmed_at timestamptz;
  normalized_email text;
  matching_creators integer;
  matched_creator_id uuid;
  matched_creator_user_id uuid;
  existing_creator_id uuid;
begin
  if auth.uid() is distinct from _user_id then
    raise exception using errcode = '42501', message = 'Creator linking is only available to the signed-in user';
  end if;

  if not public.is_active_member(_user_id) then
    raise exception using errcode = '42501', message = 'Active account access is required to link a Creator profile';
  end if;

  select *
  into invite
  from public.invitations
  where id = _invitation_id;

  if invite.id is null
    or invite.role <> 'creator'
    or invite.revoked_at is not null
    or (invite.accepted_at is null and invite.expires_at <= now())
  then
    raise exception using errcode = '22023', message = 'A valid Creator invitation is required to link this profile';
  end if;

  select email, auth.users.email_confirmed_at
  into user_email, email_confirmed_at
  from auth.users
  where id = _user_id;

  normalized_email := public._normalize_email_address(user_email);
  if normalized_email is null or normalized_email = ''
    or normalized_email <> public._normalize_email_address(invite.email)
  then
    raise exception using errcode = '42501', message = 'Sign in with the email address on the Creator invitation';
  end if;

  if email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'Confirm your email address before accepting the Creator invitation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 614273));

  select count(*)
  into matching_creators
  from public.creators
  where archived_at is null
    and public._normalize_email_address(email) <> ''
    and public._normalize_email_address(email) = normalized_email;

  if matching_creators = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'No active Creator profile matches this invitation. Ask an Executive to verify the Creator email.';
  end if;

  if matching_creators > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'More than one active Creator profile matches this invitation. Ask an Executive to resolve the duplicate email.';
  end if;

  select id, user_id
  into matched_creator_id, matched_creator_user_id
  from public.creators
  where archived_at is null
    and public._normalize_email_address(email) <> ''
    and public._normalize_email_address(email) = normalized_email;

  select id
  into existing_creator_id
  from public.creators
  where user_id = _user_id;

  if existing_creator_id is not null and existing_creator_id <> matched_creator_id then
    raise exception using
      errcode = 'P0001',
      message = 'This account is already linked to a different Creator profile. Ask an Executive to review the association.';
  end if;

  if matched_creator_user_id is not null and matched_creator_user_id <> _user_id then
    raise exception using
      errcode = 'P0001',
      message = 'This Creator profile is already linked to another account. Ask an Executive to review the association.';
  end if;

  if matched_creator_user_id is null then
    update public.creators
    set user_id = _user_id
    where id = matched_creator_id
      and user_id is null;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'Creator ownership changed during linking. Please retry or ask an Executive to review the association.';
    end if;
  end if;

  return matched_creator_id;
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
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in before accepting an invitation';
  end if;

  if not public.is_active_member(auth.uid()) then
    raise exception using errcode = '42501', message = 'Active account access is required to accept an invitation';
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
    or public._normalize_email_address(current_email) <>
      public._normalize_email_address(invite.email)
  then
    raise exception using errcode = '42501', message = 'Sign in with the invited email address';
  end if;

  if email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'Confirm your email address before accepting the invitation';
  end if;

  if invite.accepted_at is not null then
    if invite.revoked_at is not null
      or not exists (
        select 1
        from public.user_roles
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

  return true;
end;
$$;

create or replace function public.resolve_creator_link()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text;
  email_confirmed_at timestamptz;
  existing_creator_id uuid;
  accepted_invitation_id uuid;
begin
  if auth.uid() is null
    or not public.is_active_member(auth.uid())
    or not public.has_role(auth.uid(), 'creator')
  then
    return null;
  end if;

  select email, auth.users.email_confirmed_at
  into current_email, email_confirmed_at
  from auth.users
  where id = auth.uid();

  if current_email is null or email_confirmed_at is null then
    return null;
  end if;

  select id
  into existing_creator_id
  from public.creators
  where user_id = auth.uid();

  if existing_creator_id is not null then
    return existing_creator_id;
  end if;

  select id
  into accepted_invitation_id
  from public.invitations
  where role = 'creator'
    and accepted_at is not null
    and revoked_at is null
    and public._normalize_email_address(email) =
      public._normalize_email_address(current_email)
  order by accepted_at desc, created_at desc
  limit 1;

  if accepted_invitation_id is null then
    return null;
  end if;

  return public._link_creator_from_invitation(auth.uid(), accepted_invitation_id);
end;
$$;

revoke all on function public.get_invitation_status(text) from public;
grant execute on function public.get_invitation_status(text) to anon, authenticated;

revoke all on function public._link_creator_from_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

revoke all on function public.resolve_creator_link() from public, anon;
grant execute on function public.resolve_creator_link() to authenticated;
