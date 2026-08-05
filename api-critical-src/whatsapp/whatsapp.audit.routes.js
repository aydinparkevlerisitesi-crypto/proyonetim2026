"use strict";
/**
 * WhatsApp Audit Routes — Mesaj gönderim denetim (audit) middleware ve endpoint'leri.
 *
 * Canlı Radore'da whatsappAuditSendCapture middleware'i tüm gönderim
 * isteklerini yakalar ve audit log'a yazar.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappAuditRouter = exports.whatsappAuditSendCapture = void 0;
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
const whatsapp_compat_1 = require("./whatsapp.compat");
// ═══════════════════════════════════════════════════
//  AUDIT LOG HELPERLAR
// ═══════════════════════════════════════════════════
const AUDIT_LOG_DIR = '/var/www/proyonetim/api/logs';
function ensureAuditDir() {
    try {
        const fs = require('fs');
        if (!fs.existsSync(AUDIT_LOG_DIR)) {
            fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
        }
    }
    catch {
        // sessiz
    }
}
function auditLogFile(siteId) {
    ensureAuditDir();
    const { path } = require('path');
    const suffix = siteId ? `-${siteId}` : '';
    return path.join(AUDIT_LOG_DIR, `whatsapp-audit${suffix}.jsonl`);
}
function appendAuditLog(record) {
    (0, whatsapp_compat_1.appendJsonl)(auditLogFile(), record);
}
function readAuditLogs(limit = 500) {
    return (0, whatsapp_compat_1.readJsonl)(auditLogFile(), limit);
}
// ═══════════════════════════════════════════════════
//  AUDIT SEND CAPTURE MIDDLEWARE
//  Tüm /api/instance/* ve /api/whatsapp/* send endpoint'lerini
//  yakalar ve audit log'a yazar.
// ═══════════════════════════════════════════════════
/**
 * whatsappAuditSendCapture middleware.
 * Canlı: app.use(whatsappAuditSendCapture)
 *
 * Bu middleware, response tamamlandıktan sonra gönderim isteklerini
 * yakalar ve hem JSONL dosyasına hem de DB'ye audit kaydı yazar.
 */
function whatsappAuditSendCapture(req, res, next) {
    // Sadece POST isteklerini ve send/connect/reconnect endpoint'lerini yakala
    const isRelevant = req.method === 'POST' &&
        /\/(send|send-text|direct-send|bulk-send|connect|reconnect)/.test(req.path);
    if (!isRelevant) {
        next();
        return;
    }
    const startTime = Date.now();
    const originalEnd = res.end.bind(res);
    const originalJson = res.json.bind(res);
    let responseBody = null;
    // res.json() override — response body'i yakala
    res.json = function (body) {
        responseBody = body;
        return originalJson(body);
    };
    // res.end() override — response bittiğinde logla
    res.end = function (chunk, ...args) {
        const duration = Date.now() - startTime;
        const path = req.path;
        const siteId = req.params.siteId
            || req.body?.siteId
            || req.query.siteId
            || 'unknown';
        try {
            const auditRecord = {
                type: 'send_capture',
                method: req.method,
                path,
                siteId,
                ip: req.ip || req.socket.remoteAddress || 'unknown',
                userAgent: req.headers['user-agent'] || 'unknown',
                requestBody: {
                    phone: req.body?.phone || req.body?.phoneNumber || req.body?.to || null,
                    messagePreview: req.body?.message ? String(req.body.message).substring(0, 100) : null,
                    recipientCount: Array.isArray(req.body?.recipients) ? req.body.recipients.length : null,
                },
                responseStatus: res.statusCode,
                responsePreview: responseBody
                    ? JSON.stringify(responseBody).substring(0, 500)
                    : null,
                durationMs: duration,
            };
            appendAuditLog(auditRecord);
            // Ayrıca notification_delivery_logs tablosuna da yaz (async, non-blocking)
            writeDbAuditLog(siteId, auditRecord).catch(() => {
                // DB yazımı opsiyonel
            });
        }
        catch {
            // Audit log hatası request akışını bozmamalı
        }
        // Original end'i çağır
        if (chunk !== undefined) {
            return originalEnd(chunk, ...args);
        }
        return originalEnd();
    };
    next();
}
exports.whatsappAuditSendCapture = whatsappAuditSendCapture;
async function writeDbAuditLog(siteId, record) {
    try {
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        await sb.from('notification_delivery_logs').insert({
            site_id: siteId,
            channel: 'whatsapp',
            event_type: record.type || 'send_capture',
            status_code: record.responseStatus || 0,
            request_preview: JSON.stringify(record.requestBody || {}),
            response_preview: JSON.stringify(record.responsePreview || {}),
            duration_ms: record.durationMs || 0,
            ip_address: record.ip || null,
            user_agent: record.userAgent || null,
        });
    }
    catch {
        // Sessiz
    }
}
// ═══════════════════════════════════════════════════
//  AUDIT ROUTER
// ═══════════════════════════════════════════════════
const router = (0, express_1.Router)();
exports.whatsappAuditRouter = router;
/**
 * GET /api/instance/audit/logs
 * Son audit kayıtlarını döndür.
 */
