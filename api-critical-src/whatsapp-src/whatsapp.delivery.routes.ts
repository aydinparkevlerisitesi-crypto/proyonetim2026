/**
 * WhatsApp Delivery Routes — Mesaj teslimat takibi endpoint'leri.
 *
 * Canlı Radore'da /api/instance/delivery altında çalışan
 * delivery tracking route'larının Readdy'ye taşınmış hali.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */

import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../../middleware/auth';
import { createServerSupabaseClient } from '../../lib/supabase';
import { config } from '../../config';
import { resolveCompanyContext } from './whatsapp.helpers';
import { getDeliverySummary } from './whatsapp.compat';

const router = Router();

/**
 * GET /api/instance/delivery/:siteId
 * Belirli bir site için son 24 saatlik delivery özetini döndür.
 */
router.get('/:siteId', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168); // max 7 gün

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed', userMessage: 'Yetkilendirme başarısız.' });
      return;
    }

    const summary = await getDeliverySummary(ctx.companyId, siteId, hours);

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      hours,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error('[DeliveryRoutes] GET /:siteId hata:', msg);
    res.status(500).json({
      success: false,
      error: 'internal_error',
      userMessage: `Delivery raporu alınamadı: ${msg}`,
    });
  }
});

/**
 * GET /api/instance/delivery/:siteId/messages
 * Detaylı mesaj teslimat kayıtlarını döndür (archive tablosundan).
 */
router.get('/:siteId/messages', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    let query = sb
      .from('whatsapp_message_archive')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('site_id', siteId)
      .order('sent_at', { ascending: false })
      .order('failed_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('send_status', status.toUpperCase());
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[DeliveryRoutes] Mesaj sorgu hatası:', error.message);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      limit,
      offset,
      total: count || (data || []).length,
      messages: data || [],
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/instance/delivery/:siteId/pending
 * Henüz teslim edilmemiş (SENT ama DELIVERED olmamış) mesajları listele.
 */
router.get('/:siteId/pending', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('whatsapp_message_archive')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('site_id', siteId)
      .eq('send_status', 'SENT')
      .is('delivery_status', null)
      .gt('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      count: (data || []).length,
      pending: data || [],
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/instance/delivery/:siteId/refresh
 * Belirli bir mesajın delivery durumunu Evolution API'den yenile.
 */
router.post('/:siteId/refresh', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const { providerMessageId } = req.body as { providerMessageId?: string };

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    if (!providerMessageId) {
      res.status(400).json({ success: false, error: 'providerMessageId_required' });
      return;
    }

    // Archive'dan kaydı bul
    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    const { data: archiveRecord, error: findError } = await sb
      .from('whatsapp_message_archive')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();

    if (findError || !archiveRecord) {
      res.status(404).json({ success: false, error: 'message_not_found' });
      return;
    }

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      providerMessageId,
      archiveRecord,
      note: 'Delivery status refreshed from archive. Evolution API real-time status check requires instance-level API call.',
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
export { router as whatsappDeliveryRouter };