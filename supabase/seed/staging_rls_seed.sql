-- Synthetic staging seed for Komut 2 RLS/IDOR tests.
-- site_a / site_b, unit_a1 / unit_a2 / unit_b1, *@test.local only.
-- No production user ids, names, phones, IBANs, bank rows, or real PII.
-- Auth passwords are not stored in this file. Auth.users (if needed for SPA login)
-- are created by scripts/staging-seed-auth-users.mjs from gitignored env.

DELETE FROM public.debit_records;
DELETE FROM public.maintenance_requests;
DELETE FROM public.documents;
DELETE FROM public.announcements;
DELETE FROM public.personnel;
DELETE FROM public.unit_ownerships;
DELETE FROM public.unit_tenancies;
DELETE FROM public.property_owners;
DELETE FROM public.tenants;
DELETE FROM public.units;
DELETE FROM public.blocks;
DELETE FROM public.site_users;
DELETE FROM public.sites;
DELETE FROM public.companies;
DELETE FROM public.profiles;

INSERT INTO public.companies (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Test Firma');

-- site_a / site_b
INSERT INTO public.sites (id, name, status, company_id, created_by) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'site_a', 'active', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-0000000000b1', 'site_b', 'active', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000013');

INSERT INTO public.profiles (id, name, email, role, account_status, unit, block) VALUES
  ('00000000-0000-0000-0000-000000000011', 'Test Firma Yoneticisi', 'firma@test.local', 'Firma Yoneticisi', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-000000000012', 'Test Site A Yonetici', 'admin-a@test.local', 'Site Yoneticisi', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-000000000013', 'Test Site B Yonetici', 'admin-b@test.local', 'Site Yoneticisi', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-000000000014', 'Test Sakin A', 'sakin-a@test.local', 'Site Sakini', 'active', '1', 'A'),
  ('00000000-0000-0000-0000-000000000015', 'Test Sakin B', 'sakin-b@test.local', 'Site Sakini', 'active', '1', 'A'),
  ('00000000-0000-0000-0000-000000000016', 'Test Operasyon A', 'ops-a@test.local', 'operasyon', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-000000000017', 'Test Yetkisiz', 'none@test.local', 'Staff', 'active', NULL, NULL);

INSERT INTO public.site_users (site_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000011', 'admin'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000012', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000013', 'admin'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000014', 'sakin'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000015', 'sakin'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000016', 'operasyon');

INSERT INTO public.blocks (id, site_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'A');

-- unit_a1, unit_a2, unit_b1
INSERT INTO public.units (id, site_id, block_id, daire_no, malik_ad, kiraci_ad, kiraci_email) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000ba', '1', 'Test Malik A1', 'Test Sakin A', 'sakin-a@test.local'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000ba', '2', 'Test Malik A2', 'Test Diger Sakin', 'other-a@test.local'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', '1', 'Test Malik B1', 'Test Sakin B', 'sakin-b@test.local');

INSERT INTO public.property_owners (id, site_id, full_name, email, phone) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Test Malik A1', 'sakin-a@test.local', '5550000001'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Test Malik A2', 'malik-a2@test.local', '5550000002');

INSERT INTO public.unit_ownerships (unit_id, owner_id, is_active) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', true),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e2', true);

INSERT INTO public.debit_records (id, site_id, unit_id, amount, category, status) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000101', 100, 'aidat', 'pending'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000102', 999, 'aidat', 'pending'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000103', 50, 'aidat', 'pending');

INSERT INTO public.announcements (site_id, title) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Test duyuru site_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'Test duyuru site_b');

INSERT INTO public.maintenance_requests (id, site_id, unit_id, created_by, title) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000014', 'Test talep unit_a1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000012', 'Test talep unit_a2');

-- Storage objects are optional on hosted Supabase (bucket + extra NOT NULL columns).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('documents', 'documents', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    BEGIN
      INSERT INTO storage.objects (bucket_id, name)
      VALUES
        ('documents', '00000000-0000-0000-0000-0000000000a1/a.pdf'),
        ('documents', '00000000-0000-0000-0000-0000000000b1/b.pdf');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'staging storage seed skipped: %', SQLERRM;
    END;
  END IF;
END $$;