router.get('/logs', auth_1.authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const logs = readAuditLogs(limit);
        res.json({ success: true, count: logs.length, logs });
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * GET /api/instance/audit/:siteId
 * Belirli site için audit özetini döndür.
 */
router.get('/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const hours = Math.min(parseInt(req.query.hours) || 24, 168);
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
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const { data, error, count } = await sb
            .from('notification_delivery_logs')
            .select('*', { count: 'exact' })
            .eq('site_id', siteId)
            .eq('channel', 'whatsapp')
            .gt('created_at', since)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        // Basit istatistikler
        const stats = {
            total: count || 0,
            success: 0,
            failed: 0,
            avgDurationMs: 0,
        };
        let totalDuration = 0;
        for (const row of data || []) {
            const status = row.status_code || 0;
            if (status >= 200 && status < 300)
                stats.success++;
            else if (status >= 400)
                stats.failed++;
            totalDuration += row.duration_ms || 0;
        }
        if ((data || []).length > 0) {
            stats.avgDurationMs = Math.round(totalDuration / (data || []).length);
        }
        res.json({
            success: true,
            siteId,
            companyId: ctx.companyId,
            hours,
            stats,
            logs: data || [],
        });
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * GET /api/instance/audit/:siteId/stats
 * Site bazlı gönderim istatistikleri.
 */
router.get('/:siteId/stats', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const hours = Math.min(parseInt(req.query.hours) || 24, 168);
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
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        // Archive tablosundan gönderim istatistikleri
        const { data: archiveStats, error: archiveError } = await sb
            .from('whatsapp_message_archive')
            .select('send_status, delivery_status, read_status')
            .eq('company_id', ctx.companyId)
            .eq('site_id', siteId)
            .or(`sent_at.gte.${since},failed_at.gte.${since}`);
        if (archiveError) {
            res.status(500).json({ success: false, error: archiveError.message });
            return;
        }
        const stats = {
            total: 0,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0,
            pending: 0,
            deliveryRate: 0,
            readRate: 0,
        };
        for (const row of archiveStats || []) {
            stats.total++;
            if (row.send_status === 'SENT')
                stats.sent++;
            else if (row.send_status === 'FAILED')
                stats.failed++;
            else if (row.send_status === 'PENDING')
                stats.pending++;
            if (row.delivery_status === 'DELIVERED')
                stats.delivered++;
            if (row.read_status === 'READ')
                stats.read++;
        }
        if (stats.sent > 0) {
            stats.deliveryRate = Math.round((stats.delivered / stats.sent) * 100);
            stats.readRate = Math.round((stats.read / stats.sent) * 100);
        }
        res.json({
            success: true,
            siteId,
            companyId: ctx.companyId,
            hours,
            stats,
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
exports.default = router;
//# sourceMappingURL=whatsapp.audit.routes.js.map