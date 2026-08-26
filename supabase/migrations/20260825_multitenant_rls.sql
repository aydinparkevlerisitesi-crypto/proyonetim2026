-- Komut 2 — Multi-tenant RLS (site_users + auth.uid)
-- Idempotent. Tabloları DROP etmez. Satır silmez.
-- Eski tenant_* politikalarını aynı tablolarda yenileriyle değiştirir (PERMISSIVE OR sızıntısını önlemek için).
-- Production'da backup + kullanıcı onayı olmadan uygulamayın. Staging DB = canlı Supabase ise ayrı onay gerekir.

CREATE OR REPLACE FUNCTION public.mt_norm_role(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(replace(replace(replace(coalesce(raw, ''), ' ', ''), '_', ''), '-', ''));
$$;

-- ── Mevcut superadmin / company-admin yardımcıları korunur (rol eşlemesi Komut 3) ──
CREATE OR REPLACE FUNCTION public.is_platform_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        lower(replace(coalesce(p.role, ''), ' ', '')) LIKE '%superadmin%'
        OR lower(replace(coalesce(p.role, ''), ' ', '')) = 'super_admin'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_member_site_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- site_users canlı kolonları: id, site_id, user_id, role, created_at (is_active yok)
  SELECT su.site_id
  FROM public.site_users su
  WHERE su.user_id = auth.uid()
    AND su.site_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT s.company_id
  FROM public.sites s
  WHERE s.company_id IS NOT NULL
    AND s.id IN (SELECT public.user_member_site_ids());
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        lower(replace(coalesce(p.role, ''), ' ', '')) LIKE '%firmayoneticisi%'
        OR lower(replace(coalesce(p.role, ''), ' ', '')) = 'firma'
        OR lower(replace(coalesce(p.role, ''), ' ', '')) LIKE '%company_admin%'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_scoped_site_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Üyelik + mevcut ürünün firma-yöneticisi genişlemesi (üye olunan şirketlerin siteleri).
  -- profiles.company_id ile genişletilmez: kullanıcı kendi profilini güncelleyebilir.
  SELECT public.user_member_site_ids()
  UNION
  SELECT s.id
  FROM public.sites s
  WHERE public.is_company_admin()
    AND s.company_id IN (SELECT public.user_company_ids());
$$;

CREATE OR REPLACE FUNCTION public.user_has_site_access(target_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  acct text;
BEGIN
  IF uid IS NULL OR target_site_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_platform_superadmin() THEN
    RETURN true;
  END IF;

  -- Recursive RLS yok: bu fonksiyon DEFINER; site_users/profiles okuması invoker RLS'ini tetiklemez.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    SELECT lower(coalesce(p.account_status, ''))
      INTO acct
    FROM public.profiles p
    WHERE p.id = uid;
    IF acct IN ('suspended', 'cancelled', 'disabled', 'blocked') THEN
      RETURN false;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_scoped_site_ids() AS sid
    WHERE sid = target_site_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_site_access_txt(target_site_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_site_id IS NULL OR btrim(target_site_id) = '' THEN
    RETURN false;
  END IF;
  BEGIN
    RETURN public.user_has_site_access(target_site_id::uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_resident_on_site(target_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mem_role text;
  nr text;
  pr text;
BEGIN
  IF uid IS NULL OR target_site_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_superadmin() THEN
    RETURN false;
  END IF;
  IF public.is_company_admin() THEN
    RETURN false;
  END IF;

  SELECT su.role INTO mem_role
  FROM public.site_users su
  WHERE su.user_id = uid AND su.site_id = target_site_id
  LIMIT 1;

  nr := public.mt_norm_role(mem_role);
  IF nr IN (
    'admin', 'staff', 'siteadmin', 'yonetici', 'siteyoneticisi',
    'muhasebe', 'muhasebeci', 'operasyon', 'operasyonel',
    'firma', 'firmayoneticisi', 'companyadmin', 'superadmin', 'superadminn'
  ) THEN
    RETURN false;
  END IF;
  IF nr IN ('sakin', 'sitesakini', 'resident', 'malik', 'kiraci', 'homeowner', 'occupant', 'tenant') THEN
    RETURN true;
  END IF;

  SELECT public.mt_norm_role(p.role) INTO pr
  FROM public.profiles p
  WHERE p.id = uid;
  IF pr LIKE '%sakin%' OR pr LIKE '%resident%' THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_staff_on_site(target_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_site_access(target_site_id)
     AND NOT public.user_is_resident_on_site(target_site_id);
$$;

CREATE OR REPLACE FUNCTION public.user_is_staff_on_site_txt(target_site_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_site_id IS NULL OR btrim(target_site_id) = '' THEN
    RETURN false;
  END IF;
  BEGIN
    RETURN public.user_is_staff_on_site(target_site_id::uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_site_membership(target_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  nr text;
BEGIN
  IF uid IS NULL OR target_site_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_superadmin() THEN
    RETURN true;
  END IF;
  IF public.is_company_admin() AND public.user_has_site_access(target_site_id) THEN
    RETURN true;
  END IF;
  IF NOT public.user_has_site_access(target_site_id) THEN
    RETURN false;
  END IF;
  SELECT public.mt_norm_role(su.role) INTO nr
  FROM public.site_users su
  WHERE su.user_id = uid AND su.site_id = target_site_id
  LIMIT 1;
  RETURN nr IN (
    'admin', 'staff', 'siteadmin', 'yonetici', 'siteyoneticisi',
    'firma', 'firmayoneticisi', 'companyadmin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_auth_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(btrim(coalesce(
    auth.jwt() ->> 'email',
    (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    ''
  )));
$$;

CREATE OR REPLACE FUNCTION public.user_resident_unit_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  em text := public.mt_auth_email();
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.units') IS NOT NULL THEN
    RETURN QUERY
    SELECT u.id
    FROM public.units u
    WHERE public.user_has_site_access(u.site_id)
      AND public.user_is_resident_on_site(u.site_id)
      AND (
        (em <> '' AND lower(btrim(coalesce(u.kiraci_email, ''))) = em)
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = uid
            AND p.sakin_id IS NOT NULL
            AND p.sakin_id::text = u.id::text
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          LEFT JOIN public.blocks b ON b.id = u.block_id
          WHERE p.id = uid
            AND coalesce(p.unit, '') <> ''
            AND btrim(u.daire_no::text) = btrim(p.unit::text)
            AND (
              coalesce(p.block, '') = ''
              OR b.name ILIKE ('%' || p.block || '%')
            )
        )
      );
  END IF;

  IF to_regclass('public.unit_ownerships') IS NOT NULL
     AND to_regclass('public.property_owners') IS NOT NULL
     AND em <> '' THEN
    RETURN QUERY
    SELECT uo.unit_id
    FROM public.unit_ownerships uo
    JOIN public.property_owners po ON po.id = uo.owner_id
    JOIN public.units u ON u.id = uo.unit_id
    WHERE coalesce(uo.is_active, true)
      AND public.user_has_site_access(u.site_id)
      AND public.user_is_resident_on_site(u.site_id)
      AND lower(btrim(coalesce(po.email, ''))) = em;
  END IF;

  IF to_regclass('public.unit_tenancies') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND em <> '' THEN
    RETURN QUERY
    SELECT ut.unit_id
    FROM public.unit_tenancies ut
    JOIN public.tenants tn ON tn.id = ut.tenant_id
    JOIN public.units u ON u.id = ut.unit_id
    WHERE coalesce(ut.is_active, true)
      AND public.user_has_site_access(u.site_id)
      AND public.user_is_resident_on_site(u.site_id)
      AND lower(btrim(coalesce(tn.email, ''))) = em;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_resident_owns_unit(target_unit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_unit_id IS NOT NULL
     AND target_unit_id IN (SELECT public.user_resident_unit_ids());
$$;

-- Background/job helper: service_role RLS'i bypass eder; actor + site zorunlu.
CREATE OR REPLACE FUNCTION public.mt_assert_actor_site_access(p_actor uuid, p_site uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL OR p_site IS NULL THEN
    RAISE EXCEPTION 'TENANT_SCOPE_DENIED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_actor
      AND (
        lower(replace(coalesce(p.role, ''), ' ', '')) LIKE '%superadmin%'
        OR lower(replace(coalesce(p.role, ''), ' ', '')) = 'super_admin'
      )
  ) THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.site_users su
    WHERE su.user_id = p_actor AND su.site_id = p_site
  ) THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'TENANT_SCOPE_DENIED';
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_drop_known_policies(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RETURN;
  END IF;
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = p_table
      AND (
        policyname LIKE 'tenant_%'
        OR policyname LIKE 'mt_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, p_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_apply_direct_site_policies(p_table text, p_mode text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  has_site boolean;
  has_unit boolean;
  has_created boolean;
  has_user boolean;
  has_req boolean;
  has_upload boolean;
  site_expr text;
  unit_expr text;
  own_expr text := 'false';
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'site_id'
  ) INTO has_site;
  IF NOT has_site THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'unit_id'
  ) INTO has_unit;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'created_by'
  ) INTO has_created;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'user_id'
  ) INTO has_user;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'requester_id'
  ) INTO has_req;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'uploaded_by'
  ) INTO has_upload;

  site_expr := 'public.user_has_site_access(site_id)';
  unit_expr := CASE WHEN has_unit THEN 'public.mt_resident_owns_unit(unit_id)' ELSE 'false' END;
  own_expr := 'false';
  IF has_created THEN
    own_expr := own_expr || ' OR created_by = auth.uid()';
  END IF;
  IF has_user THEN
    own_expr := own_expr || ' OR user_id = auth.uid()';
  END IF;
  IF has_req THEN
    own_expr := own_expr || ' OR requester_id = auth.uid()';
  END IF;
  IF has_upload THEN
    own_expr := own_expr || ' OR uploaded_by = auth.uid()';
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  PERFORM public.mt_drop_known_policies(p_table);

  -- Staff (ve superadmin) tam site kapsamı
  EXECUTE format(
    'CREATE POLICY mt_%s_staff_select ON public.%I FOR SELECT TO authenticated USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))',
    p_table, p_table
  );
  EXECUTE format(
    'CREATE POLICY mt_%s_staff_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))',
    p_table, p_table
  );
  EXECUTE format(
    'CREATE POLICY mt_%s_staff_update ON public.%I FOR UPDATE TO authenticated USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id)) WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))',
    p_table, p_table
  );
  EXECUTE format(
    'CREATE POLICY mt_%s_staff_delete ON public.%I FOR DELETE TO authenticated USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))',
    p_table, p_table
  );

  IF p_mode = 'staff_full' THEN
    RETURN;
  END IF;

  IF p_mode = 'resident_site_read' THEN
    EXECUTE format(
      'CREATE POLICY mt_%s_resident_select ON public.%I FOR SELECT TO authenticated USING (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id))',
      p_table, p_table
    );
    RETURN;
  END IF;

  IF p_mode = 'resident_unit' THEN
    EXECUTE format(
      'CREATE POLICY mt_%s_resident_select ON public.%I FOR SELECT TO authenticated USING (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id) AND (%s OR %s))',
      p_table, p_table, unit_expr, own_expr
    );
    RETURN;
  END IF;

  IF p_mode = 'resident_unit_write' THEN
    EXECUTE format(
      'CREATE POLICY mt_%s_resident_select ON public.%I FOR SELECT TO authenticated USING (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id) AND (%s OR %s))',
      p_table, p_table, unit_expr, own_expr
    );
    EXECUTE format(
      'CREATE POLICY mt_%s_resident_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id) AND (%s OR %s OR unit_id IS NULL))',
      p_table, p_table, unit_expr, own_expr
    );
    EXECUTE format(
      'CREATE POLICY mt_%s_resident_update ON public.%I FOR UPDATE TO authenticated USING (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id) AND (%s OR %s)) WITH CHECK (public.user_has_site_access(site_id) AND public.user_is_resident_on_site(site_id) AND (%s OR %s))',
      p_table, p_table, unit_expr, own_expr, unit_expr, own_expr
    );
  END IF;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  -- Personel/finans/banka/WhatsApp veri tabloları: sakin yok
  FOREACH t IN ARRAY ARRAY[
    'bank_accounts','bank_cards','bank_integrations','bank_transactions','bank_reconciliation',
    'bank_credentials','bank_providers','bank_sync_logs','bank_sync_runs','bank_webhook_events',
    'bank_application_packages','bank_form_library','bank_qr_sessions',
    'cash_accounts','cash_movements','checks','reserve_funds','budget_items','gl_codes',
    'income_expense_records','accounting_plan','payment_records','transfers',
    'personnel_payroll','personnel_leave','personnel_attendance','personnel_overtime','personnel_performance',
    'personnel_security_profile','security_posts','security_cameras','security_access_points',
    'security_access_logs','security_turnstiles','security_turnstile_logs','security_plate_records',
    'pdks_checkpoints','pdks_events','shift_plan_slots','patrol_routes','patrol_checkpoints','patrol_logs',
    'site_shift_settings','workflow_tasks','vendors','legal_attorneys','legal_notices','legal_notice_deliveries',
    'legal_notification_logs','eviction_calendar','system_logs','system_backups','system_license','system_settings',
    'permission_assignments','permission_roles','developer_api_keys','whatsapp_sessions','whatsapp_accounts',
    'whatsapp_message_archive','whatsapp_message_logs','whatsapp_messages','whatsapp_templates','whatsapp_webhook_events',
    'whatsapp_company_instances','kep_integration_settings','kep_messages','white_label_settings',
    'night_audit_results','task_queue','message_queue','notification_queue','notification_delivery_logs',
    'ai_agent_logs','voice_assistant_logs','tenant_risk_scores','unmatched_iban_events',
    'bank_reconciliation_expenses','bank_reconciliation_matches','bank_reconciliation_rules',
    'bank_accounts_routing','bank_integration_agreements','bank_integration_audit_logs',
    'debit_responsibility_assignments'
  ]
  LOOP
    PERFORM public.mt_apply_direct_site_policies(t, 'staff_full');
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'announcements','polls','events','personnel','dues_types','reservations',
    'website_settings','website_banners','website_newsletters','website_social_media',
    'website_analytics','website_monthly_visitors','local_places','marketing_settings'
  ]
  LOOP
    PERFORM public.mt_apply_direct_site_policies(t, 'resident_site_read');
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'debit_records','debit_items','late_fee_records','late_fee_settings','leases','lease_contracts',
    'property_owners','tenants','resident_notes','resident_vehicles','resident_consents','household_info',
    'meter_readings','documents','violations','inspections','board_members','board_decisions',
    'meeting_minutes','move_workflows','deposits','communication_messages','communication_templates',
    'kvkk_applications','kvkk_texts','unit_security_packages','unit_security_sensors','visitor_logs',
    'contact_requests','newsletter_subscribers'
  ]
  LOOP
    PERFORM public.mt_apply_direct_site_policies(t, 'resident_unit');
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'maintenance_requests','resident_tasks','resident_complaints'
  ]
  LOOP
    PERFORM public.mt_apply_direct_site_policies(t, 'resident_unit_write');
  END LOOP;
