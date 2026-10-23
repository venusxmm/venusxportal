alter table public.transactions
  add column if not exists deduct_from_agency_cut boolean not null default true;

alter table public.transactions
  alter column deduct_from_agency_cut set default true;

update public.transactions
set deduct_from_agency_cut = true
where deduct_from_agency_cut is null;

alter table public.transactions
  alter column deduct_from_agency_cut set not null;

comment on column public.transactions.deduct_from_agency_cut is
  'Whether an expense reduces agency net profit. Defaults to true to preserve prior ledger behavior.';

create or replace function public.delete_expense(_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_id uuid;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can delete expenses';
  end if;

  delete from public.transactions
  where id = _id and kind = 'expense'
  returning id into deleted_id;

  if deleted_id is null then
    raise exception using errcode = 'P0002', message = 'Expense not found';
  end if;

  return deleted_id;
end;
$$;

revoke all on function public.delete_expense(uuid) from public, anon;
grant execute on function public.delete_expense(uuid) to authenticated;
