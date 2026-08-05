import { Router, Request, Response } from 'express';
import { createServerSupabaseClient } from '../lib/supabase';
import { config } from '../config';
import { provisionDemoAccount } from '../services/demoProvision';

const router = Router();

let _supabaseAdmin: ReturnType<typeof createServerSupabaseClient> | null = null;

function getSupabaseAdmin(): ReturnType<typeof createServerSupabaseClient> {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return _supabaseAdmin;
}

function bearerToken(req: Request): string | null {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Yetkilendirme gerekli.' });
    return false;
  }
  const sb = getSupabaseAdmin();
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: 'Oturum geçersiz.' });
    return false;
  }
  const { data: profile } = await sb
    .from('profiles')
    .select('role, is_super_admin')
    .eq('id', userData.user.id)
    .maybeSingle();
  const role = String(profile?.role || '');
  const ok =
    profile?.is_super_admin === true ||
    ['super_admin', 'admin', 'platform_admin'].includes(role);
  if (!ok) {
    res.status(403).json({ error: 'Bu işlem için süper admin yetkisi gerekir.' });
    return false;
  }
  return true;
}

/**
 * POST /api/forms/contact
 * Public contact / demo lead form (KVKK consent required)
 */
router.post('/contact', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, subject, message, kvkk_consent, source_path } = req.body;

    if (!name || !email || !message) {
      res.status(400).json({ error: 'Ad Soyad, E-Posta ve Mesaj zorunludur.' });
      return;
    }

    if (String(message).length > 500) {
      res.status(400).json({ error: 'Mesaj 500 karakteri asamaz.' });
      return;
    }

    const consent =
      kvkk_consent === true ||
      kvkk_consent === 'true' ||
      kvkk_consent === '1' ||
      kvkk_consent === 'on';
    if (!consent) {
      res.status(400).json({ error: 'KVKK açık rıza onayı zorunludur.' });
      return;
    }

    const { error } = await getSupabaseAdmin().from('contact_requests').insert({
      name: String(name).trim().slice(0, 200),
      email: String(email).trim().slice(0, 200),
      phone: phone ? String(phone).trim().slice(0, 40) : null,
      subject: subject ? String(subject).trim().slice(0, 120) : 'Diğer',
      message: String(message).trim().slice(0, 500),
      status: 'new',
      kvkk_consent: true,
      source_path: source_path ? String(source_path).trim().slice(0, 300) : null,
    });

    if (error) {
      console.error('[Forms API] contact_requests insert error:', error.message);
      res.status(500).json({ error: 'Form kaydedilirken bir hata oluştu.', detail: error.message });
      return;
    }

    res.status(201).json({
      success: true,
      message: 'Mesajınız alındı. En kısa sürede dönüş yapacağız.',
    });
  } catch (err: any) {
    console.error('[Forms API] contact error:', err?.message);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});


/**
 * POST /api/forms/demo
 * Instant demo account (fictional seed data)
 */
router.post('/demo', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, message } = req.body || {};
    if (!name || !email) {
      res.status(400).json({ error: 'Ad Soyad ve E-Posta zorunludur.' });
      return;
    }
    const sb = getSupabaseAdmin();
    const demo = await provisionDemoAccount(sb, {
      name: String(name),
      email: String(email),
      phone,
      message: String(message || '').trim() || 'Demo talebi',
    });
    res.status(201).json({
      success: true,
      provisioned: true,
      message: 'Demo hesabiniz hazir.',
      credentials: {
        email: demo.email,
        portal_code: demo.portalCode,
        portal_password: demo.portalPassword,
        login_url: demo.loginUrl,
      },
      site_name: demo.siteName,
      trial_ends_at: demo.trialEndsAt,
    });
  } catch (err: any) {
    console.error('[Forms API] demo error:', err?.message);
    res.status(500).json({ error: err?.message || 'Demo hesap olusturulamadi.' });
  }
});

/**
 * POST /api/forms/pageview
 * Anonymous page view — only when client asserts analytics consent
 */
router.post('/pageview', async (req: Request, res: Response) => {
  try {
    const { path, referrer, session_hash, consent } = req.body || {};
    if (consent !== true && consent !== 'true') {
      res.status(204).end();
      return;
    }
    if (!path || typeof path !== 'string') {
      res.status(400).json({ error: 'path zorunlu' });
      return;
    }
    const cleanPath = path.slice(0, 300);
    if (
      cleanPath.startsWith('/dashboard') ||
      cleanPath.startsWith('/admin') ||
      cleanPath.startsWith('/sakin-panel')
    ) {
      res.status(204).end();
      return;
    }

    const { error } = await getSupabaseAdmin().from('site_page_views').insert({
      path: cleanPath,
      referrer: referrer ? String(referrer).slice(0, 500) : null,
      session_hash: session_hash ? String(session_hash).slice(0, 80) : null,
    });

    if (error) {
      console.error('[Forms API] pageview error:', error.message);
      res.status(500).json({ error: 'Kaydedilemedi' });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error('[Forms API] pageview CATCH:', err?.message);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

/**
 * GET /api/forms/leads — admin only
 */
router.get('/leads', async (req: Request, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { data, error } = await getSupabaseAdmin()
      .from('contact_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ leads: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sunucu hatası' });
  }
});

/**
 * PATCH /api/forms/leads/:id — admin only (status update)
 */
router.patch('/leads/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = req.params.id;
    const status = String(req.body?.status || '').trim();
    const allowed = ['new', 'contacted', 'won', 'lost', 'archived'];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: 'Geçersiz status' });
      return;
    }
    const { data, error } = await getSupabaseAdmin()
      .from('contact_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ lead: data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sunucu hatası' });
  }
});

