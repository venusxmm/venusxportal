-- Forward-only change. Apply through the managed migration tool AFTER Cloud history reconciliation.
-- Existing creator revenue share is the payable; expenses remain agency costs.
CREATE OR REPLACE FUNCTION public.enforce_creator_payable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source uuid; cur text; earned numeric; paid numeric;
BEGIN
  -- Serialize ledger changes; prevents racing payouts or revenue edits from overspending.
  PERFORM pg_advisory_xact_lock(782341);
  IF NEW.amount <= 0 OR NEW.amount <> round(NEW.amount, 2) THEN
    RAISE EXCEPTION 'Amount must be positive with at most two decimal places';
  END IF;
  IF NEW.kind = 'payout' AND NEW.creator_id IS NULL THEN
    RAISE EXCEPTION 'Select the source creator for this payout';
  END IF;
  IF NEW.kind = 'payout' AND NOT EXISTS (SELECT 1 FROM public.creators WHERE id = NEW.creator_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Source creator is unavailable';
  END IF;
  FOR source, cur IN
    SELECT NEW.creator_id, NEW.currency::text
    UNION SELECT OLD.creator_id, OLD.currency::text WHERE TG_OP = 'UPDATE'
  LOOP
    IF source IS NULL THEN CONTINUE; END IF;
    SELECT coalesce(sum(round(round(amount * 100) * (100 - coalesce(agency_share_pct,100)) / 100)),0),
           coalesce(sum(CASE WHEN kind = 'payout' THEN round(amount * 100) ELSE 0 END),0)
    INTO earned, paid
    FROM public.transactions WHERE creator_id = source AND currency::text = cur
      AND archived_at IS NULL AND id <> NEW.id AND kind IN ('revenue','payout');
    -- Recompute earned separately so payout rows cannot contribute revenue.
    SELECT coalesce(sum(round(amount * 100) - round(round(amount * 100) * coalesce(agency_share_pct,100) / 100)),0)
      INTO earned FROM public.transactions
      WHERE creator_id = source AND currency::text = cur AND archived_at IS NULL
        AND id <> NEW.id AND kind = 'revenue';
    IF NEW.archived_at IS NULL AND NEW.creator_id = source AND NEW.currency::text = cur THEN
      IF NEW.kind = 'revenue' THEN
        earned := earned + round(NEW.amount * 100) - round(round(NEW.amount * 100) * coalesce(NEW.agency_share_pct,100) / 100);
      ELSIF NEW.kind = 'payout' THEN paid := paid + round(NEW.amount * 100); END IF;
    END IF;
    IF paid > earned THEN RAISE EXCEPTION 'Payout exceeds the source creator available earned share'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_creator_payable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_creator_payable BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_creator_payable();

CREATE OR REPLACE FUNCTION public.post_creator_payout(
  _id uuid, _creator_id uuid, _amount numeric, _currency text, _occurred_on date,
  _category text, _description text DEFAULT NULL, _external_ref text DEFAULT NULL,
  _shared_with_creator boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.transactions;
BEGIN
  IF NOT public.is_executive() THEN RAISE EXCEPTION 'Only executives can post payouts'; END IF;
  IF _id IS NULL OR _creator_id IS NULL OR _amount IS NULL OR _amount <= 0
    OR _currency NOT IN ('USD','EUR','COP') OR _currency IS NULL
    OR _occurred_on IS NULL OR length(trim(coalesce(_category,''))) = 0 THEN
    RAISE EXCEPTION 'Valid payout id, source creator, amount, currency, date and category are required';
  END IF;
  PERFORM pg_advisory_xact_lock(782341);
  SELECT * INTO existing FROM public.transactions WHERE id = _id;
  IF FOUND THEN
    IF existing.created_by IS DISTINCT FROM auth.uid() OR existing.kind <> 'payout'
      OR existing.creator_id IS DISTINCT FROM _creator_id OR existing.amount IS DISTINCT FROM _amount
      OR existing.currency::text IS DISTINCT FROM _currency OR existing.occurred_on IS DISTINCT FROM _occurred_on
      OR existing.category IS DISTINCT FROM trim(_category)
      OR existing.description IS DISTINCT FROM _description
      OR existing.external_ref IS DISTINCT FROM _external_ref
      OR existing.shared_with_creator IS DISTINCT FROM _shared_with_creator
      OR existing.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Payout retry does not match the original entry'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO public.transactions(id,kind,creator_id,amount,currency,occurred_on,category,description,external_ref,shared_with_creator,created_by)
    VALUES (_id,'payout',_creator_id,_amount,_currency,_occurred_on,trim(_category),_description,_external_ref,_shared_with_creator,auth.uid());
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.post_creator_payout(uuid,uuid,numeric,text,date,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_creator_payout(uuid,uuid,numeric,text,date,text,text,text,boolean) TO authenticated;
-- Retain financial rows: void/restore through UPDATE, never hard-delete.
REVOKE DELETE ON public.transactions FROM authenticated;