END $$;

-- ── units: sakin yalnız kendi dairesi ──
DO $$
BEGIN
  IF to_regclass('public.units') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
  PERFORM public.mt_drop_known_policies('units');
  CREATE POLICY mt_units_staff_select ON public.units
    FOR SELECT TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_units_resident_select ON public.units
    FOR SELECT TO authenticated
    USING (
      public.user_has_site_access(site_id)
      AND public.user_is_resident_on_site(site_id)
      AND public.mt_resident_owns_unit(id)
    );
  CREATE POLICY mt_units_staff_insert ON public.units
    FOR INSERT TO authenticated
    WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_units_staff_update ON public.units
    FOR UPDATE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))
    WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_units_staff_delete ON public.units
    FOR DELETE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
END $$;

-- ── blocks: sakin yalnız kendi bloğu ──
DO $$
BEGIN
  IF to_regclass('public.blocks') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
  PERFORM public.mt_drop_known_policies('blocks');
  CREATE POLICY mt_blocks_staff_select ON public.blocks
    FOR SELECT TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_blocks_resident_select ON public.blocks
    FOR SELECT TO authenticated
    USING (
      public.user_has_site_access(site_id)
      AND public.user_is_resident_on_site(site_id)
      AND id IN (
        SELECT u.block_id FROM public.units u
        WHERE public.mt_resident_owns_unit(u.id)
      )
    );
  CREATE POLICY mt_blocks_staff_insert ON public.blocks
    FOR INSERT TO authenticated
    WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_blocks_staff_update ON public.blocks
    FOR UPDATE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id))
    WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  CREATE POLICY mt_blocks_staff_delete ON public.blocks
    FOR DELETE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
