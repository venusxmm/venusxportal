ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.creators(id);
COMMENT ON COLUMN public.invitations.creator_id IS 'Creator workspace fixed at invitation creation; NULL on legacy invitations requires unique verified-email matching.';
CREATE OR REPLACE FUNCTION public.is_active_member(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 select exists (select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=_user_id and p.membership_removed_at is null and p.access_revoked_at is null and u.email_confirmed_at is not null)
$$;
CREATE OR REPLACE FUNCTION public.create_invitation(_email text, _token_hash text, _role public.app_role, _areas public.work_area[] DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare result public.invitations; normalized_email text; target uuid; matches integer; target_user uuid;
begin
 if not public.is_executive() then raise exception 'Only executives can create invitations'; end if;
 normalized_email := public._normalize_email_address(_email);
 if normalized_email is null or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'A valid email address is required'; end if;
 if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' or _role is null then raise exception 'Invalid invitation'; end if;
 if _role <> 'employee' and coalesce(array_length(_areas,1),0)>0 then raise exception 'Only employees can receive employee areas'; end if;
 perform pg_advisory_xact_lock(hashtextextended(normalized_email,614273));
 if exists (select 1 from public.invitations where public._normalize_email_address(email)=normalized_email and accepted_at is null and revoked_at is null and expires_at>now()) then raise exception 'A pending invitation already exists for this email'; end if;
 if exists (select 1 from auth.users u join public.profiles p on p.id=u.id where public._normalize_email_address(u.email)=normalized_email and (p.access_revoked_at is not null or p.membership_removed_at is not null)) then raise exception 'This account access was revoked. Invitations cannot restore it.'; end if;
 if _role='creator' then
  select count(*) into matches from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email;
  if matches=0 then raise exception 'No active Creator profile matches this invitation.'; end if;
  if matches<>1 then raise exception 'More than one active Creator profile matches this invitation.'; end if;
  select id,user_id into target,target_user from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email for update;
  if target_user is not null and not exists (select 1 from auth.users where id=target_user and public._normalize_email_address(email)=normalized_email) then raise exception 'This Creator profile is already linked to another account.'; end if;
 end if;
 insert into public.invitations(email,token_hash,role,areas,creator_id) values(normalized_email,_token_hash,_role,coalesce(_areas,'{}'),target) returning * into result;
 return jsonb_build_object('id',result.id,'email',result.email,'role',result.role,'expires_at',result.expires_at);
end $$;
CREATE OR REPLACE FUNCTION public._link_creator_from_invitation(_user_id uuid,_invitation_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare invite public.invitations; normalized_email text; target uuid; target_user uuid; matches integer;
begin
 if auth.uid() is distinct from _user_id then raise exception 'Creator linking is only available to the signed-in user'; end if;
 select public._normalize_email_address(email) into normalized_email from auth.users where id=_user_id and email_confirmed_at is not null;
 if normalized_email is null then raise exception 'Confirm your email address before accepting the Creator invitation'; end if;
 if not public.is_active_member(_user_id) then raise exception 'Active account access is required'; end if;
 select * into invite from public.invitations where id=_invitation_id for update;
 if invite.id is null or invite.role<>'creator' or invite.revoked_at is not null or (invite.accepted_at is null and invite.expires_at<=now()) then raise exception 'A valid Creator invitation is required'; end if;
 if normalized_email<>public._normalize_email_address(invite.email) then raise exception 'Sign in with the invited email address'; end if;
 perform pg_advisory_xact_lock(hashtextextended(normalized_email,614273));
 if invite.creator_id is null then
  select count(*) into matches from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email;
  if matches=0 then raise exception 'No active Creator profile matches this invitation'; end if;
  if matches<>1 then raise exception 'More than one active Creator profile matches this invitation'; end if;
  select id into target from public.creators where archived_at is null and public._normalize_email_address(email)=normalized_email;
 else target:=invite.creator_id;
 end if;
 select user_id into target_user from public.creators where id=target and archived_at is null and public._normalize_email_address(email)=normalized_email for update;
 if not found then raise exception 'The invited Creator profile is unavailable or its email changed'; end if;
 if target_user is not null and target_user<>_user_id then raise exception 'This Creator profile is already linked to another account'; end if;
 if exists (select 1 from public.creators where user_id=_user_id and id<>target) then raise exception 'This account is already linked to a different Creator profile'; end if;
 if target_user is null then update public.creators set user_id=_user_id where id=target and user_id is null; end if;
 if invite.creator_id is null then update public.invitations set creator_id=target where id=invite.id; end if;
 return target;
end $$;
CREATE OR REPLACE FUNCTION public.complete_pending_invitation() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare normalized_email text; matches integer; pending_hash text;
begin
 if auth.uid() is null then raise exception 'Sign in to continue'; end if;
 select public._normalize_email_address(email) into normalized_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if normalized_email is null then raise exception 'Confirm your email address before continuing'; end if;
 if not public.is_active_member(auth.uid()) then raise exception 'Account access is revoked'; end if;
 select count(*),min(token_hash) into matches,pending_hash from public.invitations where public._normalize_email_address(email)=normalized_email and accepted_at is null and revoked_at is null and expires_at>now();
 if matches>1 then raise exception 'More than one pending invitation matches your account. Ask an Executive to review it.'; end if;
 if matches=1 then return public.accept_invitation(pending_hash); end if;
 return false;
end $$;
CREATE OR REPLACE FUNCTION public.resolve_creator_link() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare target uuid; matches integer;
begin
 if auth.uid() is null or not public.is_active_member(auth.uid()) or not public.has_role(auth.uid(),'creator') then return null; end if;
 select count(*) into matches from public.creators where user_id=auth.uid() and archived_at is null;
 if matches<>1 then raise exception 'Creator account has no unique active workspace. Ask an Executive to review the association.'; end if;
 select id into target from public.creators where user_id=auth.uid() and archived_at is null;
 return target;
end $$;
REVOKE ALL ON FUNCTION public.complete_pending_invitation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_pending_invitation() TO authenticated;
REVOKE ALL ON FUNCTION public._link_creator_from_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_invitation(text,text,public.app_role,public.work_area[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(text,text,public.app_role,public.work_area[]) TO authenticated;