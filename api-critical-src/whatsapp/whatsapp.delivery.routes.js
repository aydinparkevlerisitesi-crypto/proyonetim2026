"use strict";
/**
 * WhatsApp Delivery Routes — Mesaj teslimat takibi endpoint'leri.
 *
 * Canlı Radore'da /api/instance/delivery altında çalışan
 * delivery tracking route'larının Readdy'ye taşınmış hali.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappDeliveryRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
const whatsapp_compat_1 = require("./whatsapp.compat");
const router = (0, express_1.Router)();
exports.whatsappDeliveryRouter = router;
/**
 * GET /api/instance/delivery/:siteId
 * Belirli bir site için son 24 saatlik delivery özetini döndür.
 */
router.get('/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const hours = Math.min(parseInt(req.query.hours) || 24, 168); // max 7 gün
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed', userMessage: 'Yetkilendirme başarısız.' });
            return;
        }
        const summary = await (0, whatsapp_compat_1.getDeliverySummary)(ctx.companyId, siteId, hours);
        res.json({
            success: true,
            siteId,
            companyId: ctx.companyId,
            hours,
            summary,
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        const msg = err.message;
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
router.get('/:siteId/messages', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status;
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed' });
            return;
        }
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
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
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * GET /api/instance/delivery/:siteId/pending
 * Henüz teslim edilmemiş (SENT ama DELIVERED olmamış) mesajları listele.
 */
router.get('/:siteId/pending', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed' });
            return;
        }
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
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
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * POST /api/instance/delivery/:siteId/refresh
 * Belirli bir mesajın delivery durumunu Evolution API'den yenile.
 */
router.post('/:siteId/refresh', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const { providerMessageId } = req.body;
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed' });
            return;
        }
        if (!providerMessageId) {
            res.status(400).json({ success: false, error: 'providerMessageId_required' });
            return;
        }
        // Archive'dan kaydı bul
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
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
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
exports.default = router;
//# sourceMappingURL=whatsapp.delivery.routes.js.map