END $$;

-- ── sites ──
DO $$
BEGIN
  IF to_regclass('public.sites') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
  PERFORM public.mt_drop_known_policies('sites');
  CREATE POLICY mt_sites_select ON public.sites
    FOR SELECT TO authenticated
    USING (public.is_platform_superadmin() OR public.user_has_site_access(id));
  CREATE POLICY mt_sites_insert ON public.sites
    FOR INSERT TO authenticated
    WITH CHECK (public.is_platform_superadmin() OR public.user_can_manage_site_membership(id) OR created_by = auth.uid());
  CREATE POLICY mt_sites_update ON public.sites
    FOR UPDATE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(id))
    WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(id));
  CREATE POLICY mt_sites_delete ON public.sites
    FOR DELETE TO authenticated
    USING (public.is_platform_superadmin() OR public.user_can_manage_site_membership(id));
END $$;

-- ── site_users: sakin yalnız kendi üyeliğini görür; yazma yönetici ──
DO $$
BEGIN
  IF to_regclass('public.site_users') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.site_users ENABLE ROW LEVEL SECURITY;
  PERFORM public.mt_drop_known_policies('site_users');
  CREATE POLICY mt_site_users_select ON public.site_users
    FOR SELECT TO authenticated
    USING (
      public.is_platform_superadmin()
      OR user_id = auth.uid()
      OR public.user_is_staff_on_site(site_id)
    );
  CREATE POLICY mt_site_users_insert ON public.site_users
    FOR INSERT TO authenticated
    WITH CHECK (public.user_can_manage_site_membership(site_id) OR public.is_platform_superadmin());
  CREATE POLICY mt_site_users_update ON public.site_users
    FOR UPDATE TO authenticated
    USING (public.user_can_manage_site_membership(site_id) OR public.is_platform_superadmin())
    WITH CHECK (public.user_can_manage_site_membership(site_id) OR public.is_platform_superadmin());
  CREATE POLICY mt_site_users_delete ON public.site_users
    FOR DELETE TO authenticated
    USING (public.user_can_manage_site_membership(site_id) OR public.is_platform_superadmin());
