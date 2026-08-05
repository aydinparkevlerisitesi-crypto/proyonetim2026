"use strict";
/**
 * WhatsApp Compatibility Adapter — Canlı Radore /api/instance/* bridge endpoint'leri
 * ve JSONL log helper fonksiyonları.
 *
 * Bu modül, eski relay sunucuları ve webhook callback'lerinin kullandığı
 * /api/instance/* endpoint'lerini mevcut /api/whatsapp/* endpoint'lerine
 * yönlendirir. Ayrıca mesaj gönderim loglama ve delivery tracking için
 * yardımcı fonksiyonlar sağlar.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappCompatRouter = exports.getDeliverySummary = exports.extractWaWebhook = exports.normalizeWaStatus = exports.readWhatsAppSendLogs = exports.appendWhatsAppSendLog = exports.readJsonl = exports.appendJsonl = exports.waLogFile = void 0;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const auth_1 = require("../../middleware/auth");
const whatsapp_service_1 = require("./whatsapp.service");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
// ═══════════════════════════════════════════════════
//  JSONL LOG HELPERLAR (Canlı index.ts inline fonksiyonları)
// ═══════════════════════════════════════════════════
const LOG_DIR = '/var/www/proyonetim/api/logs';
function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    }
    catch {
        // sessiz
    }
}
/**
 * WhatsApp log dosyası yolunu döndür.
 * Canlı: waLogFile()
 */
function waLogFile(siteId) {
    ensureLogDir();
    const suffix = siteId ? `-${siteId}` : '';
    return path.join(LOG_DIR, `whatsapp-send${suffix}.jsonl`);
}
exports.waLogFile = waLogFile;
/**
 * Generic JSONL append.
 * Canlı: appendJsonl()
 */
function appendJsonl(filePath, record) {
    try {
        const line = JSON.stringify({ ...record, _ts: new Date().toISOString() }) + '\n';
        fs.appendFileSync(filePath, line);
    }
    catch {
        // sessiz
    }
}
exports.appendJsonl = appendJsonl;
/**
 * Generic JSONL read.
 * Canlı: readJsonl()
 */
function readJsonl(filePath, limit = 500) {
    try {
        if (!fs.existsSync(filePath))
            return [];
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        return lines.slice(-limit).map((line) => JSON.parse(line));
    }
    catch {
        return [];
    }
}
exports.readJsonl = readJsonl;
/**
 * WhatsApp send log'a kayıt ekle.
 * Canlı: appendWhatsAppSendLog()
 */
function appendWhatsAppSendLog(siteId, record) {
    const file = waLogFile(siteId);
    appendJsonl(file, { siteId, ...record });
}
exports.appendWhatsAppSendLog = appendWhatsAppSendLog;
/**
 * WhatsApp send log kayıtlarını oku.
 * Canlı: readWhatsAppSendLogs()
 */
function readWhatsAppSendLogs(siteId, limit = 100) {
    return readJsonl(waLogFile(siteId), limit);
}
exports.readWhatsAppSendLogs = readWhatsAppSendLogs;
/**
 * Webhook status string'ini normalize et.
 * Canlı: normalizeWaStatus()
 */
function normalizeWaStatus(raw) {
    const s = String(raw || '').toUpperCase().trim();
    if (s === 'OPEN' || s === 'CONNECTED')
        return 'CONNECTED';
    if (s === 'CLOSE' || s === 'DISCONNECTED')
        return 'DISCONNECTED';
    if (s === 'QRCODE' || s === 'QR')
        return 'QR_READY';
    if (s === 'CONNECTING')
        return 'CONNECTING';
    if (s === 'SERVER_ACK' || s === 'SENT' || s === 'SUCCESS')
        return 'SENT';
    if (s === 'DELIVERY_ACK' || s === 'DELIVERED' || s === 'RECEIVED')
        return 'DELIVERED';
    if (s === 'READ' || s === 'READ_EXECUTED')
        return 'READ';
    if (s === 'ERROR' || s === 'FAILED')
        return 'FAILED';
    return s || 'UNKNOWN';
}
exports.normalizeWaStatus = normalizeWaStatus;
/**
 * Evolution webhook payload'ından temel veriyi çıkar.
 * Canlı: extractWaWebhook()
 */
function extractWaWebhook(body) {
    const event = String(body.event || '');
    const instance = String(body.instance || '');
    const data = (body.data || {});
    return {
        event,
        instance,
        state: data.state || data.connection,
        phone: data.phone || data.number || data.remoteJid,
        qrCode: data.qrcode?.base64 || data.qrcode,
        messageId: data.key?.id || data.id,
        status: data.status,
    };
}
exports.extractWaWebhook = extractWaWebhook;
/**
 * Delivery summary oluştur (archive + JSONL log birleşimi).
 * Canlı: getDeliverySummary()
 */
