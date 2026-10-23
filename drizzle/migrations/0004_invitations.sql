create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 320),
  token_hash text not null unique,
  role public.app_role not null,
  areas public.work_area[] not null default '{}',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists invitations_email_idx on public.invitations (lower(email));
grant select on public.invitations to authenticated;
grant all on public.invitations to service_role;
alter table public.invitations enable row level security;
create policy "invitations exec read" on public.invitations for select to authenticated using (public.is_executive());

create or replace function public.create_invitation(_email text, _token_hash text, _role public.app_role, _areas public.work_area[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result public.invitations;
begin
  if not public.is_executive() then raise exception 'Only executives can create invitations'; end if;
  if lower(trim(_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'A valid email address is required'; end if;
  if _token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation token'; end if;
  if _role <> 'employee' and coalesce(array_length(_areas, 1), 0) > 0 then raise exception 'Only employees can receive employee areas'; end if;
  if exists (select 1 from public.invitations where lower(email) = lower(trim(_email)) and accepted_at is null and revoked_at is null and expires_at > now()) then
    raise exception 'A pending invitation already exists for this email';
  end if;
  insert into public.invitations (email, token_hash, role, areas)
  values (lower(trim(_email)), _token_hash, _role, coalesce(_areas, '{}')) returning * into result;
  return jsonb_build_object('id', result.id, 'email', result.email, 'role', result.role, 'expires_at', result.expires_at);
end $$;

create or replace function public.revoke_invitation(_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_executive() then raise exception 'Only executives can revoke invitations'; end if;
  update public.invitations set revoked_at = now() where id = _id and accepted_at is null and revoked_at is null;
  return found;
end $$;

create or replace function public.accept_invitation(_token_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare invite public.invitations; current_email text;
begin
  select * into invite from public.invitations where token_hash = _token_hash for update;
  if invite.id is null or invite.accepted_at is not null or invite.revoked_at is not null or invite.expires_at <= now() then raise exception 'Invitation is invalid or expired'; end if;
  select email into current_email from auth.users where id = auth.uid();
  if current_email is null or lower(current_email) <> lower(invite.email) then raise exception 'Sign in with the invited email address'; end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), invite.role) on conflict do nothing;
  insert into public.user_areas (user_id, area) select auth.uid(), unnest(invite.areas) on conflict do nothing;
  update public.invitations set accepted_at = now() where id = invite.id;
  return true;
end $$;

revoke execute on function public.create_invitation(text, text, public.app_role, public.work_area[]) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_invitation(text, text, public.app_role, public.work_area[]) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;