END $$;

-- ── Junction: unit_ownerships / unit_tenancies / ownership_history ──
DO $$
BEGIN
  IF to_regclass('public.unit_ownerships') IS NOT NULL THEN
    ALTER TABLE public.unit_ownerships ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('unit_ownerships');
    CREATE POLICY mt_unit_ownerships_staff_select ON public.unit_ownerships
      FOR SELECT TO authenticated
      USING (
        public.is_platform_superadmin()
        OR unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id))
      );
    CREATE POLICY mt_unit_ownerships_resident_select ON public.unit_ownerships
      FOR SELECT TO authenticated
      USING (public.mt_resident_owns_unit(unit_id));
    CREATE POLICY mt_unit_ownerships_staff_write_ins ON public.unit_ownerships
      FOR INSERT TO authenticated
      WITH CHECK (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
    CREATE POLICY mt_unit_ownerships_staff_write_upd ON public.unit_ownerships
      FOR UPDATE TO authenticated
      USING (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)))
      WITH CHECK (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
    CREATE POLICY mt_unit_ownerships_staff_write_del ON public.unit_ownerships
      FOR DELETE TO authenticated
      USING (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
  END IF;

  IF to_regclass('public.unit_tenancies') IS NOT NULL THEN
    ALTER TABLE public.unit_tenancies ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('unit_tenancies');
    CREATE POLICY mt_unit_tenancies_staff_select ON public.unit_tenancies
      FOR SELECT TO authenticated
      USING (
        public.is_platform_superadmin()
        OR unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id))
      );
    CREATE POLICY mt_unit_tenancies_resident_select ON public.unit_tenancies
      FOR SELECT TO authenticated
      USING (public.mt_resident_owns_unit(unit_id));
    CREATE POLICY mt_unit_tenancies_staff_ins ON public.unit_tenancies
      FOR INSERT TO authenticated
      WITH CHECK (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
    CREATE POLICY mt_unit_tenancies_staff_upd ON public.unit_tenancies
      FOR UPDATE TO authenticated
      USING (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)))
      WITH CHECK (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
    CREATE POLICY mt_unit_tenancies_staff_del ON public.unit_tenancies
      FOR DELETE TO authenticated
      USING (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
  END IF;

  IF to_regclass('public.ownership_history') IS NOT NULL THEN
    ALTER TABLE public.ownership_history ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('ownership_history');
    CREATE POLICY mt_ownership_history_select ON public.ownership_history
      FOR SELECT TO authenticated
      USING (
        public.is_platform_superadmin()
        OR unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id))
        OR public.mt_resident_owns_unit(unit_id)
      );
    CREATE POLICY mt_ownership_history_write ON public.ownership_history
      FOR ALL TO authenticated
      USING (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)))
      WITH CHECK (unit_id IN (SELECT u.id FROM public.units u WHERE public.user_is_staff_on_site(u.site_id)));
  END IF;