async function getDeliverySummary(companyId, siteId, hours = 24) {
    try {
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const { data, error } = await sb
            .from('whatsapp_message_archive')
            .select('send_status, delivery_status, read_status, sent_at, failed_at')
            .eq('company_id', companyId)
            .eq('site_id', siteId)
            .or(`sent_at.gte.${since},failed_at.gte.${since}`);
        if (error) {
            console.warn('[getDeliverySummary] DB hatası:', error.message);
            return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, byHour: [] };
        }
        const rows = data || [];
        const summary = {
            total: rows.length,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0,
            pending: 0,
            byHour: [],
        };
        const hourMap = new Map();
        for (const row of rows) {
            const status = row.send_status;
            if (status === 'SENT')
                summary.sent++;
            else if (status === 'FAILED')
                summary.failed++;
            else if (status === 'PENDING')
                summary.pending++;
            if (row.delivery_status === 'DELIVERED')
                summary.delivered++;
            if (row.read_status === 'READ')
                summary.read++;
            const ts = row.sent_at || row.failed_at || since;
            const hour = ts.slice(0, 13) + ':00';
            const h = hourMap.get(hour) || { sent: 0, failed: 0 };
            if (status === 'SENT')
                h.sent++;
            else if (status === 'FAILED')
                h.failed++;
            hourMap.set(hour, h);
        }
        summary.byHour = Array.from(hourMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([hour, counts]) => ({ hour, ...counts }));
        return summary;
    }
    catch (err) {
        console.warn('[getDeliverySummary] Exception:', err.message);
        return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, byHour: [] };
    }
}
exports.getDeliverySummary = getDeliverySummary;
// ═══════════════════════════════════════════════════
//  COMPATIBILITY BRIDGE ROUTER
//  Eski /api/instance/* endpoint'leri → yeni /api/whatsapp/*
// ═══════════════════════════════════════════════════
const compatRouter = (0, express_1.Router)();
exports.whatsappCompatRouter = compatRouter;
/**
 * POST /api/instance/connect/:siteId
 * Bridge → POST /api/whatsapp/site/connect
 */
compatRouter.post('/connect/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const { phoneNumber } = req.body;
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
            return;
        }
        const result = await (0, whatsapp_service_1.multiTenantConnect)({ token, siteId, phoneNumber });
        const statusCode = result.success
            ? 200
            : result.errorType === 'auth_required' ? 401
                : result.errorType === 'rate_limit' ? 429
                    : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout' ? 503
                        : 500;
        res.status(statusCode).json(result);
    }
    catch (err) {
        const msg = err.message;
        res.status(503).json({ success: false, error: msg, userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${msg}` });
    }
});
/**
 * GET /api/instance/status/:siteId
 * Bridge → GET /api/whatsapp/site/status
 */
compatRouter.get('/status/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ success: false, status: 'DISCONNECTED', error: 'auth_required' });
            return;
        }
        const result = await (0, whatsapp_service_1.multiTenantStatus)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, status: 'DISCONNECTED', error: msg });
    }
});
/**
 * POST /api/instance/send-text/:siteId
 * Bridge → POST /api/whatsapp/site/direct-send
 */
compatRouter.post('/send-text/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const { phone, message, to } = req.body;
        const targetPhone = phone || to || '';
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed', userMessage: 'Yetkilendirme başarısız.' });
            return;
        }
        if (!targetPhone || !message) {
            res.status(400).json({ success: false, error: 'missing_fields', userMessage: 'Telefon ve mesaj zorunludur.' });
            return;
        }
        const result = await (0, whatsapp_service_1.sendEvolutionTextMessage)(ctx.companyId, siteId, targetPhone, message);
        // Log to JSONL
        appendWhatsAppSendLog(siteId, {
            phone: targetPhone,
            message: message.substring(0, 200),
            status: result.success ? 'SENT' : 'FAILED',
            providerMessageId: result.providerMessageId || undefined,
            error: result.user_message || undefined,
            instanceName: result.instanceName || undefined,
        });
        const statusCode = result.success
            ? 200
            : (result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg, userMessage: `Gönderim hatası: ${msg}` });
    }
});
/**
 * POST /api/instance/disconnect/:siteId
 * Bridge → POST /api/whatsapp/site/disconnect
 */
compatRouter.post('/disconnect/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return;
        }
        const result = await (0, whatsapp_service_1.multiTenantDisconnect)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * GET /api/instance/send-logs/:siteId
 * Bridge → JSONL log dosyası okuma
 */
compatRouter.get('/send-logs/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const limit = parseInt(req.query.limit) || 100;
        const logs = readWhatsAppSendLogs(siteId, limit);
        res.json({ success: true, siteId, count: logs.length, logs });
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
/**
 * POST /api/instance/webhook/evolution
 * Bridge → POST /api/whatsapp/webhook/evolution
 * Public — no auth (Evolution API key check inside)
 */
compatRouter.post('/webhook/evolution', async (req, res) => {
    try {
        // Forward to the existing webhook handler
        const { handleEvolutionWebhook } = await Promise.resolve().then(() => __importStar(require('./whatsapp.webhook')));
        await handleEvolutionWebhook(req, res);
    }
    catch (err) {
        const msg = err.message;
        console.error('[CompatWebhook] Hata:', msg);
        res.json({ success: true, error: 'internal_error_but_acknowledged' });
    }
});
/**
 * GET /api/instance/delivery-report/:siteId
 * Bridge → delivery summary
 */
compatRouter.get('/delivery-report/:siteId', auth_1.authMiddleware, async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const hours = parseInt(req.query.hours) || 24;
        if (!token) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return;
        }
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'auth_failed' });
            return;
        }
        const summary = await getDeliverySummary(ctx.companyId, siteId, hours);
        res.json({ success: true, siteId, companyId: ctx.companyId, hours, summary });
    }
    catch (err) {
        const msg = err.message;
        res.status(500).json({ success: false, error: msg });
    }
});
exports.default = compatRouter;
//# sourceMappingURL=whatsapp.compat.js.map