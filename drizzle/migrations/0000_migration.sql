
-- ENUMS
create type public.app_role as enum ('executive','employee','creator','partner');
create type public.work_area as enum ('marketing','sharing','operations','creator_management','chatting');
create type public.creator_status as enum ('lead','onboarding','active','paused','offboarded');
create type public.task_status as enum ('todo','in_progress','blocked','review','done');
create type public.task_priority as enum ('low','medium','high','critical');
create type public.txn_kind as enum ('revenue','expense','payout');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  title text,
  availability text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select, insert, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.user_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  area public.work_area not null,
  created_at timestamptz not null default now(),
  unique (user_id, area)
);
grant select, insert, delete on public.user_areas to authenticated;
grant all on public.user_areas to service_role;
alter table public.user_areas enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_executive()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'executive')
$$;
create or replace function public.has_area(_area public.work_area)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_areas where user_id = auth.uid() and area = _area)
    and public.has_role(auth.uid(),'employee')
$$;

-- CREATORS
create table public.creators (
  id uuid primary key default gen_random_uuid(),
  stage_name text not null check (length(stage_name) between 1 and 120),
  legal_name text,
  email text,
  user_id uuid unique,
  status public.creator_status not null default 'lead',
  positioning text,
  objectives text,
  social_links jsonb not null default '[]'::jsonb,
  internal_notes text,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.creators to authenticated;
grant all on public.creators to service_role;
alter table public.creators enable row level security;

create table public.creator_assignments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  user_id uuid not null,
  area public.work_area not null,
  created_at timestamptz not null default now(),
  unique (creator_id, user_id, area)
);
grant select, insert, delete on public.creator_assignments to authenticated;
grant all on public.creator_assignments to service_role;
alter table public.creator_assignments enable row level security;

create or replace function public.can_access_creator(_creator_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_executive()
    or exists (select 1 from public.creator_assignments where creator_id = _creator_id and user_id = auth.uid())
    or (public.has_area('creator_management'))
$$;
create or replace function public.is_own_creator(_creator_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.creators where id = _creator_id and user_id = auth.uid())
$$;

-- TASKS
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  description text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  due_date date,
  creator_id uuid references public.creators(id) on delete set null,
  owner_id uuid,
  visible_to_creator boolean not null default false,
  source text not null default 'manual',
  dedupe_key text unique,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
create index on public.tasks (creator_id);
create index on public.tasks (owner_id);
create index on public.tasks (due_date);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.task_comments to authenticated;
grant all on public.task_comments to service_role;
alter table public.task_comments enable row level security;

create or replace function public.can_see_task(_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t where t.id = _task_id and (
      public.is_executive()
      or t.owner_id = auth.uid() or t.created_by = auth.uid()
      or (t.creator_id is not null and public.has_role(auth.uid(),'employee') and public.can_access_creator(t.creator_id))
      or (t.visible_to_creator and t.creator_id is not null and public.is_own_creator(t.creator_id))
    ))
$$;

-- FINANCE LEDGER
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  kind public.txn_kind not null,
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'USD',
  occurred_on date not null default current_date,
  category text not null default 'general',
  description text,
  creator_id uuid references public.creators(id) on delete restrict,
  agency_share_pct numeric(5,2) check (agency_share_pct between 0 and 100),
  external_ref text unique,
  shared_with_creator boolean not null default false,
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create index on public.transactions (occurred_on);
create index on public.transactions (creator_id);

-- AUDIT + NOTIFICATIONS
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
alter table public.audit_events enable row level security;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;

-- POLICIES
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_executive() or public.has_role(auth.uid(),'employee'));
create policy "profiles own update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles exec update" on public.profiles for update to authenticated using (public.is_executive());
create policy "profiles own insert" on public.profiles for insert to authenticated with check (id = auth.uid());

create policy "roles read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_executive());
create policy "roles exec insert" on public.user_roles for insert to authenticated with check (public.is_executive());
create policy "roles exec delete" on public.user_roles for delete to authenticated using (public.is_executive() and user_id <> auth.uid());

create policy "areas read" on public.user_areas for select to authenticated using (user_id = auth.uid() or public.is_executive());
create policy "areas exec insert" on public.user_areas for insert to authenticated with check (public.is_executive());
create policy "areas exec delete" on public.user_areas for delete to authenticated using (public.is_executive());

create policy "creators read" on public.creators for select to authenticated
  using ((public.has_role(auth.uid(),'employee') and public.can_access_creator(id)) or public.is_executive() or user_id = auth.uid());
create policy "creators insert" on public.creators for insert to authenticated
  with check (public.is_executive() or public.has_area('creator_management'));
create policy "creators update" on public.creators for update to authenticated
  using (public.is_executive() or public.has_area('creator_management'));
create policy "creators delete" on public.creators for delete to authenticated using (public.is_executive());