END $$;

-- property_owners has no unit_id; sakin e-posta ile kendi kartını görür
DO $$
BEGIN
  IF to_regclass('public.property_owners') IS NOT NULL THEN
    DROP POLICY IF EXISTS mt_property_owners_resident_email ON public.property_owners;
    CREATE POLICY mt_property_owners_resident_email ON public.property_owners
      FOR SELECT TO authenticated
      USING (
        public.user_has_site_access(site_id)
        AND public.user_is_resident_on_site(site_id)
        AND public.mt_auth_email() <> ''
        AND lower(btrim(coalesce(email, ''))) = public.mt_auth_email()
      );
  END IF;
END $$;

-- poll_options / poll_votes / notifications
DO $$
BEGIN
  IF to_regclass('public.poll_options') IS NOT NULL AND to_regclass('public.polls') IS NOT NULL THEN
    ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('poll_options');
    CREATE POLICY mt_poll_options_select ON public.poll_options
      FOR SELECT TO authenticated
      USING (
        poll_id IN (
          SELECT p.id FROM public.polls p
          WHERE public.user_has_site_access(p.site_id)
        )
      );
    CREATE POLICY mt_poll_options_write ON public.poll_options
      FOR ALL TO authenticated
      USING (
        poll_id IN (SELECT p.id FROM public.polls p WHERE public.user_is_staff_on_site(p.site_id))
      )
      WITH CHECK (
        poll_id IN (SELECT p.id FROM public.polls p WHERE public.user_is_staff_on_site(p.site_id))
      );
  END IF;

  IF to_regclass('public.poll_votes') IS NOT NULL THEN
    ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('poll_votes');
    CREATE POLICY mt_poll_votes_select ON public.poll_votes
      FOR SELECT TO authenticated
      USING (
        public.is_platform_superadmin()
        OR user_id = auth.uid()
        OR (
          to_regclass('public.polls') IS NOT NULL
          AND poll_id IN (SELECT p.id FROM public.polls p WHERE public.user_is_staff_on_site(p.site_id))
        )
      );
    CREATE POLICY mt_poll_votes_insert ON public.poll_votes
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND (
          NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='poll_votes' AND column_name='unit_id')
          OR public.mt_resident_owns_unit(unit_id)
          OR public.user_is_staff_on_site((SELECT p.site_id FROM public.polls p WHERE p.id = poll_id))
        )
      );
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    PERFORM public.mt_drop_known_policies('notifications');
    CREATE POLICY mt_notifications_select ON public.notifications
      FOR SELECT TO authenticated
      USING (
        public.is_platform_superadmin()
        OR user_id = auth.uid()
        OR public.user_is_staff_on_site(site_id)
      );
    CREATE POLICY mt_notifications_insert ON public.notifications
      FOR INSERT TO authenticated
      WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id) OR user_id = auth.uid());
    CREATE POLICY mt_notifications_update ON public.notifications
      FOR UPDATE TO authenticated
      USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id) OR user_id = auth.uid())
      WITH CHECK (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id) OR user_id = auth.uid());
    CREATE POLICY mt_notifications_delete ON public.notifications
      FOR DELETE TO authenticated
      USING (public.is_platform_superadmin() OR public.user_is_staff_on_site(site_id));
  END IF;
