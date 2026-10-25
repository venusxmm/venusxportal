alter table public.invitations
  add column if not exists delivery_status text not null default 'unknown',
  add column if not exists delivery_method text,
  add column if not exists delivery_error text,
  add column if not exists last_sent_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='invitations_delivery_status_check') then
    alter table public.invitations add constraint invitations_delivery_status_check check (delivery_status in ('unknown','sent','failed'));
  end if;
end $$;

-- Removed/revoked access may return only through a NEW invitation (created after the removal), accepted by the matching verified identity.
create or replace function public.prevent_access_restoration() returns trigger language plpgsql set search_path to 'public' as $$
declare grant_text text := nullif(current_setting('venusx.restore_invitation', true), ''); ok boolean := false;
begin
 if (old.membership_removed_at is not null and new.membership_removed_at is distinct from old.membership_removed_at)
   or (old.access_revoked_at is not null and new.access_revoked_at is distinct from old.access_revoked_at) then
  if grant_text is not null and new.membership_removed_at is null and new.access_revoked_at is null then
   select exists(
     select 1 from public.invitations i join auth.users u on u.id = old.id
     where i.id = grant_text::uuid and i.recovery_user_id is null and i.accepted_at is null and i.revoked_at is null
       and i.expires_at > now() and u.email_confirmed_at is not null
       and public._normalize_email_address(u.email) = public._normalize_email_address(i.email)
       and i.created_at > greatest(coalesce(old.membership_removed_at, '-infinity'::timestamptz), coalesce(old.access_revoked_at, '-infinity'::timestamptz))
   ) into ok;
  end if;
  if not ok then raise exception using errcode='42501', message='Revoked or removed access cannot be restored'; end if;
 end if;
 return new;
end $$;

create or replace function public.accept_invitation(_token_hash text) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare invite public.invitations; current_email text; confirmed timestamptz; prof public.profiles;
begin
 if auth.uid() is null then raise exception using errcode='42501', message='Sign in to accept an invitation'; end if;
 select * into invite from public.invitations where token_hash=_token_hash for update;
 if invite.id is null then raise exception 'Invitation is invalid or expired'; end if;
 if invite.recovery_user_id is not null then raise exception using errcode='42501', message='This legacy access invitation is no longer supported'; end if;
 select email, email_confirmed_at into current_email, confirmed from auth.users where id=auth.uid();
 if current_email is null or public._normalize_email_address(current_email)<>public._normalize_email_address(invite.email) then raise exception 'Sign in with the invited email address'; end if;
 if confirmed is null then raise exception 'Confirm your email address before accepting the invitation'; end if;
 select * into prof from public.profiles where id=auth.uid() for update;
 if prof.id is null then raise exception 'Account profile is missing'; end if;
 if invite.accepted_at is not null then
  if invite.revoked_at is not null or not public.is_active_member(auth.uid()) or not exists(select 1 from public.user_roles where user_id=auth.uid() and role=invite.role) then
   raise exception 'This invitation was already used, but its access is no longer active'; end if;
 else
  if invite.revoked_at is not null or invite.expires_at<=now() then raise exception 'Invitation is invalid or expired'; end if;
  if prof.membership_removed_at is not null or prof.access_revoked_at is not null then
   if invite.created_at <= greatest(coalesce(prof.membership_removed_at,'-infinity'::timestamptz), coalesce(prof.access_revoked_at,'-infinity'::timestamptz)) then
    raise exception using errcode='42501', message='This invitation predates the access removal. Ask an Executive for a new invitation.'; end if;
   -- Explicit re-grant: previous privileges never come back; only the new invitation's role/areas apply.
   delete from public.user_areas where user_id=auth.uid();
   delete from public.user_roles where user_id=auth.uid();
   perform set_config('venusx.restore_invitation', invite.id::text, true);
   update public.profiles set membership_removed_at=null, access_revoked_at=null where id=auth.uid();
   perform set_config('venusx.restore_invitation', '', true);
  end if;
 end if;
 if invite.role='creator' then perform public._link_creator_from_invitation(auth.uid(), invite.id); end if;
 if invite.accepted_at is not null then return true; end if;
 insert into public.user_roles(user_id, role) values(auth.uid(), invite.role) on conflict do nothing;
 insert into public.user_areas(user_id, area) select auth.uid(), unnest(invite.areas) on conflict do nothing;
 update public.invitations set accepted_at=now() where id=invite.id;
 return true;
end $$;

-- Allow executives to issue a new explicit invitation to a previously revoked account (acceptance re-validates everything above).
create or replace function public.create_invitation(_email text, _token_hash text, _role app_role, _areas work_area[] default '{}'::work_area[]) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare result public.invitations; normalized_email text; target_creator_id uuid; target_creator_user_id uuid; creator_matches integer;
begin
  if not public.is_executive() then raise exception using errcode='42501', message='Only executives can create invitations'; end if;
  normalized_email := public._normalize_email_address(_email);
  if normalized_email is null or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception using errcode='22023', message='A valid email address is required'; end if;
  if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' or _role is null then raise exception using errcode='22023', message='Invalid invitation'; end if;
  if _role <> 'employee' and coalesce(array_length(_areas,1),0) > 0 then raise exception using errcode='22023', message='Only employees can receive employee areas'; end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 614273));
  if exists (select 1 from public.invitations where public._normalize_email_address(email)=normalized_email and accepted_at is null and revoked_at is null and expires_at>now()) then
    raise exception using errcode='23505', message='A pending invitation already exists for this email'; end if;
  if _role = 'creator' then
    select count(*) into creator_matches from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email;
    if creator_matches = 0 then raise exception using errcode='22023', message='No active Creator profile matches this invitation.'; end if;
    if creator_matches <> 1 then raise exception using errcode='22023', message='More than one active Creator profile matches this invitation.'; end if;
    select id, user_id into target_creator_id, target_creator_user_id from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email for update;
    if target_creator_user_id is not null and not exists (select 1 from auth.users where id=target_creator_user_id and public._normalize_email_address(email)=normalized_email) then
      raise exception using errcode='42501', message='This Creator profile is already linked to another account.'; end if;
  end if;
  insert into public.invitations(email, token_hash, role, areas, creator_id) values(normalized_email, _token_hash, _role, coalesce(_areas,'{}'), target_creator_id) returning * into result;
  return jsonb_build_object('id', result.id, 'email', result.email, 'role', result.role, 'expires_at', result.expires_at);
end $$;