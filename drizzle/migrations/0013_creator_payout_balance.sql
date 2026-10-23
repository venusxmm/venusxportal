create or replace function public.enforce_creator_payout_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_creator uuid;
  old_currency text;
  old_kind text;
  old_archived_at timestamptz;
  old_id uuid;
  new_creator uuid;
  new_currency text;
  new_kind text;
  new_archived_at timestamptz;
  new_amount numeric;
  new_share_pct numeric;
  account record;
  balance_cents numeric;
begin
  if tg_op <> 'INSERT' then
    old_creator := old.creator_id;
    old_currency := old.currency;
    old_kind := old.kind::text;
    old_archived_at := old.archived_at;
    old_id := old.id;
  end if;

  if tg_op <> 'DELETE' then
    new_creator := new.creator_id;
    new_currency := new.currency;
    new_kind := new.kind::text;
    new_archived_at := new.archived_at;
    new_amount := new.amount;
    new_share_pct := new.agency_share_pct;
  end if;

  if tg_op <> 'DELETE'
    and new_kind = 'payout'
    and new_archived_at is null
    and new_creator is null
  then
    raise exception using
      errcode = '23514',
      message = 'Select the creator receiving this payout.';
  end if;

  perform c.id
  from public.creators c
  where c.id in (old_creator, new_creator)
  order by c.id
  for update;

  for account in
    select distinct affected.creator_id, affected.currency
    from (
      values
        (old_creator, old_currency, old_kind, old_archived_at),
        (new_creator, new_currency, new_kind, new_archived_at)
    ) as affected(creator_id, currency, kind, archived_at)
    where affected.creator_id is not null
      and affected.kind in ('revenue', 'payout')
      and affected.archived_at is null
  loop
    select coalesce(
      sum(
        case
          when t.kind = 'revenue' then
            round(t.amount * 100)
            - round(round(t.amount * 100) * coalesce(t.agency_share_pct, 100) / 100)
          when t.kind = 'payout' then -round(t.amount * 100)
          else 0
        end
      ),
      0
    )
    into balance_cents
    from public.transactions t
    where t.creator_id = account.creator_id
      and t.currency = account.currency
      and t.archived_at is null
      and (old_id is null or t.id <> old_id);

    if tg_op <> 'DELETE'
      and new_creator = account.creator_id
      and new_currency = account.currency
      and new_archived_at is null
    then
      if new_kind = 'revenue' then
        balance_cents := balance_cents
          + round(new_amount * 100)
          - round(round(new_amount * 100) * coalesce(new_share_pct, 100) / 100);
      elsif new_kind = 'payout' then
        balance_cents := balance_cents - round(new_amount * 100);
      end if;
    end if;

    if balance_cents < 0 then
      if tg_op <> 'DELETE' and new_kind = 'payout' then
        raise exception using
          errcode = '23514',
          message = 'Payout exceeds the selected creator''s available earned balance.';
      end if;
      raise exception using
        errcode = '23514',
        message = 'This transaction change would leave the creator''s earned balance below zero.';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.enforce_creator_payout_balance() from public, anon, authenticated;

drop trigger if exists a_payout_balance_guard on public.transactions;
create trigger a_payout_balance_guard
before insert or update or delete on public.transactions
for each row execute function public.enforce_creator_payout_balance();
