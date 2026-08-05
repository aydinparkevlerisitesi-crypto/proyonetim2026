"use strict";
/**
 * WhatsApp Controller (Baileys) — Request handler'lar.
 *
 * v4.0 Enterprise — Site bazlı endpoint'ler eklendi.
 * Eski company_id bazlı endpoint'ler geriye dönük uyumlu.
 * İş mantığı whatsapp.service'te.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleArchiveVerify = exports.handleSetDefaultChannel = exports.handleGetChannels = exports.handleSiteDiagnostics = exports.handleHeal = exports.handleDiagnostics = exports.handleQueueStats = exports.handleSessionList = exports.handleEnterpriseHealth = exports.handleHealth = exports.handleSiteDirectSend = exports.handleSiteBulkSend = exports.handleSiteSend = exports.handleDirectSend = exports.handleBulkSend = exports.handleSend = exports.handleSiteReconnect = exports.handleSiteDisconnect = exports.handleSiteQr = exports.handleSiteStatus = exports.handleSiteConnect = exports.handleReconnect = exports.handleDisconnect = exports.handleQr = exports.handleStatus = exports.handleConnect = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const whatsapp_service_1 = require("./whatsapp.service");
const whatsapp_manager_1 = require("./whatsapp.manager");
const whatsapp_queue_1 = require("./whatsapp.queue");
const whatsapp_diagnostics_1 = require("./whatsapp.diagnostics");
const whatsapp_dto_1 = require("./whatsapp.dto");
const whatsapp_healing_1 = require("./whatsapp.healing");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
// ═══════════════════════════════════════════════════
//  FAZ 1: Company Bağlantı Endpoint'leri (Geriye Dönük)
//  ÖNEMLİ: Artık multiTenant fonksiyonlara yönlendiriliyor.
//  Bu sayede instance name her yerde proyonetim_company_{id} olur.
// ═══════════════════════════════════════════════════
async function handleConnect(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'ERROR',
                siteId: '',
                qrCode: null,
                qr_code: null,
                base64: null,
                instance: null,
                provider: 'evolution-api',
                error: 'auth_required',
                errorType: 'auth_required',
                userMessage: 'Yetkilendirme gerekli. Lütfen tekrar giriş yapın.',
            });
            return;
        }
        const { siteId, phoneNumber, phone_number } = req.body;
        const effectivePhone = phoneNumber || phone_number || undefined;
        console.log(`[handleConnect→multiTenant] token alındı, siteId=${siteId || 'token\'dan çözülecek'}, phone=${effectivePhone || 'yok'}`);
        const result = await (0, whatsapp_service_1.multiTenantConnect)({
            token,
            siteId: siteId || undefined,
            phoneNumber: effectivePhone,
        });
        const statusCode = result.success
            ? 200
            : result.errorType === 'auth_required'
                ? 401
                : result.errorType === 'rate_limit'
                    ? 429
                    : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout'
                        ? 503
                        : 500;
        console.log(`[handleConnect→multiTenant] Yanıt: HTTP ${statusCode}, success=${result.success}, qrCode=${result.qrCode ? 'VAR' : 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleConnect] HATA: ${errMsg}`);
        res.status(503).json({
            success: false,
            status: 'ERROR',
            siteId: '',
            qrCode: null,
            qr_code: null,
            base64: null,
            instance: null,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'internal_handler_error',
            userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${errMsg}`,
        });
    }
}
exports.handleConnect = handleConnect;
async function handleStatus(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'DISCONNECTED',
                connected: false,
                state: 'close',
                siteId: '',
                companyId: undefined,
                phoneNumber: null,
                profileName: null,
                battery: null,
                lastSeen: null,
                sessionAge: 0,
                connectedAt: null,
                qrAvailable: false,
                hasQr: false,
                qrCode: null,
                error: 'auth_required',
                sessionPath: null,
                provider: 'evolution',
                channel: 'CONNECTED_DEVICE',
                lastCheckedAt: new Date().toISOString(),
                instanceName: undefined,
            });
            return;
        }
        const siteId = req.body?.siteId || req.query.siteId || undefined;
        const result = await (0, whatsapp_service_1.multiTenantStatus)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        res.status(500).json({
            success: false,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            siteId: '',
            companyId: undefined,
            phoneNumber: null,
            profileName: null,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: null,
            qrAvailable: false,
            hasQr: false,
            qrCode: null,
            error: errMsg,
            sessionPath: null,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt: new Date().toISOString(),
            instanceName: undefined,
        });
    }
}
exports.handleStatus = handleStatus;
async function handleQr(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                siteId: '',
                companyId: undefined,
                qrCode: null,
                status: 'DISCONNECTED',
                connected: false,
                state: 'close',
                qrAvailable: false,
                hasQr: false,
                error: 'auth_required',
                phoneNumber: null,
                profileName: null,
                battery: null,
                lastSeen: null,
                sessionAge: 0,
                connectedAt: null,
                sessionPath: null,
                provider: 'evolution',
                channel: 'CONNECTED_DEVICE',
                lastCheckedAt: new Date().toISOString(),
            });
            return;
        }
        const siteId = req.body?.siteId || req.query.siteId || undefined;
        const result = await (0, whatsapp_service_1.multiTenantStatus)(token, siteId);
        res.json({
            success: result.connected || result.status === 'CONNECTED',
            siteId: result.siteId,
            companyId: result.companyId,
            qrCode: result.qrCode,
            status: result.status,
            connected: result.connected,
            state: result.state,
            qrAvailable: result.qrAvailable,
            hasQr: result.hasQr,
            phoneNumber: result.phoneNumber,
            profileName: result.profileName,
            connectedAt: result.connectedAt,
            lastCheckedAt: result.lastCheckedAt,
            provider: result.provider,
            channel: result.channel,
        });
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        res.status(500).json({
            siteId: '',
            qrCode: null,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            qrAvailable: false,
            hasQr: false,
            error: errMsg,
            phoneNumber: null,
            lastCheckedAt: new Date().toISOString(),
        });
    }
}
exports.handleQr = handleQr;
async function handleDisconnect(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ success: false, error: 'Yetkilendirme gerekli' });
            return;
        }
        const { siteId } = req.body;
        const result = await (0, whatsapp_service_1.multiTenantDisconnect)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        res.status(500).json({ success: false, siteId: '', status: 'ERROR', error: errMsg });
    }
}
exports.handleDisconnect = handleDisconnect;
async function handleReconnect(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'ERROR',
                siteId: '',
                qrCode: null,
                instance: null,
                provider: 'evolution-api',
                error: 'auth_required',
                errorType: 'auth_required',
                userMessage: 'Yetkilendirme gerekli.',
            });
            return;
        }
        const { siteId, phoneNumber, phone_number } = req.body;
        const effectivePhone = phoneNumber || phone_number || undefined;
        // Instance varlik kontrolu — yoksa direkt connect calis
        try {
            const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
            if (ctx) {
                const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
                const { data: session } = await sb
                    .from('whatsapp_sessions')
                    .select('instance_name')
                    .eq('company_id', ctx.companyId)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                const { data: companyInstance } = await sb
                    .from('whatsapp_company_instances')
                    .select('instance_name')
                    .eq('company_id', ctx.companyId)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                const hasInstance = !!(session?.instance_name || companyInstance?.instance_name);
                if (!hasInstance) {
                    console.log(`[handleReconnect] Instance bulunamadi (companyId=${ctx.companyId}) — yeni connect baslatiliyor`);
                    const result = await (0, whatsapp_service_1.multiTenantConnect)({
                        token,
                        siteId: siteId || undefined,
                        phoneNumber: effectivePhone,
                    });
                    res.status(result.success ? 200 : 500).json(result);
                    return;
                }
                console.log(`[handleReconnect] Instance mevcut, reconnect yapiliyor`);
            }
        }
        catch (checkErr) {
            console.warn(`[handleReconnect] Instance kontrolu basarisiz: ${checkErr.message} — reconnect deneniyor`);
        }
        // Disconnect + Connect akisi
        await (0, whatsapp_service_1.multiTenantDisconnect)(token, siteId);
        const result = await (0, whatsapp_service_1.multiTenantConnect)({
            token,
            siteId: siteId || undefined,
            phoneNumber: effectivePhone,
        });
        const statusCode = result.success ? 200
            : result.errorType === 'auth_required' ? 401
                : result.errorType === 'rate_limit' ? 429
                    : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout' ? 503
                        : 500;
        console.log(`[handleReconnect] Yanit: HTTP ${statusCode}, success=${result.success}, qrCode=${result.qrCode ? 'VAR' : 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleReconnect] HATA: ${errMsg}`);
        res.status(503).json({
            success: false,
            status: 'ERROR',
            siteId: '',
            qrCode: null,
            qr_code: null,
            base64: null,
            instance: null,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'internal_handler_error',
            userMessage: `WhatsApp servisi su anda ulasilamiyor: ${errMsg}`,
        });
    }
}
exports.handleReconnect = handleReconnect;
// ═══════════════════════════════════════════════════
//  MULTI-TENANT: Site Bazlı Bağlantı Endpoint'leri
//  (Token'dan company_id çözülür, frontend'den gelen
//   companyId tek başına güvenilir kabul edilmez)
// ═══════════════════════════════════════════════════
async function handleSiteConnect(req, res) {
    // ══════════════════════════════════════════════════════
    // ⛔ SAVUNMA HATTI 0: Her şeyi yakala.
    // "@supabase/supabase-js" içinde PKCE flow'unda "state is not defined"
    // ReferenceError fırlatabiliyor. Bu hata controller try/catch'ini
    // ATLAYIP Express global handler'a ulaşırsa 48 byte'lık
    // {"success":false,"error":"state is not defined"} döner.
    // Bu wrapper HER TÜRLÜ hatayı standart formata sarar.
    // ══════════════════════════════════════════════════════
    try {
        await _handleSiteConnectImpl(req, res);
    }
    catch (fatalErr) {
        const msg = fatalErr.message || 'Bilinmeyen ölümcül hata';
        const stack = fatalErr.stack || 'stack yok';
        console.error(`[handleSiteConnect] ☠️ SAVUNMA HATTI 0 YAKALADI ☠️`);
        console.error(`[handleSiteConnect] HATA: ${msg}`);
        console.error(`[handleSiteConnect] STACK: ${stack}`);
        console.error(`[handleSiteConnect] TYPE: ${typeof fatalErr}, NAME: ${fatalErr.name || 'yok'}`);
        // Response zaten gönderilmiş olabilir — headersSent kontrol et
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                status: 'ERROR',
                siteId: '',
                qrCode: null,
                qr_code: null,
                base64: null,
                instance: null,
                provider: 'evolution-api',
                error: msg,
                errorType: 'fatal_handler_error',
                userMessage: `WhatsApp servisi beklenmedik bir hata ile karşılaştı. Lütfen sistem yöneticinize başvurun. Hata: ${msg}`,
                debug: { stack: stack.split('\n').slice(0, 10) },
            });
        }
    }
}
exports.handleSiteConnect = handleSiteConnect;
async function _handleSiteConnectImpl(req, res) {
    try {
        // Token'ı header'dan al
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'ERROR',
                siteId: '',
                qrCode: null,
                instance: null,
                provider: 'evolution-api',
                error: 'auth_required',
                errorType: 'auth_required',
                userMessage: 'Yetkilendirme gerekli. Lütfen tekrar giriş yapın.',
            });
            return;
        }
        const { siteId, phoneNumber, companyId } = req.body;
        console.log(`[handleSiteConnect] Token alındı, siteId=${siteId || 'token\'dan çözülecek'}, phone=${phoneNumber || 'yok'}`);
        // ═══ KRİTİK: multiTenantConnect her adımı logla ═══
        let result;
        try {
            result = await (0, whatsapp_service_1.multiTenantConnect)({
                token,
                siteId: siteId || undefined,
                phoneNumber: phoneNumber || undefined,
            });
        }
        catch (innerErr) {
            const innerMsg = innerErr.message || 'Bilinmeyen iç hata';
            const innerStack = innerErr.stack || 'stack yok';
            console.error(`[handleSiteConnect] multiTenantConnect CRASH: ${innerMsg}`);
            console.error(`[handleSiteConnect] STACK: ${innerStack}`);
            res.status(503).json({
                success: false,
                status: 'ERROR',
                siteId: siteId || '',
                qrCode: null,
                qr_code: null,
                base64: null,
                instance: null,
                provider: 'evolution-api',
                error: innerMsg,
                errorType: 'internal_handler_error',
                userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${innerMsg}`,
                debug: { stack: innerStack.split('\n').slice(0, 5) },
            });
            return;
        }
        const statusCode = result.success
            ? 200
            : result.errorType === 'auth_required'
                ? 401
                : result.errorType === 'rate_limit'
                    ? 429
                    : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout'
                        ? 503
                        : 500;
        console.log(`[handleSiteConnect] Yanıt: HTTP ${statusCode}, success=${result.success}, status=${result.status}, qrCode=${result.qrCode ? 'VAR' : 'YOK'}, errorType=${result.errorType || 'none'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        const errStack = err.stack || 'stack yok';
        console.error(`[handleSiteConnect] BEKLENMEYEN HATA: ${errMsg}`);
        console.error(`[handleSiteConnect] STACK: ${errStack}`);
        res.status(503).json({
            success: false,
            status: 'ERROR',
            siteId: '',
            qrCode: null,
            qr_code: null,
            base64: null,
            instance: null,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'internal_handler_error',
            userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${errMsg}`,
            debug: { stack: errStack.split('\n').slice(0, 5) },
        });
    }
}
async function handleSiteStatus(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'DISCONNECTED',
                connected: false,
                state: 'close',
                siteId: '',
                companyId: undefined,
                phoneNumber: null,
                profileName: null,
                battery: null,
                lastSeen: null,
                sessionAge: 0,
                connectedAt: null,
                qrAvailable: false,
                hasQr: false,
                qrCode: null,
                error: 'auth_required',
                sessionPath: null,
                provider: 'evolution',
                channel: 'CONNECTED_DEVICE',
                lastCheckedAt: new Date().toISOString(),
                instanceName: undefined,
            });
            return;
        }
        const { siteId } = req.body || req.query;
        const result = await (0, whatsapp_service_1.multiTenantStatus)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteStatus] HATA: ${errMsg}`, err);
        res.status(500).json({
            success: false,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            siteId: '',
            companyId: undefined,
            phoneNumber: null,
            profileName: null,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: null,
            qrAvailable: false,
            hasQr: false,
            qrCode: null,
            error: errMsg,
            sessionPath: null,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt: new Date().toISOString(),
            instanceName: undefined,
        });
    }
}
exports.handleSiteStatus = handleSiteStatus;
async function handleSiteQr(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                siteId: '',
                companyId: undefined,
                qrCode: null,
                status: 'DISCONNECTED',
                connected: false,
                state: 'close',
                qrAvailable: false,
                hasQr: false,
                error: 'auth_required',
                phoneNumber: null,
                profileName: null,
                battery: null,
                lastSeen: null,
                sessionAge: 0,
                connectedAt: null,
                sessionPath: null,
                provider: 'evolution',
                channel: 'CONNECTED_DEVICE',
                lastCheckedAt: new Date().toISOString(),
            });
            return;
        }
        const { siteId } = req.body || req.query;
        const result = await (0, whatsapp_service_1.multiTenantStatus)(token, siteId);
        res.json({
            success: result.connected || result.status === 'CONNECTED',
            siteId: result.siteId,
            companyId: result.companyId,
            qrCode: result.qrCode,
            status: result.status,
            connected: result.connected,
            state: result.state,
            qrAvailable: result.qrAvailable,
            hasQr: result.hasQr,
            phoneNumber: result.phoneNumber,
            profileName: result.profileName,
            connectedAt: result.connectedAt,
            lastCheckedAt: result.lastCheckedAt,
            provider: result.provider,
            channel: result.channel,
        });
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteQr] HATA: ${errMsg}`, err);
        res.status(500).json({
            siteId: '',
            qrCode: null,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            qrAvailable: false,
            hasQr: false,
            error: errMsg,
            phoneNumber: null,
            lastCheckedAt: new Date().toISOString(),
        });
    }
}
exports.handleSiteQr = handleSiteQr;
async function handleSiteDisconnect(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ success: false, error: 'Yetkilendirme gerekli' });
            return;
        }
        const { siteId } = req.body;
        const result = await (0, whatsapp_service_1.multiTenantDisconnect)(token, siteId);
        res.json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteDisconnect] HATA: ${errMsg}`, err);
        res.status(500).json({ success: false, siteId: '', status: 'ERROR', error: errMsg });
    }
}
exports.handleSiteDisconnect = handleSiteDisconnect;
async function handleSiteReconnect(req, res) {
    try {
        // Reconnect = disconnect + connect
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({
                success: false,
                status: 'ERROR',
                siteId: '',
                qrCode: null,
                instance: null,
                provider: 'evolution-api',
                error: 'auth_required',
                errorType: 'auth_required',
                userMessage: 'Yetkilendirme gerekli.',
            });
            return;
        }
        const { siteId, phoneNumber } = req.body;
        // Önce disconnect
        await (0, whatsapp_service_1.multiTenantDisconnect)(token, siteId);
        // Sonra connect
        const result = await (0, whatsapp_service_1.multiTenantConnect)({
            token,
            siteId: siteId || undefined,
            phoneNumber: phoneNumber || undefined,
        });
        const statusCode = result.success
            ? 200
            : result.errorType === 'auth_required'
                ? 401
                : result.errorType === 'rate_limit'
                    ? 429
                    : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout'
                        ? 503
                        : 500;
        console.log(`[handleSiteReconnect] Yanıt: HTTP ${statusCode}, success=${result.success}, qrCode=${result.qrCode ? 'VAR' : 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteReconnect] BEKLENMEYEN HATA: ${errMsg}`, err);
        res.status(503).json({
            success: false,
            status: 'ERROR',
            siteId: '',
            qrCode: null,
            qr_code: null,
            base64: null,
            instance: null,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'internal_handler_error',
            userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${errMsg}`,
        });
    }
}
exports.handleSiteReconnect = handleSiteReconnect;
// ═══════════════════════════════════════════════════
//  FAZ 3: Mesaj Endpoint'leri (Geriye Dönük) — Artık gerçek Evolution gönderimi
// ═══════════════════════════════════════════════════
async function handleSend(req, res) {
    try {
        const { company_id, to, message } = req.body;
        if (!company_id || !to || !message) {
            res.status(400).json({
                success: false,
                status: 'FAILED',
                sent: 0,
                failed: 1,
                total: 1,
                error_type: 'missing_required_fields',
                user_message: 'Firma bilgisi, telefon ve mesaj zorunludur.',
                required: ['company_id', 'to', 'message'],
                received: {
                    company_id: Boolean(company_id),
                    to: Boolean(to),
                    message: Boolean(message),
                },
            });
            return;
        }
        // Gerçek Evolution gönderimi (siteId fallback = company_id)
        const result = await (0, whatsapp_service_1.sendEvolutionTextMessage)(company_id, company_id, to, message);
        const statusCode = result.success ? 200 : (result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500);
        console.log(`[handleSend] Yanıt gönderiliyor: HTTP ${statusCode}, success=${result.success}, providerMsgId=${result.providerMessageId || 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSend] BEKLENMEYEN HATA: ${errMsg}`, err);
        res.status(500).json({
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            error_type: 'internal_handler_error',
            user_message: `Sunucu iç hatası: ${errMsg}`,
        });
    }
}
exports.handleSend = handleSend;
async function handleBulkSend(req, res) {
    const { company_id, recipients } = req.body;
    if (!company_id || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
        res.status(400).json({
            success: false,
            status: 'FAILED',
            sent: 0,
            failed: 0,
            total: 0,
            error_type: 'empty_recipients',
            user_message: 'Firma ve alıcı listesi zorunludur.',
            results: [],
        });
        return;
    }
    if (recipients.length > 100) {
        res.status(400).json({
            success: false,
            status: 'FAILED',
            sent: 0,
            failed: recipients.length,
            total: recipients.length,
            error_type: 'too_many_recipients',
            user_message: 'Tek seferde en fazla 100 alıcıya mesaj gönderilebilir.',
            results: [],
        });
        return;
    }
    // Eski format: [{ phone, message }] → her alıcıya ayrı mesaj
    // Gerçek Evolution gönderimi
    let sentCount = 0;
    let failedCount = 0;
    const results = [];
    for (const recipient of recipients) {
        const singleResult = await (0, whatsapp_service_1.sendEvolutionTextMessage)(company_id, company_id, recipient.phone, recipient.message);
        results.push({
            phoneNumber: recipient.phone,
            normalizedPhone: singleResult.normalizedPhone,
            success: singleResult.success,
            status: singleResult.status,
            error_type: singleResult.error_type,
            user_message: singleResult.user_message,
            providerMessageId: singleResult.providerMessageId,
            technical: singleResult.technical,
        });
        if (singleResult.success)
            sentCount++;
        else
            failedCount++;
        // Rate limiting — her mesaj arası 1.2sn bekle
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    res.status(200).json({
        success: failedCount === 0,
        status: failedCount === 0 ? 'SENT' : 'PARTIAL_FAILED',
        sent: sentCount,
        failed: failedCount,
        total: recipients.length,
        results,
    });
}
exports.handleBulkSend = handleBulkSend;
async function handleDirectSend(req, res) {
    try {
        const { company_id, to, message } = req.body;
        if (!company_id || !to || !message) {
            res.status(400).json({
                success: false,
                status: 'FAILED',
                sent: 0,
                failed: 1,
                total: 1,
                error_type: 'missing_required_fields',
                user_message: 'Firma bilgisi, telefon ve mesaj zorunludur.',
            });
            return;
        }
        // Gerçek Evolution gönderimi
        const result = await (0, whatsapp_service_1.sendEvolutionTextMessage)(company_id, company_id, to, message);
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500).json(result);
        }
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleDirectSend] BEKLENMEYEN HATA: ${errMsg}`, err);
        res.status(500).json({
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            error_type: 'internal_handler_error',
            user_message: `Sunucu iç hatası: ${errMsg}`,
        });
    }
}
exports.handleDirectSend = handleDirectSend;
// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Mesaj Endpoint'leri
// ═══════════════════════════════════════════════════
async function handleSiteSend(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        // Token'dan company context çöz
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, req.body.siteId);
        if (!ctx) {
            res.status(401).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'auth_required',
                user_message: 'Yetkilendirme başarısız. Lütfen tekrar giriş yapın.',
            });
            return;
        }
        // Frontend formatı: { phoneNumber, message, residentId?, unitId?, siteId?, recipientName? }
        // Legacy format: { siteId, phone, message }
        const body = req.body;
        const phoneNumber = body.phoneNumber || body.phone || '';
        const message = body.message || '';
        if (!phoneNumber) {
            res.status(400).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'invalid_phone',
                user_message: 'Telefon numarası zorunlu.',
            });
            return;
        }
        if (!message || !String(message).trim()) {
            res.status(400).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'empty_message',
                user_message: 'Mesaj metni zorunlu.',
            });
            return;
        }
        // Gerçek Evolution gönderimi + arşivleme
        const result = await (0, whatsapp_service_1.sendEvolutionTextMessage)(ctx.companyId, ctx.siteId, phoneNumber, message, {
            residentId: body.residentId,
            unitId: body.unitId,
            recipientName: body.recipientName,
        });
        // ═══ HER DURUMDA JSON dön — result her zaman dolu ═══
        const statusCode = result.success ? 200
            : (result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500);
        console.log(`[handleSiteSend] Yanıt gönderiliyor: HTTP ${statusCode}, success=${result.success}, status=${result.status}, providerMsgId=${result.providerMessageId || 'YOK'}, archiveId=${result.archiveId || 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteSend] BEKLENMEYEN HATA — Response gönderilemedi! ${errMsg}`, err);
        // Express 4'te async handler exception'ı response gönderilmezse request asılı kalır.
        // Bu catch HER ZAMAN JSON dönmesini garanti eder.
        res.status(500).json({
            success: false,
            status: 'FAILED',
            sent: 0,
            failed: 1,
            total: 1,
            error_type: 'internal_handler_error',
            user_message: `Sunucu iç hatası: ${errMsg}`,
        });
    }
}
exports.handleSiteSend = handleSiteSend;
async function handleSiteBulkSend(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    // Token'dan company context çöz
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, req.body.siteId);
    if (!ctx) {
        res.status(401).json({
            success: false, status: 'FAILED', sent: 0, failed: 0, total: 0,
            error_type: 'auth_required',
            user_message: 'Yetkilendirme başarısız. Lütfen tekrar giriş yapın.',
            results: [],
        });
        return;
    }
    // Frontend formatı: { recipients: [{ phoneNumber, name?, residentId?, unitId?, siteId? }], message }
    // Legacy format: { recipients: [{ phone, message }] }
    const body = req.body;
    const message = body.message || '';
    const recipientsRaw = body.recipients || [];
    if (!recipientsRaw || !Array.isArray(recipientsRaw) || recipientsRaw.length === 0) {
        res.status(400).json({
            success: false, status: 'FAILED', sent: 0, failed: 0, total: 0,
            error_type: 'empty_recipients',
            user_message: 'Alıcı listesi boş.',
            results: [],
        });
        return;
    }
    if (!message || !String(message).trim()) {
        res.status(400).json({
            success: false, status: 'FAILED', sent: 0, failed: recipientsRaw.length, total: recipientsRaw.length,
            error_type: 'empty_message',
            user_message: 'Mesaj metni zorunlu.',
            results: [],
        });
        return;
    }
    // Frontend formatına dönüştür
    const recipients = recipientsRaw.map((r) => ({
        phoneNumber: r.phoneNumber || r.phone || '',
        name: r.name || '',
        residentId: r.residentId || undefined,
        unitId: r.unitId || undefined,
        siteId: r.siteId || ctx.siteId,
    }));
    // Gerçek Evolution toplu gönderimi + arşivleme
    const result = await (0, whatsapp_service_1.sendEvolutionBulkMessages)(ctx.companyId, ctx.siteId, recipients, message);
    res.status(result.success ? 200 : 200).json(result); // PARTIAL_FAILED de 200 döner
}
exports.handleSiteBulkSend = handleSiteBulkSend;
async function handleSiteDirectSend(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        // Token'dan company context çöz
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, req.body.siteId);
        if (!ctx) {
            res.status(401).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'auth_required',
                user_message: 'Yetkilendirme başarısız. Lütfen tekrar giriş yapın.',
            });
            return;
        }
        // Frontend formatı: { phoneNumber, message } veya { phone, message }
        const body = req.body;
        const phoneNumber = body.phoneNumber || body.phone || '';
        const message = body.message || '';
        if (!phoneNumber) {
            res.status(400).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'invalid_phone',
                user_message: 'Telefon numarası zorunlu.',
            });
            return;
        }
        if (!message || !String(message).trim()) {
            res.status(400).json({
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                error_type: 'empty_message',
                user_message: 'Mesaj metni zorunlu.',
            });
            return;
        }
        // Tam Evolution gönderim akışı — manager fallback + bridge state + env + arşivleme
        const result = await (0, whatsapp_service_1.sendEvolutionTextMessage)(ctx.companyId, ctx.siteId, phoneNumber, message);
        const statusCode = result.success ? 200
            : (result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500);
        console.log(`[handleSiteDirectSend] Yanıt: HTTP ${statusCode}, success=${result.success}, providerMsgId=${result.providerMessageId || 'YOK'}`);
        res.status(statusCode).json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleSiteDirectSend] BEKLENMEYEN HATA: ${errMsg}`, err);
        res.status(500).json({
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            error_type: 'internal_handler_error',
            user_message: `Sunucu iç hatası: ${errMsg}`,
        });
    }
}
exports.handleSiteDirectSend = handleSiteDirectSend;
// ═══════════════════════════════════════════════════
//  Health (Evolution API — Baileys yok)
// ═══════════════════════════════════════════════════
async function handleHealth(_req, res) {
    try {
        const report = await (0, whatsapp_service_1.getHealth)();
        // KG_RESTORE_HEALTH_OPEN_20260804: Evolution open / session CONNECTED = UI connected (manager baileys false on this stack)
        const evoOpen = Array.isArray(report.evolution_instances) && report.evolution_instances.some((x) => {
            const st = String(x.status || x.connectionStatus || '').toLowerCase();
            return st === 'open' || st === 'connected';
        });
        const sessOpen = Array.isArray(report.sessions) && report.sessions.some((s) => String(s.status || '').toUpperCase() === 'CONNECTED');
        const liveConnected = !!(report.baileys_connected || evoOpen || sessOpen);
        res.json({
            status: 'ok',
            provider: report.provider,
            baileys_connected: liveConnected ? 'connected' : 'disconnected',
            puppeteer_chrome_missing: false,
            puppeteer: 'not_required',
            puppeteer_error: null,
            evolution_api: report.evolution_api_status,
            evolution_api_status: report.evolution_api_status,
            evolution_api_error: report.evolution_api_error,
            evolution_api_version: report.evolution_api_version,
            evolution_instances: report.evolution_instances,
            websocket: liveConnected ? 'connected' : 'disconnected',
            ws: liveConnected ? 'connected' : 'disconnected',
            qr_listener: 'ready',
            qr: 'available',
            instance: 'running',
            instance_status: 'running',
            service: report.service,
            bridge: report.bridge,
            version: report.version,
            sessions: report.sessions,
            totalSessions: report.totalSessions,
            modules: { baileys: false, qr_method: 'external_api_primary' },
            timestamp: report.timestamp,
            uptime: report.uptime,
        });
    }
    catch (err) {
        const msg = err.message || 'Bilinmeyen hata';
        console.error(`[handleHealth] CRASH: ${msg}`);
        // Her durumda 200 döndür ama degraded bilgisi ver
        res.json({
            status: 'degraded',
            provider: 'evolution-api',
            baileys_connected: 'disconnected',
            puppeteer_chrome_missing: false,
            puppeteer: 'not_required',
            puppeteer_error: null,
            evolution_api: 'unreachable',
            evolution_api_status: 'unreachable',
            evolution_api_error: msg,
            evolution_api_version: null,
            evolution_instances: [],
            websocket: 'listening',
            ws: 'listening',
            qr_listener: 'ready',
            qr: 'available',
            instance: 'running',
            instance_status: 'running',
            service: 'proyonetim-radore-api',
            bridge: 'disconnected',
            version: '4.0.0-enterprise',
            sessions: [],
            totalSessions: 0,
            modules: { baileys: false, qr_method: 'external_api_primary' },
            timestamp: new Date().toISOString(),
            uptime: 0,
            error: msg,
        });
    }
}
exports.handleHealth = handleHealth;
/** Enterprise health endpoint */
async function handleEnterpriseHealth(_req, res) {
    try {
        const report = await (0, whatsapp_service_1.getEnterpriseHealth)();
        const totalStats = whatsapp_queue_1.messageQueue.getTotalStats();
        res.json({
            status: 'ok',
            service: report.service,
            provider: report.provider,
            version: report.version,
            timestamp: report.timestamp,
            uptime: report.uptime,
            evolution_api: report.evolution_api_status,
            evolution_api_status: report.evolution_api_status,
            evolution_api_error: report.evolution_api_error,
            evolution_api_version: report.evolution_api_version,
            evolution_instances: report.evolution_instances,
            sessions: report.sessions,
            totalSessions: report.totalSessions,
            baileys_connected: report.baileys_connected,
            bridge: report.bridge,
            queue: totalStats,
            manager: {
                totalClients: whatsapp_manager_1.whatsAppManager.size,
                connectedClients: whatsapp_manager_1.whatsAppManager.connectedCount,
            },
        });
    }
    catch (err) {
        const msg = err.message || 'Bilinmeyen hata';
        console.error(`[handleEnterpriseHealth] CRASH: ${msg}`);
        res.json({
            status: 'degraded',
            service: 'proyonetim-radore-api',
            provider: 'evolution-api',
            version: '4.0.0-enterprise',
            timestamp: new Date().toISOString(),
            uptime: 0,
            evolution_api: 'unreachable',
            evolution_api_status: 'unreachable',
            evolution_api_error: msg,
            evolution_api_version: null,
            evolution_instances: [],
            sessions: [],
            totalSessions: 0,
            baileys_connected: false,
            bridge: 'disconnected',
            queue: { pending: 0, sending: 0, sentToday: 0, failed: 0 },
            manager: {
                totalClients: whatsapp_manager_1.whatsAppManager.size,
                connectedClients: whatsapp_manager_1.whatsAppManager.connectedCount,
            },
            error: msg,
        });
    }
}
exports.handleEnterpriseHealth = handleEnterpriseHealth;
/** Site session listesi */
async function handleSessionList(_req, res) {
    const sessions = whatsapp_manager_1.whatsAppManager.getAllClients();
    res.json({ sessions, total: sessions.length });
}
exports.handleSessionList = handleSessionList;
/** Kuyruk istatistikleri */
async function handleQueueStats(req, res) {
    const siteId = req.query.siteId || '';
    if (!(0, whatsapp_dto_1.validateSiteId)(siteId)) {
        res.status(400).json({ error: 'siteId query parametresi zorunlu' });
        return;
    }
    const stats = whatsapp_queue_1.messageQueue.getStats(siteId);
    res.json(stats);
}
exports.handleQueueStats = handleQueueStats;
/**
 * Full System Diagnostics — 14 kontrol noktasi
 * GET /api/whatsapp/diagnostics?siteId=xxx
 */
