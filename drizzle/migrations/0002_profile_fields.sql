alter table public.profiles
  add column if not exists nickname text,
  add column if not exists description text,
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;
alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or avatar_url ~ '^https?://');

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());