create or replace function public.post_creator_payout(
  _id uuid,
  _creator_id uuid,
  _amount numeric,
  _currency text,
  _occurred_on date,
  _category text,
  _description text default null,
  _external_ref text default null,
  _shared_with_creator boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.transactions;
begin
  if not public.is_executive() then
    raise exception using errcode = '42501', message = 'Only executives can post payouts';
  end if;

  if _id is null
    or _creator_id is null
    or _amount is null
    or _amount <= 0
    or _amount <> round(_amount, 2)
    or _currency is null
    or _currency not in ('USD', 'EUR', 'COP')
    or _occurred_on is null
    or length(trim(coalesce(_category, ''))) = 0
    or _shared_with_creator is null
  then
    raise exception using
      errcode = '22023',
      message = 'Valid payout id, source creator, amount, currency, date and category are required';
  end if;

  perform pg_advisory_xact_lock(782341, hashtext(_id::text));

  select *
  into existing
  from public.transactions
  where id = _id;

  if found then
    if existing.created_by is distinct from auth.uid()
      or existing.kind <> 'payout'
      or existing.creator_id is distinct from _creator_id
      or existing.amount is distinct from _amount
      or existing.currency::text is distinct from _currency
      or existing.occurred_on is distinct from _occurred_on
      or existing.category is distinct from trim(_category)
      or existing.description is distinct from _description
      or existing.external_ref is distinct from _external_ref
      or existing.shared_with_creator is distinct from _shared_with_creator
      or existing.archived_at is not null
    then
      raise exception using errcode = '23505', message = 'Payout retry does not match the original entry';
    end if;
    return existing.id;
  end if;

  perform 1
  from public.creators
  where id = _creator_id and archived_at is null
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Source creator is unavailable';
  end if;

  insert into public.transactions (
    id,
    kind,
    creator_id,
    amount,
    currency,
    occurred_on,
    category,
    description,
    external_ref,
    shared_with_creator,
    created_by
  )
  values (
    _id,
    'payout',
    _creator_id,
    _amount,
    _currency,
    _occurred_on,
    trim(_category),
    _description,
    _external_ref,
    _shared_with_creator,
    auth.uid()
  );

  return _id;
end;
$$;

revoke all on function public.post_creator_payout(uuid, uuid, numeric, text, date, text, text, text, boolean)
  from public, anon;
grant execute on function public.post_creator_payout(uuid, uuid, numeric, text, date, text, text, text, boolean)
  to authenticated;