async function handleDiagnostics(req, res) {
    try {
        const siteId = req.query.siteId || '';
        const report = await (0, whatsapp_diagnostics_1.runFullDiagnostics)(siteId || undefined, {
            headers: req.headers,
            protocol: req.protocol,
        });
        const statusCode = report.overallStatus === 'unhealthy' ? 503
            : report.overallStatus === 'degraded' ? 200
                : 200;
        res.status(statusCode).json(report);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        const errStack = err.stack || '';
        console.error(`[handleDiagnostics] HATA: ${errMsg}`);
        console.error(`[handleDiagnostics] STACK: ${errStack}`);
        // Her durumda valid JSON dön — frontend JSON parse hatası almasın
        res.status(200).json({
            timestamp: new Date().toISOString(),
            overallStatus: 'unhealthy',
            totalChecks: 1,
            okCount: 0,
            errorCount: 1,
            warningCount: 0,
            items: [
                {
                    id: 'diagnostics-handler-error',
                    label: 'Tanılama Sistemi',
                    description: 'Tanılama çalışması beklenmediğik hatayla karşılaştı',
                    status: 'error',
                    message: `Tanılama başarısız: ${errMsg}`,
                    checkedAt: new Date().toISOString(),
                    latencyMs: 0,
                    category: 'core',
                    details: {
                        errorMessage: errMsg,
                        stackPreview: errStack.split('\n').slice(0, 5).join(' | '),
                    },
                },
            ],
            serviceInfo: {
                name: 'Radore WhatsApp Gateway',
                version: '4.0.0-enterprise',
                nodeVersion: process.version,
                platform: process.platform,
                uptimeSeconds: Math.floor(process.uptime()),
            },
        });
    }
}
exports.handleDiagnostics = handleDiagnostics;
/**
 * Self-Healing — tek bir kontrol kalemi için otomatik düzeltme
 * POST /api/whatsapp/diagnostics/heal
 */
