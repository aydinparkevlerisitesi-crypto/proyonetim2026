-- Staging-only bootstrap for an empty Supabase project.
-- No production dump. No public.residents table.
-- Staging empty-DB bootstrap only. Do not apply to the production Supabase project.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  name text,
  email text,
  role text,
  sakin_id text,
  block text,
  unit text,
  account_status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY,
  name text
);

CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY,
  name text,
  status text DEFAULT 'active',
  company_id uuid,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  name text
);

CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  block_id uuid,
  daire_no text,
  malik_ad text,
  kiraci_ad text,
  kiraci_email text,
  malik_bakiye numeric DEFAULT 0,
  kiraci_bakiye numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.property_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  full_name text,
  email text,
  phone text,
  status text DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  unit_id uuid,
  first_name text,
  last_name text,
  email text,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.unit_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.unit_tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.debit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  unit_id uuid,
  user_id uuid,
  amount numeric,
  paid_amount numeric DEFAULT 0,
  category text,
  status text
);

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  title text,
  uploaded_by uuid
);

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  unit_id uuid,
  created_by uuid,
  title text
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  title text
);

CREATE TABLE IF NOT EXISTS public.personnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  full_name text
);

CREATE TABLE IF NOT EXISTS public.login_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid
);

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