create policy "assign read" on public.creator_assignments for select to authenticated
  using (public.is_executive() or user_id = auth.uid() or public.has_area('creator_management'));
create policy "assign write" on public.creator_assignments for insert to authenticated
  with check (public.is_executive() or public.has_area('creator_management'));
create policy "assign delete" on public.creator_assignments for delete to authenticated
  using (public.is_executive() or public.has_area('creator_management'));

create policy "tasks read" on public.tasks for select to authenticated using (public.can_see_task(id));
create policy "tasks insert" on public.tasks for insert to authenticated
  with check ((public.is_executive() or public.has_role(auth.uid(),'employee'))
    and (creator_id is null or public.can_access_creator(creator_id)));
create policy "tasks update staff" on public.tasks for update to authenticated
  using (public.is_executive() or (public.has_role(auth.uid(),'employee') and public.can_see_task(id)));
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_executive() or created_by = auth.uid());

create policy "comments read" on public.task_comments for select to authenticated using (public.can_see_task(task_id));
create policy "comments insert" on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_task(task_id));
create policy "comments delete" on public.task_comments for delete to authenticated using (author_id = auth.uid());

create policy "txn exec read" on public.transactions for select to authenticated
  using (public.is_executive() or (shared_with_creator and creator_id is not null and public.is_own_creator(creator_id)));
create policy "txn exec insert" on public.transactions for insert to authenticated with check (public.is_executive());
create policy "txn exec update" on public.transactions for update to authenticated using (public.is_executive());

create policy "audit exec read" on public.audit_events for select to authenticated using (public.is_executive());

create policy "notif own read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif own update" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "notif own delete" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- TRIGGERS
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_creators before update on public.creators for each row execute function public.touch_updated_at();
create trigger t_tasks before update on public.tasks for each row execute function public.touch_updated_at();
create trigger t_txn before update on public.transactions for each row execute function public.touch_updated_at();

create or replace function public.task_completion() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then new.completed_at = now();
  elsif new.status <> 'done' then new.completed_at = null; end if;
  return new;
end $$;
create trigger t_task_done before insert or update on public.tasks for each row execute function public.task_completion();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  -- link to a creator record with matching email
  update public.creators set user_id = new.id where user_id is null and lower(email) = lower(new.email);
  if found then
    insert into public.user_roles (user_id, role) values (new.id, 'creator') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (actor_id, entity, entity_id, action, details)
  values (auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op),
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger a_txn after insert or update on public.transactions for each row execute function public.audit_row();
create trigger a_roles after insert or delete on public.user_roles for each row execute function public.audit_row();
create trigger a_areas after insert or delete on public.user_areas for each row execute function public.audit_row();
create trigger a_creators after insert or update or delete on public.creators for each row execute function public.audit_row();

-- Automation: onboarding tasks (idempotent via dedupe_key)
create or replace function public.creator_onboarding_tasks() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'onboarding' and (tg_op = 'INSERT' or old.status is distinct from 'onboarding') then
    insert into public.tasks (title, description, priority, due_date, creator_id, visible_to_creator, source, dedupe_key, created_by)
    values
      ('Complete profile & brand questionnaire', 'Fill in positioning, objectives and social accounts.', 'high', current_date + 3, new.id, true, 'automation:onboarding', 'onboarding:' || new.id || ':profile', new.created_by),
      ('Sign agency agreement', null, 'critical', current_date + 5, new.id, true, 'automation:onboarding', 'onboarding:' || new.id || ':agreement', new.created_by),
      ('Assign marketing & chatting team', 'Internal: assign team members to this creator.', 'high', current_date + 2, new.id, false, 'automation:onboarding', 'onboarding:' || new.id || ':team', new.created_by),
      ('Submit first content batch', null, 'medium', current_date + 10, new.id, true, 'automation:onboarding', 'onboarding:' || new.id || ':content', new.created_by)
    on conflict (dedupe_key) do nothing;
    insert into public.audit_events (actor_id, entity, entity_id, action, details)
    values (auth.uid(), 'automation', new.id, 'onboarding_tasks', jsonb_build_object('creator', new.stage_name));
  end if;
  return new;
end $$;
create trigger auto_onboarding after insert or update of status on public.creators for each row execute function public.creator_onboarding_tasks();

-- Creators may update status of their own visible tasks only
create or replace function public.creator_set_task_status(_task_id uuid, _status public.task_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tasks t where t.id = _task_id and t.visible_to_creator and public.is_own_creator(t.creator_id)) then
    raise exception 'Not allowed';
  end if;
  update public.tasks set status = _status where id = _task_id;
end $$;

-- First-run: first signed-in user becomes executive if none exist
create or replace function public.claim_first_executive()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.user_roles where role = 'executive') then return false; end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), 'executive');
  return true;
end $$;
create or replace function public.executives_exist()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where role = 'executive')
$$;
revoke execute on function public.claim_first_executive() from anon;