async function handleHeal(req, res) {
    const { itemId } = req.body;
    const siteId = req.query.siteId || req.body.siteId || '';
    if (!itemId) {
        res.status(400).json({ success: false, error: 'itemId zorunlu' });
        return;
    }
    const result = await (0, whatsapp_healing_1.healDiagnosticItem)(itemId, siteId || undefined);
    res.status(result.success ? 200 : 500).json(result);
}
exports.handleHeal = handleHeal;
/**
 * Multi-Tenant Diagnostics — Firma bazlı tam sistem durumu.
 * GET /api/whatsapp/site/diagnostics
 */
async function handleSiteDiagnostics(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: 'Yetkilendirme gerekli' });
        return;
    }
    const siteId = req.query.siteId || req.body?.siteId || '';
    const result = await (0, whatsapp_service_1.getMultiTenantDiagnostics)(token, siteId);
    res.json(result);
}
exports.handleSiteDiagnostics = handleSiteDiagnostics;
// ═══════════════════════════════════════════════════
//  HİBRİT MİMARİ: Kanal Yönetimi Endpoint'leri
// ═══════════════════════════════════════════════════
/**
 * GET /api/whatsapp/channels
 * Firmanın tüm WhatsApp kanallarını listeler.
 */
async function handleGetChannels(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: 'Yetkilendirme gerekli' });
        return;
    }
    const siteId = req.query.siteId || req.body?.siteId || '';
    const result = await (0, whatsapp_service_1.getCompanyChannels)(token, siteId);
    res.json(result);
}
exports.handleGetChannels = handleGetChannels;
/**
 * POST /api/whatsapp/channels/default
 * Varsayılan kanalı değiştir.
 */