/**
 * GET /api/forms/traffic — admin only, daily aggregates
 */
router.get('/traffic', async (req: Request, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const { data, error } = await getSupabaseAdmin()
      .from('site_page_views')
      .select('id, viewed_on, path, session_hash, created_at')
      .gte('viewed_on', sinceStr)
      .order('viewed_on', { ascending: false })
      .limit(5000);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = data || [];
    const byDay: Record<string, { views: number; sessions: Set<string> }> = {};
    const byPath: Record<string, number> = {};

    for (const r of rows) {
      const day = String(r.viewed_on);
      if (!byDay[day]) byDay[day] = { views: 0, sessions: new Set() };
      byDay[day].views += 1;
      if (r.session_hash) byDay[day].sessions.add(String(r.session_hash));
      const p = String(r.path || '/');
      byPath[p] = (byPath[p] || 0) + 1;
    }

    const daily = Object.entries(byDay)
      .map(([date, v]) => ({
        date,
        views: v.views,
        unique_sessions: v.sessions.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const top_pages = Object.entries(byPath)
      .map(([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    res.json({
      days,
      total_views: rows.length,
      total_sessions: new Set(rows.map((r) => r.session_hash).filter(Boolean)).size,
      daily,
      top_pages,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sunucu hatası' });
  }
});

/**
 * POST /api/forms/newsletter
 */
router.post('/newsletter', async (req: Request, res: Response) => {
  try {
    const { email, consent, source } = req.body;

    if (!email) {
      res.status(400).json({ error: 'E-Posta adresi zorunludur.' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
      return;
    }

    if (consent !== 'true') {
      res.status(400).json({ error: 'KVKK onayı gereklidir.' });
      return;
    }

    const sb = getSupabaseAdmin();
    const { data, error: rpcError } = await sb.rpc('subscribe_newsletter', {
      p_email: email,
      p_source: source || 'website',
    });

    if (rpcError) {
      console.error('[Forms API] RPC hatasi:', JSON.stringify(rpcError));
      res.status(500).json({
        error: 'Abonelik işlemi sırasında hata oluştu.',
        detail: rpcError.message,
        code: rpcError.code,
      });
      return;
    }

    const result = data as any;
    res.status(result?.status === 'created' ? 201 : 200).json(result);
  } catch (err: any) {
    console.error('[Forms API] newsletter CATCH:', err?.message);
    res.status(500).json({ error: 'Sunucu hatası.', detail: err?.message });
  }
});


/** Pure Management — security/management company leads (marketing bottom section) */
router.post('/pure-management', async (req: Request, res: Response) => {
  try {
    const { name, phone, message, kvkk_consent, source_path } = req.body || {};
    if (!name || !phone) {
      res.status(400).json({ error: 'Ad Soyad ve telefon zorunludur.' });
      return;
    }
    const consent =
      kvkk_consent === true ||
      kvkk_consent === 'true' ||
      kvkk_consent === '1' ||
      kvkk_consent === 'on';
    if (!consent) {
      res.status(400).json({ error: 'KVKK açık rıza onayı zorunludur.' });
      return;
    }
    const phoneClean = String(phone).trim().slice(0, 40);
    const nameClean = String(name).trim().slice(0, 200);
    const msgClean = message ? String(message).trim().slice(0, 500) : '';
    const { error } = await getSupabaseAdmin().from('contact_requests').insert({
            name: nameClean,
            email: `pure-lead+${Date.now()}@noemail.pure-management.local`,
            phone: phoneClean,
            subject: 'Pure Management',
            message: msgClean || 'Pure Management güvenlik/yönetim talebi',
            status: 'new',
        });
    if (error) {
      console.error('[Forms API] pure-management insert error:', error.message);
      res.status(500).json({ error: 'Form kaydedilirken bir hata oluştu.', detail: error.message });
      return;
    }
    res.status(201).json({
      success: true,
      message: 'Talebiniz alındı. Pure Management ekibi en kısa sürede dönüş yapacak.',
    });
  } catch (err: any) {
    console.error('[Forms API] pure-management error:', err?.message);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

router.get('/pure-management', async (req: Request, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    let q = getSupabaseAdmin()
      .from('contact_requests')
      .select('id,name,email,phone,subject,message,status,created_at')
      .eq('subject', 'Pure Management')
      .order('created_at', { ascending: false })
      .limit(200);
    const status = req.query.status ? String(req.query.status) : '';
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ items: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sunucu hatası' });
  }
});

router.patch('/pure-management/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = String(req.params.id || '');
    const status = String((req.body && req.body.status) || '').trim();
    const allowed = ['new', 'in_progress', 'done', 'closed'];
    if (!id || !allowed.includes(status)) {
      res.status(400).json({ error: 'Geçersiz id veya status.' });
      return;
    }
    const { data, error } = await getSupabaseAdmin()
      .from('contact_requests')
      .update({ status })
      .eq('id', id)
      .eq('subject', 'Pure Management')
      .select('id,status')
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Kayıt bulunamadı.' });
      return;
    }
    res.json({ success: true, item: data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sunucu hatası' });
  }
});

export default router;
