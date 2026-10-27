ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_platform text,
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS external_type text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external_source_key
  ON public.transactions (source, external_platform, external_account_id, external_ref)
  WHERE source <> 'manual';

CREATE TABLE public.onlymonster_accounts (
  id text PRIMARY KEY,
  platform text NOT NULL,
  platform_account_id text NOT NULL,
  name text,
  username text,
  creator_id uuid REFERENCES public.creators(id) ON DELETE RESTRICT,
  agency_share_pct numeric CHECK (agency_share_pct >= 0 AND agency_share_pct <= 100),
  currency character(3) NOT NULL DEFAULT 'USD',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_account_id)
);
GRANT SELECT, INSERT, UPDATE ON public.onlymonster_accounts TO authenticated;
GRANT ALL ON public.onlymonster_accounts TO service_role;
ALTER TABLE public.onlymonster_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "om accounts exec read" ON public.onlymonster_accounts FOR SELECT TO authenticated USING (public.is_executive());
CREATE POLICY "om accounts exec update" ON public.onlymonster_accounts FOR UPDATE TO authenticated USING (public.is_executive()) WITH CHECK (public.is_executive());

CREATE TABLE public.integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  trigger text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  voided integer NOT NULL DEFAULT 0,
  fetched integer NOT NULL DEFAULT 0,
  error text,
  actor_id uuid
);
GRANT SELECT ON public.integration_sync_runs TO authenticated;
GRANT ALL ON public.integration_sync_runs TO service_role;
ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync runs exec read" ON public.integration_sync_runs FOR SELECT TO authenticated USING (public.is_executive());