async function handleSetDefaultChannel(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: 'Yetkilendirme gerekli' });
        return;
    }
    const { channelType, siteId } = req.body;
    if (!channelType || (channelType !== 'CONNECTED_DEVICE' && channelType !== 'OFFICIAL_CLOUD_API')) {
        res.status(400).json({
            success: false,
            channelType: channelType || '',
            message: 'channelType "CONNECTED_DEVICE" veya "OFFICIAL_CLOUD_API" olmalıdır.',
        });
        return;
    }
    const result = await (0, whatsapp_service_1.setDefaultChannel)(token, channelType, siteId);
    res.status(result.success ? 200 : 400).json(result);
}
exports.handleSetDefaultChannel = handleSetDefaultChannel;
// ═══════════════════════════════════════════════════
//  ARCHIVE DOĞRULAMA — Canlı Gönderim Testi
// ═══════════════════════════════════════════════════
/**
 * GET /api/whatsapp/site/archive/verify?providerMessageId=xxx
 * Belirtilen providerMessageId için whatsapp_message_archive içinde
 * SENT kaydı var mı kontrol eder. Canlı gönderim testinde KAPI 6 için kullanılır.
 */
async function handleArchiveVerify(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ error: 'Yetkilendirme gerekli' });
            return;
        }
        const providerMessageId = req.query.providerMessageId || '';
        if (!providerMessageId) {
            res.status(400).json({ error: 'providerMessageId query parametresi zorunlu' });
            return;
        }
        // Token'dan company context çöz
        const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, req.query.siteId || undefined);
        if (!ctx) {
            res.status(401).json({ error: 'Yetkilendirme başarısız.' });
            return;
        }
        const result = await (0, whatsapp_service_1.verifyArchiveRecord)(ctx.companyId, providerMessageId);
        res.json(result);
    }
    catch (err) {
        const errMsg = err.message || 'Bilinmeyen hata';
        console.error(`[handleArchiveVerify] HATA: ${errMsg}`, err);
        res.status(500).json({ error: errMsg });
    }
}
exports.handleArchiveVerify = handleArchiveVerify;
//# sourceMappingURL=whatsapp.controller.js.map