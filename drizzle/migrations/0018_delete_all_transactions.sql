create or replace function public.delete_transaction(_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_id uuid;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can delete transactions';
  end if;

  delete from public.transactions
  where id = _id
  returning id into deleted_id;

  if deleted_id is null then
    raise exception using errcode = 'P0002', message = 'Transaction not found';
  end if;

  return deleted_id;
end;
$$;

revoke all on function public.delete_transaction(uuid) from public, anon;
grant execute on function public.delete_transaction(uuid) to authenticated;
