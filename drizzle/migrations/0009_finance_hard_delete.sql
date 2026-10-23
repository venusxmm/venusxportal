grant delete on public.transactions to authenticated;
create policy "txn exec delete" on public.transactions for delete to authenticated
  using (public.is_executive());

drop trigger if exists a_txn on public.transactions;
create trigger a_txn after insert or update or delete on public.transactions
  for each row execute function public.audit_row();