END $$;

-- profiles / login_audit: mevcut self kapsamı korunur
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_profiles_select ON public.profiles;
    DROP POLICY IF EXISTS tenant_profiles_update ON public.profiles;
    DROP POLICY IF EXISTS mt_profiles_select ON public.profiles;
    DROP POLICY IF EXISTS mt_profiles_update ON public.profiles;
    CREATE POLICY mt_profiles_select ON public.profiles
      FOR SELECT TO authenticated
      USING (public.is_platform_superadmin() OR id = auth.uid());
    CREATE POLICY mt_profiles_update ON public.profiles
      FOR UPDATE TO authenticated
      USING (public.is_platform_superadmin() OR id = auth.uid())
      WITH CHECK (public.is_platform_superadmin() OR id = auth.uid());
  END IF;
  IF to_regclass('public.login_audit') IS NOT NULL THEN
    ALTER TABLE public.login_audit ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_login_audit_select ON public.login_audit;
    DROP POLICY IF EXISTS tenant_login_audit_insert ON public.login_audit;
    DROP POLICY IF EXISTS mt_login_audit_select ON public.login_audit;
    DROP POLICY IF EXISTS mt_login_audit_insert ON public.login_audit;
    CREATE POLICY mt_login_audit_select ON public.login_audit
      FOR SELECT TO authenticated
      USING (public.is_platform_superadmin() OR user_id = auth.uid());
    CREATE POLICY mt_login_audit_insert ON public.login_audit
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid() OR public.is_platform_superadmin());
  END IF;
