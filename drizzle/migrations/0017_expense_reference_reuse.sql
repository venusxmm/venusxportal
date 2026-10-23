alter table public.transactions
  drop constraint if exists transactions_external_ref_key;

create unique index if not exists transactions_non_expense_external_ref_key
  on public.transactions (external_ref)
  where kind <> 'expense' and external_ref is not null;