END $$;

-- Storage: path {site_id}/...
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS mt_storage_documents_select ON storage.objects;
  DROP POLICY IF EXISTS mt_storage_documents_insert ON storage.objects;
  DROP POLICY IF EXISTS mt_storage_documents_update ON storage.objects;
  DROP POLICY IF EXISTS mt_storage_documents_delete ON storage.objects;
  CREATE POLICY mt_storage_documents_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id IN ('documents', 'site-documents', 'uploads')
      AND public.user_is_staff_on_site_txt((storage.foldername(name))[1])
    );
  CREATE POLICY mt_storage_documents_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id IN ('documents', 'site-documents', 'uploads')
      AND public.user_is_staff_on_site_txt((storage.foldername(name))[1])
    );
  CREATE POLICY mt_storage_documents_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id IN ('documents', 'site-documents', 'uploads')
      AND public.user_is_staff_on_site_txt((storage.foldername(name))[1])
    )
    WITH CHECK (
      bucket_id IN ('documents', 'site-documents', 'uploads')
      AND public.user_is_staff_on_site_txt((storage.foldername(name))[1])
    );
  CREATE POLICY mt_storage_documents_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id IN ('documents', 'site-documents', 'uploads')
      AND public.user_is_staff_on_site_txt((storage.foldername(name))[1])
    );
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'storage.foldername yok; storage policy atlandı';
END $$;

REVOKE ALL ON FUNCTION public.user_has_site_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_site_access_txt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_resident_on_site(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_staff_on_site(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_staff_on_site_txt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_manage_site_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_resident_unit_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mt_resident_owns_unit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mt_assert_actor_site_access(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.user_has_site_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_site_access_txt(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_resident_on_site(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_staff_on_site(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_staff_on_site_txt(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_manage_site_membership(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_resident_unit_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mt_resident_owns_unit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mt_assert_actor_site_access(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_has_site_access(uuid) IS
  'Komut 2: auth.uid() + site_users (+ firma yöneticisi mevcut genişleme). SECURITY DEFINER, search_path=public; recursive RLS yok.';
COMMENT ON FUNCTION public.mt_assert_actor_site_access(uuid, uuid) IS
  'service_role işleri bu kontrolü çağırarak tenant duvarını atlamamalı.';
