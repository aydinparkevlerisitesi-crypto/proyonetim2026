"use strict";
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
exports.verifyArchiveRecord = exports.getMultiTenantDiagnostics = exports.getEnterpriseHealth = exports.getHealth = exports.sendDirectMessage = exports.queueBulkMessages = exports.queueMessage = exports.reconnectCompany = exports.disconnectCompany = exports.setDefaultChannel = exports.getCompanyChannels = exports.getCompanyQr = exports.getCompanyStatus = exports.sendEvolutionBulkMessages = exports.sendEvolutionTextMessage = exports.sendSiteDirectMessage = exports.sendSiteBulkMessages = exports.sendSiteMessage = exports.reconnectSite = exports.disconnectSite = exports.getSiteQr = exports.getSiteStatus = exports.connectSite = exports.connectCompany = exports.multiTenantDisconnect = exports.multiTenantStatus = exports.multiTenantConnect = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const fetchCompat_1 = require("../../lib/fetchCompat");
const whatsapp_session_1 = require("./whatsapp.session");
const whatsapp_manager_1 = require("./whatsapp.manager");
const whatsapp_queue_1 = require("./whatsapp.queue");
const whatsapp_repository_1 = require("./whatsapp.repository");
const whatsapp_lock_1 = require("./whatsapp.lock");
const evolution_client_1 = require("./evolution.client");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
const whatsapp_rateLimit_1 = require("./whatsapp.rateLimit");
// ═══════════════════════════════════════════════════
//  LOG GÜVENLİĞİ: QR base64 yerine sadece meta bilgi logla
// ═══════════════════════════════════════════════════
function logQrSafe(label, data) {
    if (!data) {
        console.log(`[QR-Safe] ${label}: null`);
        return;
    }
    const base64 = data.base64;
    const code = data.code;
    console.log(`[QR-Safe] ${label}:`, {
        companyId: data.companyId,
        instanceName: data.instanceName,
        base64_exists: typeof base64 === 'string' && base64.length > 20,
        base64_length: typeof base64 === 'string' ? base64.length : 0,
        code_exists: typeof code === 'string' && code.length > 0,
        count: data.count,
        status: data.status,
        success: data.success,
    });
}
/**
 * Firma bazlı WhatsApp bağlantısı başlat — Multi-Tenant.
 *
 * Akış:
 * 1. Token doğrula → userId + companyId çöz
 * 2. Lock al (aynı firmaya 10 istek → 1 connect)
 * 3. DB'de instance kaydı bul/oluştur
 * 4. Evolution API'de instance var mi kontrol et
 * 5. Yoksa create, varsa connect çağır
 * 6. QR base64 varsa döndür
 */
async function multiTenantConnect(params) {
    const startTime = Date.now();
    // ═══ 1. Token doğrula + company_id çöz ═══
    let ctx = null;
    try {
        ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(params.token, params.siteId);
    }
    catch (err) {
        const msg = err.message;
        console.error(`[MultiTenantConnect] ADIM 1 FAIL — resolveCompanyContext: ${msg}`);
        return {
            success: false, status: 'ERROR', siteId: params.siteId || '', companyId: undefined,
            qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
            error: msg, errorType: 'auth_required',
            userMessage: 'Yetkilendirme başarısız. Lütfen tekrar giriş yapın.',
        };
    }
    if (!ctx) {
        console.error(`[MultiTenantConnect] ADIM 1 FAIL — ctx=null (token geçersiz)`);
        return {
            success: false, status: 'ERROR', siteId: params.siteId || '', companyId: undefined,
            qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
            error: 'auth_failed', errorType: 'auth_required',
            userMessage: 'Yetkilendirme başarısız. Lütfen tekrar giriş yapın.',
        };
    }
    const { companyId, siteId, userId } = ctx;
    console.log(`[MultiTenantConnect] ADIM 1 OK — companyId=${companyId}, siteId=${siteId}, userId=${userId}`);
    // ═══ 2. Rate limit kontrolü ═══
    if (!whatsapp_rateLimit_1.companyRateLimiter.check(companyId, 'connect')) {
        console.log(`[MultiTenantConnect] ADIM 2 FAIL — rate limit: companyId=${companyId}`);
        return {
            success: false, status: 'RATE_LIMITED', siteId, companyId,
            qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
            error: 'rate_limited', errorType: 'rate_limit',
            userMessage: 'Çok fazla bağlantı isteği. Lütfen 30 saniye bekleyip tekrar deneyin.',
        };
    }
    console.log(`[MultiTenantConnect] ADIM 2 OK — rate limit geçti`);
    // ═══ 3. Lock al ═══
    if (!whatsapp_lock_1.whatsAppLock.acquire(companyId, 'connect')) {
        console.log(`[MultiTenantConnect] ADIM 3 FAIL — lock: companyId=${companyId}`);
        return {
            success: false, status: 'LOCKED', siteId, companyId,
            qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
            error: 'already_connecting', errorType: 'rate_limit',
            userMessage: 'Bu firma için bağlantı işlemi zaten devam ediyor. Lütfen bekleyin.',
        };
    }
    console.log(`[MultiTenantConnect] ADIM 3 OK — lock alındı`);
    try {
        // ═══ 4. DB kaydı bul/oluştur ═══
        let dbInstance;
        try {
            dbInstance = await whatsapp_repository_1.whatsAppRepository.findOrCreateCompanyInstance({
                companyId,
                siteId,
                createdBy: userId,
            });
            console.log(`[MultiTenantConnect] ADIM 4 OK — dbInstance.instanceName=${dbInstance.instance_name}`);
        }
        catch (err) {
            const msg = err.message;
            console.error(`[MultiTenantConnect] ADIM 4 FAIL — findOrCreateCompanyInstance: ${msg}`);
            return {
                success: false, status: 'ERROR', siteId, companyId,
                qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
                error: msg, errorType: 'db_error',
                userMessage: `Veritabanı hatası: ${msg}`,
            };
        }
        // Migration uyumluluğu: DB'deki instance_name'i kullan
        const instanceName = dbInstance.instance_name;
        // ═══ 5. WhatsAppManager'da client oluştur ═══
        let client;
        try {
            client = await whatsapp_manager_1.whatsAppManager.createClient({
                siteId,
                companyId,
                phoneNumber: params.phoneNumber,
                instanceName,
            });
            console.log(`[MultiTenantConnect] ADIM 5 OK — client oluşturuldu, instanceName=${instanceName}`);
        }
        catch (err) {
            const msg = err.message;
            console.error(`[MultiTenantConnect] ADIM 5 FAIL — createClient: ${msg}`);
            return {
                success: false, status: 'ERROR', siteId, companyId,
                qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
                error: msg, errorType: 'manager_error',
                userMessage: `Client oluşturma hatası: ${msg}`,
            };
        }
        // ═══ 6. Evolution API connect ═══
        let result;
        try {
            result = await client.connect();
            console.log(`[MultiTenantConnect] ADIM 6 — client.connect() tamamlandı: success=${result.success}, qrCode=${result.qrCode ? `VAR (uzunluk: ${result.qrCode.length})` : 'YOK'}, errorType=${result.errorType || 'none'}, error=${result.error || 'none'}`);
        }
        catch (err) {
            const msg = err.message;
            console.error(`[MultiTenantConnect] ADIM 6 FAIL — client.connect() exception: ${msg}`);
            return {
                success: false, status: 'ERROR', siteId, companyId,
                qrCode: null, qr_code: null, base64: null, instance: instanceName, provider: 'evolution-api',
                error: msg, errorType: 'manager_error',
                userMessage: `Evolution API bağlantı hatası: ${msg}`,
            };
        }
        // ═══ 7. HİBRİT: Kanal tablosunu güncelle (CONNECTED_DEVICE her zaman mevcut) ═══
        try {
            await whatsapp_repository_1.whatsAppRepository.findOrCreateConnectedDeviceChannel({
                companyId,
                instanceName,
                senderPhone: params.phoneNumber,
            });
            console.log(`[MultiTenantConnect] ADIM 7 OK — kanal güncellendi`);
        }
        catch (err) {
            const msg = err.message;
            console.warn(`[MultiTenantConnect] ADIM 7 WARN — findOrCreateConnectedDeviceChannel: ${msg}`);
            // Non-critical — devam et
        }
        // ═══ 8. DB durumunu güncelle ═══
        const info = client.getSessionInfo();
        const now = new Date().toISOString();
        try {
            if (result.success && (result.alreadyConnected || info.status === 'CONNECTED')) {
                // PHONE_WEB_E2E_20260804: Evolution zaten open — QR yok, CONNECTED yaz
                await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                    connectionStatus: 'CONNECTED',
                    qrStatus: null,
                    profileName: info.profileName,
                    phoneNumber: info.phoneNumber || params.phoneNumber || null,
                    lastConnectedAt: now,
                    lastError: null,
                    lastErrorType: null,
                    siteId,
                });
                console.log(`[MultiTenantConnect] ADIM 8 OK — DB: CONNECTED (alreadyConnected/PHONE_WEB_E2E_20260804)`);
            }
            else if (result.success && result.qrCode) {
                // ✅ QR başarıyla alındı
                await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                    connectionStatus: 'WAITING_QR',
                    qrStatus: 'QR_READY',
                    profileName: info.profileName,
                    lastQrAt: now,
                    lastError: null,
                    lastErrorType: null,
                    siteId,
                });
                console.log(`[MultiTenantConnect] ADIM 8 OK — DB: WAITING_QR + QR_READY`);
            }
            else {
                // ❌ QR alınamadı
                const finalError = result.error || 'QR üretilemedi';
                const finalErrorType = result.errorType || 'qr_generation_failed';
                await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                    connectionStatus: 'ERROR',
                    lastError: finalError,
                    lastErrorType: finalErrorType,
                    siteId,
                });
                console.log(`[MultiTenantConnect] ADIM 8 — DB: ERROR (errorType=${finalErrorType}, error=${finalError})`);
            }
        }
        catch (err) {
            const msg = err.message;
            console.warn(`[MultiTenantConnect] ADIM 8 WARN — updateCompanyInstanceStatus: ${msg}`);
            // Non-critical — devam et
        }
        // ═══ 9. Response oluştur — instanceName HER ZAMAN dolu ═══
        const already = !!(result.alreadyConnected || (result.success && info.status === 'CONNECTED' && !result.qrCode));
        const response = {
            success: result.success,
            // PHONE_WEB_E2E_20260804
            status: result.success
                ? (already ? 'CONNECTED' : (info.status === 'WAITING_QR' || info.qrCode || result.qrCode ? 'QR_READY' : (info.status || 'WAITING_QR')))
                : 'ERROR',
            alreadyConnected: already,
            qrAvailable: !!(result.qrCode || info.qrCode),
            siteId,
            companyId,
            qrCode: result.qrCode || info.qrCode || null,
            qr_code: result.qrCode || info.qrCode || null,
            base64: result.qrCode || info.qrCode || null,
            phoneNumber: info.phoneNumber,
            profileName: info.profileName,
            instance: instanceName,
            provider: 'evolution-api',
            error: already ? null : (result.error || null),
            errorType: already ? undefined : (result.errorType || (result.error ? 'connect_failed' : undefined)),
            userMessage: already ? 'WhatsApp zaten bağlı — oturum korundu.' : (result.userMessage || result.error || undefined),
        };
        // QR-safe log
        logQrSafe('MultiTenantConnect response', response);
        const elapsed = Date.now() - startTime;
        console.log(`[MultiTenantConnect] ✅ Tamamlandı: ${elapsed}ms, success=${response.success}, status=${response.status}, instance=${instanceName}, qrCode=${response.qrCode ? 'VAR' : 'YOK'}, companyId=${companyId}`);
        return response;
    }
    catch (err) {
        const errMsg = err.message;
        const errStack = err.stack || 'stack yok';
        console.error(`[MultiTenantConnect] BEKLENMEDİK HATA (outer catch): ${errMsg}`);
        console.error(`[MultiTenantConnect] STACK: ${errStack}`);
        try {
            await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                connectionStatus: 'ERROR',
                lastError: errMsg,
                lastErrorType: 'manager_error',
            });
        }
        catch { /* sessiz */ }
        return {
            success: false,
            status: 'ERROR',
            siteId,
            companyId,
            qrCode: null,
            qr_code: null,
            base64: null,
            instance: instanceName,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'manager_error',
            userMessage: `Evolution API bağlantı yöneticisi hatası: ${errMsg}`,
            debug: { stack: errStack.split('\n').slice(0, 5) },
        };
    }
    finally {
        whatsapp_lock_1.whatsAppLock.release(companyId, 'connect');
    }
}
exports.multiTenantConnect = multiTenantConnect;
/**
 * Multi-tenant status sorgulama.
 * Token'dan company_id çöz, instance'ın durumunu döndür.
 */
async function multiTenantStatus(token, siteId) {
    const lastCheckedAt = new Date().toISOString();
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
    if (!ctx) {
        return {
            success: false,
            siteId: siteId || '',
            companyId: undefined,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            phoneNumber: null,
            profileName: null,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: null,
            qrAvailable: false,
            hasQr: false,
            qrCode: null,
            error: 'auth_failed',
            sessionPath: null,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt,
        };
    }
    const { companyId, siteId: resolvedSiteId } = ctx;
    // ═══ AKTİF WHATSAPP BAĞLAMINI ÇÖZ ═══
    // Bu fonksiyon bridge_state → company_channels → sessions → ENV zincirini
    // tarar ve Evolution API'den canlı connectionState kontrolü yapar.
    // sendEvolutionTextMessage ile AYNI fonksiyondur.
    const activeCtx = await (0, whatsapp_helpers_1.getActiveWhatsAppContext)(companyId);
    console.log(`[multiTenantStatus] Aktif bağlam: connected=${activeCtx.connected}, status=${activeCtx.status}, state=${activeCtx.state}, instance=${activeCtx.instanceName}, source=${activeCtx.source}`);
    // ═══ CONNECTED ise DB'yi senkronize et ═══
    if (activeCtx.connected) {
        try {
            await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                connectionStatus: 'CONNECTED',
                qrStatus: null,
                phoneNumber: activeCtx.phone || undefined,
                profileName: activeCtx.profileName || undefined,
                lastConnectedAt: activeCtx.lastCheckedAt,
                lastError: null,
                siteId: resolvedSiteId,
            });
        }
        catch { /* DB güncelleme hatası UI'ı etkilemez */ }
        return {
            success: true,
            siteId: resolvedSiteId,
            companyId,
            status: 'CONNECTED',
            connected: true,
            state: activeCtx.state,
            phoneNumber: activeCtx.phone,
            profileName: activeCtx.profileName,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: activeCtx.lastCheckedAt,
            qrAvailable: false,
            hasQr: false,
            qrCode: null,
            error: null,
            sessionPath: null,
            instanceName: activeCtx.instanceName,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt,
        };
    }
    // ═══ QR_READY ise DB'de de güncelle ═══
    if (activeCtx.status === 'QR_READY') {
        try {
            await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                connectionStatus: 'WAITING_QR',
                qrStatus: 'QR_READY',
                lastError: null,
                siteId: resolvedSiteId,
            });
        }
        catch { /* sessiz */ }
        return {
            success: true,
            siteId: resolvedSiteId,
            companyId,
            status: 'QR_READY',
            connected: false,
            state: activeCtx.state,
            phoneNumber: activeCtx.phone,
            profileName: activeCtx.profileName,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: null,
            qrAvailable: true,
            hasQr: true,
            qrCode: null,
            error: null,
            sessionPath: null,
            instanceName: activeCtx.instanceName,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt,
        };
    }
    // ═══ DISCONNECTED veya CONNECTING ═══
    return {
        success: true,
        siteId: resolvedSiteId,
        companyId,
        status: activeCtx.status,
        connected: false,
        state: activeCtx.state,
        phoneNumber: activeCtx.phone,
        profileName: activeCtx.profileName,
        battery: null,
        lastSeen: null,
        sessionAge: 0,
        connectedAt: null,
        qrAvailable: false,
        hasQr: false,
        qrCode: null,
        error: null,
        sessionPath: null,
        instanceName: activeCtx.instanceName,
        provider: 'evolution',
        channel: 'CONNECTED_DEVICE',
        lastCheckedAt,
    };
}
exports.multiTenantStatus = multiTenantStatus;
/**
 * Multi-tenant disconnect.
 * SADECE ilgili firmanın instance'ını disconnect et.
 */
async function multiTenantDisconnect(token, siteId) {
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
    if (!ctx) {
        return { success: false, siteId: siteId || '', status: 'AUTH_FAILED' };
    }
    const { companyId, siteId: resolvedSiteId } = ctx;
    const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId);
    // Manager'da disconnect
    const client = whatsapp_manager_1.whatsAppManager.getClient(resolvedSiteId);
    if (client) {
        await client.disconnect();
    }
    // DB güncelle
    const now = new Date().toISOString();
    await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
        connectionStatus: 'DISCONNECTED',
        qrStatus: null,
        lastDisconnectedAt: now,
        lastError: null,
    });
    console.log(`[MultiTenantDisconnect] ${instanceName} (company: ${companyId}) disconnect edildi`);
    return { success: true, siteId: resolvedSiteId, companyId, status: 'DISCONNECTED' };
}
exports.multiTenantDisconnect = multiTenantDisconnect;
/**
 * Firma için WhatsApp bağlantısı başlat — Evolution API üzerinden.
 */
async function connectCompany(companyId, phoneNumber, instanceName) {
    console.log(`[connectCompany] Evolution API ile bağlantı başlatılıyor: companyId=${companyId}, instanceName=${instanceName || 'varsayılan'}`);
    try {
        const result = await connectSite(companyId, companyId, phoneNumber, instanceName);
        return {
            success: result.success,
            status: result.status,
            qr_code: result.qrCode || null,
            phone_number: result.phoneNumber || phoneNumber || null,
            error: result.error,
            error_type: result.errorType,
            user_message: result.userMessage,
        };
    }
    catch (err) {
        const errMsg = err.message;
        return {
            success: false,
            status: 'ERROR',
            error: errMsg,
            error_type: 'evolution_api_error',
            user_message: `Evolution API bağlantı hatası: ${errMsg}`,
        };
    }
}
exports.connectCompany = connectCompany;
// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Bağlantı (WhatsAppManager)
// ═══════════════════════════════════════════════════
async function connectSite(siteId, companyId, phoneNumber, instanceName) {
    try {
        const client = await whatsapp_manager_1.whatsAppManager.createClient({
            siteId,
            companyId,
            phoneNumber,
            instanceName,
        });
        const result = await client.connect();
        const info = client.getSessionInfo();
        const response = {
            success: result.success,
            status: info.status === 'WAITING_QR' || info.qrCode ? 'QR_READY' : info.status,
            siteId,
            companyId,
            qrCode: result.qrCode || info.qrCode || null,
            qr_code: result.qrCode || info.qrCode || null,
            base64: result.qrCode || info.qrCode || null,
            phoneNumber: info.phoneNumber,
            profileName: info.profileName,
            instance: client.instanceName,
            provider: 'evolution-api',
            error: result.error,
            errorType: result.errorType || (result.error ? 'connect_failed' : undefined),
            userMessage: result.userMessage || result.error || undefined,
        };
        logQrSafe('connectSite response', response);
        return response;
    }
    catch (err) {
        const errMsg = err.message;
        return {
            success: false,
            status: 'ERROR',
            siteId,
            companyId,
            qrCode: null,
            qr_code: null,
            instance: null,
            provider: 'evolution-api',
            error: errMsg,
            errorType: 'manager_error',
            userMessage: `Evolution API bağlantı yöneticisi hatası: ${errMsg}`,
        };
    }
}
exports.connectSite = connectSite;
async function getSiteStatus(siteId, companyId) {
    const lastCheckedAt = new Date().toISOString();
    // ═══ AKTİF WHATSAPP BAĞLAMINI ÇÖZ ═══
    // Eğer companyId yoksa, siteId'den çözmeye çalış
    let effectiveCompanyId = companyId;
    if (!effectiveCompanyId) {
        try {
            const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
            const { data: site } = await sb.from('sites').select('company_id').eq('id', siteId).maybeSingle();
            effectiveCompanyId = site?.company_id || undefined;
        }
        catch { /* sessiz */ }
    }
    if (!effectiveCompanyId) {
        return {
            success: true,
            siteId,
            companyId,
            status: 'DISCONNECTED',
            connected: false,
            state: 'close',
            phoneNumber: null,
            profileName: null,
            battery: null,
            lastSeen: null,
            sessionAge: 0,
            connectedAt: null,
            qrAvailable: false,
            hasQr: false,
            qrCode: null,
            error: null,
            sessionPath: null,
            provider: 'evolution',
            channel: 'CONNECTED_DEVICE',
            lastCheckedAt,
        };
    }
    const activeCtx = await (0, whatsapp_helpers_1.getActiveWhatsAppContext)(effectiveCompanyId);
    // DB senkronizasyonu
    if (activeCtx.connected) {
        try {
            await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(effectiveCompanyId, {
                connectionStatus: 'CONNECTED',
                qrStatus: null,
                phoneNumber: activeCtx.phone || undefined,
                profileName: activeCtx.profileName || undefined,
                lastConnectedAt: activeCtx.lastCheckedAt,
                lastError: null,
                siteId,
            });
        }
        catch { /* sessiz */ }
    }
    return {
        success: true,
        siteId,
        companyId: effectiveCompanyId,
        status: activeCtx.status,
        connected: activeCtx.connected,
        state: activeCtx.state,
        phoneNumber: activeCtx.phone,
        profileName: activeCtx.profileName,
        battery: null,
        lastSeen: null,
        sessionAge: 0,
        connectedAt: activeCtx.connected ? activeCtx.lastCheckedAt : null,
        qrAvailable: activeCtx.status === 'QR_READY',
        hasQr: activeCtx.status === 'QR_READY',
        qrCode: null,
        error: null,
        sessionPath: null,
        instanceName: activeCtx.instanceName,
        provider: 'evolution',
        channel: 'CONNECTED_DEVICE',
        lastCheckedAt,
    };
}
exports.getSiteStatus = getSiteStatus;
async function getSiteQr(siteId, companyId) {
    const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
    if (client) {
        return {
            siteId,
            companyId,
            qrCode: client.getQrCode(),
            status: client.getStatus(),
            qrAvailable: !!client.getQrCode(),
        };
    }
    return {
        siteId,
        companyId,
        qrCode: null,
        status: 'DISCONNECTED',
        qrAvailable: false,
    };
}
exports.getSiteQr = getSiteQr;
async function disconnectSite(siteId, companyId) {
    const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
    if (client) {
        await client.disconnect();
        return { success: true, siteId, status: client.getStatus() };
    }
    await disconnectCompany(siteId);
    return { success: true, siteId, status: 'DISCONNECTED' };
}
exports.disconnectSite = disconnectSite;
async function reconnectSite(siteId, companyId, phoneNumber) {
    const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
    if (client) {
        const result = await client.reconnect();
        const info = client.getSessionInfo();
        const response = {
            success: result.success,
            status: info.status === 'WAITING_QR' || info.qrCode ? 'QR_READY' : info.status,
            siteId,
            companyId,
            qrCode: result.qrCode || null,
            qr_code: result.qrCode || null,
            base64: result.qrCode || null,
            phoneNumber: info.phoneNumber,
            error: result.error,
        };
        logQrSafe('reconnectSite response', response);
        return response;
    }
    return connectSite(siteId, companyId, phoneNumber);
}
exports.reconnectSite = reconnectSite;
// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Mesaj — DİREKT EVOLUTION GÖNDERİM
//  Artık message_queue kullanmaz, queue sadece toplu gönderim içindir.
//  Bu sayede RLS hatası YAŞANMAZ — tekli mesaj direkt gider.
// ═══════════════════════════════════════════════════
async function sendSiteMessage(siteId, companyId, phone, message, _priority) {
    // Tekli mesajda ASLA queue kullanma — direkt Evolution gönder
    const result = await sendEvolutionTextMessage(companyId || siteId, siteId, phone, message);
    if (result.success) {
        return {
            success: true,
            queueId: result.archiveId || undefined,
        };
    }
    return {
        success: false,
        error: result.user_message || 'Gönderim başarısız',
    };
}
exports.sendSiteMessage = sendSiteMessage;
async function sendSiteBulkMessages(siteId, companyId, recipients) {
    // Toplu gönderimde Evolution API üzerinden tek tek gönder
    // Eğer 50+ alıcı varsa queue kullan, yoksa direkt gönder
    if (recipients.length <= 50) {
        const bulkResult = await sendEvolutionBulkMessages(companyId || siteId, siteId, recipients.map((r) => ({ phoneNumber: r.phone })), recipients[0]?.message || '');
        return {
            success: bulkResult.success,
            queued: bulkResult.sent,
            failed: bulkResult.failed,
            queueIds: [],
        };
    }
    // 50+ alıcı → queue kullan (service_role client ile, RLS'ye takılmaz)
    return whatsapp_queue_1.messageQueue.enqueueBulk(siteId, companyId, recipients);
}
exports.sendSiteBulkMessages = sendSiteBulkMessages;
async function sendSiteDirectMessage(siteId, phone, message, companyId) {
    // Tam Evolution gönderim akışına yönlendir — manager fallback + bridge state + env + arşivleme
    return sendEvolutionTextMessage(companyId || siteId, siteId, phone, message);
}
exports.sendSiteDirectMessage = sendSiteDirectMessage;
// ═══════════════════════════════════════════════════
//  GERÇEK EVOLUTION GÖNDERİM + ARŞİVLEME
//  Frontend formatıyla uyumlu: phoneNumber (değil phone)
//  Evolution API → sendText → arşive yaz → response dön
// ═══════════════════════════════════════════════════
function normalizePhoneTR(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00'))
        d = d.slice(2);
    if (d.startsWith('0') && d.length === 11)
        d = '90' + d.slice(1);
    if (d.startsWith('5') && d.length === 10)
        d = '90' + d;
    if (d.startsWith('90') && d.length === 12)
        return d;
    return null;
}
// ════════════════════════ Evolution v2 response formatları (RECURSIVE DEEP SCAN):
// Format 1: { key: { id: "BAE5...", remoteJid: "90...@s.whatsapp.net" }, message: {...}, ... }
// Format 2: { message: { key: { id: "BAE5..." } }, ... }
// Format 3: { id: "BAE5...", ... }
// Format 4: { messageId: "BAE5...", ... }
// Format 5: Evolution v2.1+ { messages: [{ key: { id: "..." } }], ... }
// Format 6: { result: { key: { id: "..." } }, ... }
// Format 7: İç içe herhangi bir yerde "id"/"messageId"/"msgId" alanı
function extractMessageId(data, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 20)
        return null;
    const d = data;
    // Önce bilinen pattern'leri tara
    const known = d.key?.id
        || d.message?.key?.id
        || ((Array.isArray(d.messages) && d.messages.length > 0) ? d.messages[0]?.key?.id : null)
        || d.data?.key?.id
        || d.result?.key?.id
        || d.id
        || d.messageId
        || d.key?.remoteJid
        || null;
    if (known)
        return known;
    // Deep recursive scan
    if (Array.isArray(data)) {
        for (let i = 0; i < Math.min(data.length, 50); i++) {
            const found = extractMessageId(data[i], depth + 1);
            if (found)
                return found;
        }
    }
    else {
        const keys = Object.keys(d);
        for (const k of keys) {
            const v = d[k];
            if ((k === 'id' || k === 'messageId' || k === 'msgId' || k === 'msg_id') && typeof v === 'string' && v.length > 5) {
                return v;
            }
        }
        for (const k of keys) {
            const v = d[k];
            if (v && typeof v === 'object' && k !== '__proto__' && k !== 'constructor') {
                const found = extractMessageId(v, depth + 1);
                if (found)
                    return found;
            }
        }
    }
    return null;
}
/**
 * Tek bir mesajı Evolution API üzerinden gönder ve arşivle.
 *
 * ═══ KRİTİK MİMARİ DEĞİŞİKLİK ═══
 * Bu fonksiyon ARTIK getActiveWhatsAppContext() kullanır.
 * multiTenantStatus() ile AYNI instance çözümleme zincirini kullanır.
 * Status CONNECTED diyorsa, send de aynı instance üzerinden gönderir.
 *
 * @param companyId - Firma ID (aktif bağlam çözümü için)
 * @param siteId - Site ID (arşiv için)
 * @param phoneNumber - Hedef telefon (normalize edilir)
 * @param message - Mesaj metni
 * @param metadata - Arşiv için ek bilgiler (residentId, unitId, recipientName)
 */
async function sendEvolutionTextMessage(companyId, siteId, phoneNumber, message, metadata) {
    // ═══ 1. Telefon normalizasyonu ═══
    const normalized = normalizePhoneTR(phoneNumber);
    if (!normalized) {
        const response = {
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            instanceName: (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId), error_type: 'invalid_phone',
            user_message: 'Telefon numarası geçersiz.',
        };
        await archiveMessage(companyId, siteId, metadata, phoneNumber, '', response, (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId), message, 'evolution');
        return response;
    }
    // ═══ 2. Mesaj boş mu? ═══
    if (!message || !String(message).trim()) {
        const response = {
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            instanceName: (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId), normalizedPhone: normalized,
            error_type: 'empty_message', user_message: 'Mesaj metni boş olamaz.',
        };
        await archiveMessage(companyId, siteId, metadata, normalized, '', response, (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId), message, 'evolution');
        return response;
    }
    // ═══ 3. AKTİF WHATSAPP BAĞLAMINI ÇÖZ ═══
    // Bu, multiTenantStatus ile AYNI fonksiyondur.
    // Status ne görüyorsa, send de aynı instance'ı kullanır.
    const ctx = await (0, whatsapp_helpers_1.getActiveWhatsAppContext)(companyId);
    const instanceName = ctx.instanceName;
    console.log(`[EvoSend] Aktif bağlam: connected=${ctx.connected}, status=${ctx.status}, state=${ctx.state}, instance=${instanceName}, source=${ctx.source}, phone=${ctx.phone}`);
    // ═══ 3b. Status instance'ı da aynı anda çöz (karşılaştırma için) ═══
    // Status ve send aynı getActiveWhatsAppContext kullandığı için her zaman aynıdır.
    const statusInstanceName = instanceName;
    const sendInstanceName = instanceName;
    const sameInstance = true;
    const selectedRealInstance = ctx.selectedRealInstance;
    const availableInstances = ctx.availableInstances;
    // ═══ 4. Bağlantı durumu kontrolü ═══
    if (!ctx.connected) {
        const response = {
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            instanceName,
            normalizedPhone: normalized,
            error_type: 'instance_not_connected',
            user_message: ctx.status === 'QR_READY'
                ? 'WhatsApp cihaz bağlantısı henüz kurulmadı. Lütfen QR kodu okutun.'
                : 'WhatsApp cihaz bağlantısı aktif değil. Lütfen "Cihaz Bağla" sekmesinden QR kod ile bağlantı kurun.',
            technical: {
                instanceName,
                normalizedPhone: normalized,
                evolutionUrlPath: null,
                payloadWithoutSecret: null,
                providerStatus: null,
                providerResponse: null,
                contextSource: ctx.source,
                contextState: ctx.state,
                contextConnected: ctx.connected,
                reason: 'instance_not_connected',
                statusInstanceName,
                sendInstanceName,
                sameInstance,
                selectedRealInstance,
                availableInstances,
                currentBridgeInstance: ctx.currentBridgeInstance,
            },
        };
        await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
        return response;
    }
    // ═══ 5. Evolution API'ye DOĞRUDAN sendText ═══
    // ═══ KRİTİK MİMARİ DEĞİŞİKLİK ═══
    // Manager client'a BAĞIMLI DEĞİLİZ. Doğrudan Evolution API'ye fetch yapıyoruz.
    // Bu sayede manager'daki instanceName çakışması, client state sorunu,
    // sunucu restart sonrası bellek kaybı gibi problemler tamamen bypass edilir.
    // getActiveWhatsAppContext'in çözdüğü instanceName NE İSE,
    // gönderim de TAM OLARAK o instanceName'e yapılır.
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
    const evoKey = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    const trimmedMessage = String(message).trim();
    // InstanceName URL-safe encode et — nokta/boşluk gibi karakterler sorun yaratmasın
    const encodedInstance = encodeURIComponent(instanceName);
    const sendUrl = `${evoUrl}/message/sendText/${encodedInstance}`;
    console.log(`[EvoSend] Doğrudan Evolution API: instance=${instanceName}, encoded=${encodedInstance}, to=${normalized}, msg_preview=${trimmedMessage.substring(0, 50)}`);
    try {
        // ─── Doğrudan Evolution API çağrısı ───
        const evoRes = await (0, fetchCompat_1.safeFetch)(sendUrl, {
            method: 'POST',
            headers: { 'apikey': evoKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: normalized, text: trimmedMessage, delay: 1200, linkPreview: false }),
        }, 15000);
        let evoBody = {};
        try {
            const evoText = await evoRes.text();
            evoBody = evoText ? JSON.parse(evoText) : {};
        }
        catch {
            evoBody = { raw: 'parse_failed' };
        }
        // ─── HTTP 0 / network hata kontrolü ───
        if (!evoRes.ok && evoRes.status === 0) {
            const errMsg = 'Evolution API\'ye ulaşılamadı — ağ hatası veya instance adı geçersiz. Lütfen WhatsApp cihaz bağlantısını kontrol edin.';
            console.error(`[EvoSend] Evolution NETWORK HATA (status=0): url=${sendUrl}, instance=${instanceName}, to=${normalized}`);
            const response = {
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                instanceName, normalizedPhone: normalized,
                error_type: 'evolution_network_error',
                user_message: errMsg,
                technical: {
                    instanceName,
                    normalizedPhone: normalized,
                    evolutionUrlPath: sendUrl,
                    payloadWithoutSecret: { number: normalized, text: trimmedMessage.substring(0, 200), delay: 1200, linkPreview: false },
                    providerStatus: 0,
                    providerResponse: evoBody,
                    contextSource: ctx.source,
                    contextState: ctx.state,
                    contextConnected: ctx.connected,
                    statusInstanceName,
                    sendInstanceName,
                    sameInstance,
                    selectedRealInstance,
                    availableInstances,
                    currentBridgeInstance: ctx.currentBridgeInstance,
                    networkError: true,
                    encodedInstance,
                    requestErrorMessage: 'Evolution API\'ye ulaşılamadı — ağ hatası veya instance adı geçersiz',
                    requestErrorCode: 0,
                },
            };
            await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
            return response;
        }
        // ─── HTTP hata kontrolü (400, 404, 500, vb.) ───
        if (!evoRes.ok) {
            const errMsg = evoBody?.error || evoBody?.message || `HTTP ${evoRes.status}`;
            console.error(`[EvoSend] Evolution HTTP ${evoRes.status}: to=${normalized}, instance=${instanceName}, error=${errMsg}, body=`, JSON.stringify(evoBody).slice(0, 500));
            const response = {
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                instanceName, normalizedPhone: normalized,
                error_type: 'evolution_send_failed',
                user_message: `WhatsApp gönderim başarısız (HTTP ${evoRes.status}): ${errMsg}`,
                technical: {
                    instanceName,
                    normalizedPhone: normalized,
                    evolutionUrlPath: sendUrl,
                    payloadWithoutSecret: { number: normalized, text: trimmedMessage.substring(0, 200), delay: 1200, linkPreview: false },
                    providerStatus: evoRes.status,
                    providerResponse: evoBody,
                    contextSource: ctx.source,
                    contextState: ctx.state,
                    contextConnected: ctx.connected,
                    statusInstanceName,
                    sendInstanceName,
                    sameInstance,
                    selectedRealInstance,
                    availableInstances,
                    currentBridgeInstance: ctx.currentBridgeInstance,
                    encodedInstance,
                    requestErrorMessage: evoBody?.error || evoBody?.message || `HTTP ${evoRes.status}`,
                    requestErrorCode: evoRes.status,
                },
            };
            await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
            return response;
        }
        // ─── Evolution v2 hata formatı: { error: true, message: "..." } ───
        if (evoBody?.error === true || evoBody?.status === 'error' || evoBody?.state === 'ERROR') {
            const errMsg = evoBody?.message || evoBody?.errorMessage || evoBody?.text || 'Evolution API hatası';
            console.error(`[EvoSend] Evolution hata raporladı: to=${normalized}, instance=${instanceName}, message=${errMsg}`);
            const response = {
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                instanceName, normalizedPhone: normalized,
                error_type: 'evolution_send_failed',
                user_message: `WhatsApp gönderim başarısız: ${errMsg}`,
                technical: {
                    instanceName,
                    normalizedPhone: normalized,
                    evolutionUrlPath: sendUrl,
                    payloadWithoutSecret: { number: normalized, text: trimmedMessage.substring(0, 200), delay: 1200, linkPreview: false },
                    providerStatus: evoRes.status,
                    providerResponse: evoBody,
                    contextSource: ctx.source,
                    contextState: ctx.state,
                    contextConnected: ctx.connected,
                    statusInstanceName,
                    sendInstanceName,
                    sameInstance,
                    selectedRealInstance,
                    availableInstances,
                    currentBridgeInstance: ctx.currentBridgeInstance,
                    requestErrorMessage: errMsg,
                    requestErrorCode: evoRes.status,
                },
            };
            await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
            return response;
        }
        // ─── providerMessageId çıkar ───
        const providerMsgId = extractMessageId(evoBody);
        if (!providerMsgId) {
            console.error(`[EvoSend] providerMessageId YOK: to=${normalized}, instance=${instanceName}, status=${evoRes.status}, keys=[${Object.keys(evoBody || {}).join(',')}], body=`, JSON.stringify(evoBody).slice(0, 500));
            const response = {
                success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
                instanceName, normalizedPhone: normalized,
                error_type: 'provider_message_id_missing',
                user_message: 'WhatsApp mesaj takip ID\'si alınamadı — mesaj WhatsApp sunucularına ulaşmamış olabilir.',
                technical: {
                    instanceName,
                    normalizedPhone: normalized,
                    evolutionUrlPath: sendUrl,
                    payloadWithoutSecret: { number: normalized, text: trimmedMessage.substring(0, 200), delay: 1200, linkPreview: false },
                    providerStatus: evoRes.status,
                    providerResponse: evoBody,
                    contextSource: ctx.source,
                    contextState: ctx.state,
                    contextConnected: ctx.connected,
                    statusInstanceName,
                    sendInstanceName,
                    sameInstance,
                    selectedRealInstance,
                    availableInstances,
                    currentBridgeInstance: ctx.currentBridgeInstance,
                    requestErrorMessage: 'providerMessageId alınamadı',
                    requestErrorCode: evoRes.status,
                },
            };
            await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
            return response;
        }
        // ─── BAŞARILI ───
        const response = {
            success: true, status: 'SENT', sent: 1, failed: 0, total: 1,
            instanceName, normalizedPhone: normalized, providerMessageId: providerMsgId,
            channel: 'CONNECTED_DEVICE', provider: 'evolution',
            technical: {
                instanceName,
                normalizedPhone: normalized,
                providerMessageId: providerMsgId,
                statusInstanceName,
                sendInstanceName,
                sameInstance,
                selectedRealInstance,
                availableInstances,
                currentBridgeInstance: ctx.currentBridgeInstance,
                contextSource: ctx.source,
                contextState: ctx.state,
                contextConnected: ctx.connected,
                providerStatus: evoRes.status,
                providerResponse: evoBody,
            },
        };
        const archiveId = await archiveMessage(companyId, siteId, metadata, normalized, providerMsgId, response, instanceName, message, 'evolution');
        response.archiveId = archiveId;
        console.log(`[EvoSend] BAŞARILI: ${normalized}, providerMsgId=${providerMsgId}, archiveId=${archiveId || 'YOK'}, instance=${instanceName}`);
        return response;
    }
    catch (err) {
        const errMsg = err.message;
        console.error(`[EvoSend] EXCEPTION: ${errMsg}`);
        const response = {
            success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
            instanceName, normalizedPhone: normalized,
            error_type: 'evolution_send_exception',
            user_message: `WhatsApp gönderim hatası: ${errMsg}`,
            technical: {
                instanceName,
                normalizedPhone: normalized,
                evolutionUrlPath: sendUrl,
                payloadWithoutSecret: { number: normalized, text: trimmedMessage.substring(0, 200), delay: 1200, linkPreview: false },
                providerStatus: 0,
                providerResponse: `fetch exception: ${errMsg}`,
                contextSource: ctx.source,
                contextState: ctx.state,
                contextConnected: ctx.connected,
                exceptionMessage: errMsg,
                statusInstanceName,
                sendInstanceName,
                sameInstance,
                selectedRealInstance,
                availableInstances,
                currentBridgeInstance: ctx.currentBridgeInstance,
                encodedInstance,
                requestErrorMessage: errMsg,
                requestErrorCode: 0,
            },
        };
        await archiveMessage(companyId, siteId, metadata, normalized, '', response, instanceName, message, 'evolution');
        return response;
    }
}
exports.sendEvolutionTextMessage = sendEvolutionTextMessage;
/**
 * Toplu mesaj gönderimi — her alıcı için tek tek Evolution üzerinden gönder.
 */
async function sendEvolutionBulkMessages(companyId, siteId, recipients, message) {
    const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId);
    if (!recipients || recipients.length === 0) {
        return {
            success: false, status: 'FAILED', sent: 0, failed: 0, total: 0,
            instanceName, results: [],
        };
    }
    let sentCount = 0;
    let failedCount = 0;
    const results = [];
    for (const recipient of recipients) {
        const singleResult = await sendEvolutionTextMessage(companyId, siteId, recipient.phoneNumber, message, {
            residentId: recipient.residentId,
            unitId: recipient.unitId,
            recipientName: recipient.name,
        });
        results.push({
            phoneNumber: recipient.phoneNumber,
            normalizedPhone: singleResult.normalizedPhone,
            name: recipient.name,
            residentId: recipient.residentId,
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
    return {
        success: failedCount === 0,
        status: failedCount === 0 ? 'SENT' : 'PARTIAL_FAILED',
        sent: sentCount,
        failed: failedCount,
        total: recipients.length,
        instanceName,
        results,
    };
}
exports.sendEvolutionBulkMessages = sendEvolutionBulkMessages;
/**
 * Mesajı arşiv tablosuna yaz.
 */
async function archiveMessage(companyId, siteId, metadata, normalizedPhone, providerMessageId, result, instanceName, messageText, provider) {
    try {
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        const now = new Date().toISOString();
        const isSuccess = result.success;
        const { data, error } = await sb
            .from('whatsapp_message_archive')
            .insert({
            company_id: companyId,
            site_id: siteId,
            unit_id: metadata?.unitId || null,
            resident_id: metadata?.residentId || null,
            recipient_name: metadata?.recipientName || null,
            phone_number: normalizedPhone || result.normalizedPhone || '',
            normalized_phone: normalizedPhone || result.normalizedPhone || '',
            channel: 'whatsapp_web',
            provider: provider || 'evolution',
            instance_name: instanceName,
            message_preview: messageText.substring(0, 500),
            message_hash: null,
            provider_message_id: providerMessageId || result.providerMessageId || null,
            send_status: isSuccess ? 'SENT' : 'FAILED',
            error_type: result.error_type || null,
            error_message: result.user_message || null,
            sent_at: isSuccess ? now : null,
            failed_at: isSuccess ? null : now,
            raw_provider_response: result.technical ? JSON.parse(JSON.stringify(result.technical)) : null,
        })
            .select('id')
            .single();
        if (error) {
            console.warn('[ArchiveMessage] Yazma hatası:', error.message);
            return null;
        }
        return data?.id || null;
    }
    catch (err) {
        console.warn('[ArchiveMessage] Exception:', err.message);
        return null;
    }
}
async function getCompanyStatus(companyId) {
    const sessionInfo = whatsapp_manager_1.whatsAppManager.getSessionInfo(companyId);
    if (sessionInfo) {
        return {
            company_id: companyId,
            status: sessionInfo.status,
            phone_number: sessionInfo.phoneNumber,
            connected_at: sessionInfo.connectedAt,
            qr_available: !!sessionInfo.qrCode,
            qr_code: sessionInfo.qrCode,
            error: sessionInfo.error,
            session_path: null,
            bridge_available: true,
        };
    }
    return {
        company_id: companyId,
        status: 'DISCONNECTED',
        phone_number: null,
        connected_at: null,
        qr_available: false,
        qr_code: null,
        error: null,
        session_path: null,
        bridge_available: true,
    };
}
exports.getCompanyStatus = getCompanyStatus;
async function getCompanyQr(companyId) {
    const client = whatsapp_manager_1.whatsAppManager.getClient(companyId);
    if (client) {
        return {
            company_id: companyId,
            qr_code: client.getQrCode(),
            status: client.getStatus(),
            qr_available: !!client.getQrCode(),
        };
    }
    return {
        company_id: companyId,
        qr_code: null,
        status: 'DISCONNECTED',
        qr_available: false,
    };
}
exports.getCompanyQr = getCompanyQr;
async function getCompanyChannels(token, siteId) {
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
    if (!ctx) {
        return { channels: [], defaultChannel: null };
    }
    const channels = await whatsapp_repository_1.whatsAppRepository.getCompanyChannels(ctx.companyId);
    const cloudApiChannel = channels.find((c) => c.channel_type === 'OFFICIAL_CLOUD_API');
    return {
        channels: channels.map((c) => ({
            id: c.id,
            channelType: c.channel_type,
            isActive: c.is_active,
            isDefault: c.is_default,
            displayName: c.display_name,
            senderPhone: c.sender_phone,
            instanceName: c.instance_name,
            provider: c.provider,
            status: c.status,
            lastConnectedAt: c.last_connected_at,
            hasCloudApi: true,
            cloudApiConfigured: !!(cloudApiChannel?.waba_id && cloudApiChannel?.phone_number_id),
        })),
        defaultChannel: channels.find((c) => c.is_default)?.channel_type || null,
    };
}
exports.getCompanyChannels = getCompanyChannels;
async function setDefaultChannel(token, channelType, siteId) {
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
    if (!ctx) {
        return { success: false, channelType, message: 'Yetkilendirme başarısız.' };
    }
    // OFFICIAL_CLOUD_API seçilirse, o kanalın yapılandırılmış olması gerek
    if (channelType === 'OFFICIAL_CLOUD_API') {
        const cloudChannel = await whatsapp_repository_1.whatsAppRepository.getChannelByType(ctx.companyId, 'OFFICIAL_CLOUD_API');
        if (!cloudChannel || !cloudChannel.waba_id || !cloudChannel.phone_number_id) {
            return {
                success: false,
                channelType,
                message: 'Resmi WhatsApp Business API bu firma için tanımlı değil. Önce API bilgilerini yapılandırın.',
            };
        }
    }
    await whatsapp_repository_1.whatsAppRepository.setDefaultChannel(ctx.companyId, channelType);
    return {
        success: true,
        channelType,
        message: channelType === 'CONNECTED_DEVICE'
            ? 'Varsayılan kanal: Bağlı WhatsApp Cihazı olarak değiştirildi.'
            : 'Varsayılan kanal: Resmi WhatsApp Business API olarak değiştirildi.',
    };
}
exports.setDefaultChannel = setDefaultChannel;
async function disconnectCompany(companyId) {
    const managerClient = whatsapp_manager_1.whatsAppManager.getClient(companyId);
    if (managerClient) {
        await managerClient.disconnect();
        return { success: true, company_id: companyId, status: 'DISCONNECTED' };
    }
    try {
        await whatsapp_session_1.sessionManager.destroy(companyId);
    }
    catch { /* skip */ }
    return { success: true, company_id: companyId, status: 'DISCONNECTED' };
}
exports.disconnectCompany = disconnectCompany;
async function reconnectCompany(companyId, phoneNumber) {
    await disconnectCompany(companyId);
    await new Promise(r => setTimeout(r, 2000));
    return connectCompany(companyId, phoneNumber);
}
exports.reconnectCompany = reconnectCompany;
async function queueMessage(companyId, phone, message, siteId) {
    // Repository service_role client kullanır — RLS'ye takılmaz
    const result = await whatsapp_repository_1.whatsAppRepository.enqueueMessage({
        siteId: siteId || companyId,
        companyId,
        phone,
        message,
    });
    if (!result) {
        return { success: false, error: 'Kuyruğa eklenemedi: message_queue insert başarısız.' };
    }
    return {
        success: true,
        message: 'Mesaj kuyruğa eklendi',
        queue_id: result.id,
    };
}
exports.queueMessage = queueMessage;
async function queueBulkMessages(companyId, recipients, siteId) {
    // Repository service_role client kullanır — RLS'ye takılmaz
    const result = await whatsapp_repository_1.whatsAppRepository.enqueueBulkMessages(siteId || companyId, companyId, recipients);
    return {
        success: result.failed === 0,
        queued: result.queued,
        failed: result.failed,
        queue_ids: result.queueIds,
    };
}
exports.queueBulkMessages = queueBulkMessages;
async function sendDirectMessage(companyId, to, message) {
    const result = await sendSiteDirectMessage(companyId, to, message);
    return {
        success: result.success,
        error: result.user_message || result.error_type,
        providerMessageId: result.providerMessageId,
    };
}
exports.sendDirectMessage = sendDirectMessage;
// ═══════════════════════════════════════════════════
//  Sağlık Kontrolü
// ═══════════════════════════════════════════════════
async function getHealth() {
    const report = await whatsapp_manager_1.whatsAppManager.getHealthReport();
    let evoPing;
    try {
        evoPing = await (0, evolution_client_1.pingEvolutionApi)();
    }
    catch {
        evoPing = { alive: false, error: 'pingEvolutionApi threw', instances: [] };
    }
    const evoInstances = evoPing.instances || [];
    const managerSessions = report.sessions;
    const managerSiteIds = new Set(managerSessions.map((s) => s.siteId));
    const extraSessions = evoInstances
        .filter((inst) => !managerSiteIds.has(inst.instanceName))
        .map((inst) => ({
        siteId: inst.instanceName,
        companyId: inst.instanceName,
        status: inst.status === 'open' ? 'CONNECTED' : (inst.status || 'UNKNOWN').toUpperCase(),
        uptime: 0,
        phoneNumber: inst.number || null,
        profileName: inst.profileName || null,
        battery: null,
        lastSeen: null,
        hasQr: false,
        lastActivity: 0,
    }));
    const allSessions = [...managerSessions, ...extraSessions];
    return {
        timestamp: report.timestamp,
        service: report.service,
        provider: 'evolution-api',
        baileys_connected: report.baileys_connected,
        evolution_api_alive: evoPing.alive,
        evolution_api_status: evoPing.alive ? 'online' : 'offline',
        evolution_api_error: evoPing.error || null,
        evolution_api_version: evoPing.version || null,
        evolution_instances: evoInstances,
        sessions: allSessions,
        totalSessions: allSessions.length,
        bridge: report.bridge,
        version: report.version,
        uptime: report.uptime,
    };
}
exports.getHealth = getHealth;
async function getEnterpriseHealth() {
    const managerReport = await whatsapp_manager_1.whatsAppManager.getHealthReport();
    let evoPing;
    try {
        evoPing = await (0, evolution_client_1.pingEvolutionApi)();
    }
    catch {
        evoPing = { alive: false, error: 'pingEvolutionApi threw', instances: [] };
    }
    const evoInstances = evoPing.instances || [];
    const managerSessions = managerReport.sessions;
    const managerSiteIds = new Set(managerSessions.map((s) => s.siteId));
    const extraSessions = evoInstances
        .filter((inst) => !managerSiteIds.has(inst.instanceName))
        .map((inst) => ({
        siteId: inst.instanceName,
        companyId: inst.instanceName,
        status: inst.status === 'open' ? 'CONNECTED' : (inst.status || 'UNKNOWN').toUpperCase(),
        uptime: 0,
        phoneNumber: inst.number || null,
        profileName: inst.profileName || null,
        battery: null,
        lastSeen: null,
        hasQr: false,
        lastActivity: 0,
    }));
    const allSessions = [...managerSessions, ...extraSessions];
    return {
        timestamp: managerReport.timestamp,
        service: managerReport.service,
        provider: 'evolution-api',
        baileys_connected: managerReport.baileys_connected,
        evolution_api_alive: evoPing.alive,
        evolution_api_status: evoPing.alive ? 'online' : 'offline',
        evolution_api_error: evoPing.error || null,
        evolution_api_version: evoPing.version || null,
        evolution_instances: evoInstances,
        sessions: allSessions,
        totalSessions: allSessions.length,
        bridge: managerReport.bridge,
        version: managerReport.version,
        uptime: managerReport.uptime,
    };
}
exports.getEnterpriseHealth = getEnterpriseHealth;
/**
 * Multi-tenant diagnostics — firma bazlı tüm sistem durumu.
 */
async function getMultiTenantDiagnostics(token, siteId) {
    const ctx = await (0, whatsapp_helpers_1.resolveCompanyContext)(token, siteId);
    const now = new Date().toISOString();
    if (!ctx) {
        return {
            timestamp: now,
            companyId: 'unknown',
            instanceName: 'unknown',
            connectionStatus: 'AUTH_FAILED',
            qrStatus: null,
            phoneNumber: null,
            profileName: null,
            lastQrAt: null,
            lastConnectedAt: null,
            lastError: 'auth_failed',
            lastErrorType: 'auth_required',
            queuePending: 0,
            queueSending: 0,
            queueFailed: 0,
            queueSentToday: 0,
            radoreApiAlive: true,
            evolutionApiAlive: false,
            supabaseAlive: false,
            schedulerRunning: false,
            webhookRegistered: false,
            activeClients: 0,
            connectedClients: 0,
        };
    }
    const { companyId, siteId: resolvedSiteId } = ctx;
    const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId);
    // DB kaydını al
    const dbInstance = await whatsapp_repository_1.whatsAppRepository.getCompanyInstance(companyId);
    // Queue istatistikleri
    let queueStats = { pending: 0, sending: 0, failed: 0, sentToday: 0 };
    try {
        queueStats = await whatsapp_repository_1.whatsAppRepository.getQueueStats(resolvedSiteId);
    }
    catch { /* skip */ }
    // Evolution API ping
    let evoAlive = false;
    try {
        const evoPing = await (0, evolution_client_1.pingEvolutionApi)();
        evoAlive = evoPing.alive;
    }
    catch { /* skip */ }
    // Supabase ping
    let supabaseAlive = false;
    try {
        supabaseAlive = await whatsapp_repository_1.whatsAppRepository.ping();
    }
    catch { /* skip */ }
    // Manager stats
    const activeClients = whatsapp_manager_1.whatsAppManager.size;
    const connectedClients = whatsapp_manager_1.whatsAppManager.connectedCount;
    // Scheduler (import edilemiyorsa true varsay)
    let schedulerRunning = false;
    try {
        const { whatsAppScheduler } = await Promise.resolve().then(() => __importStar(require('./whatsapp.scheduler')));
        schedulerRunning = whatsAppScheduler.isRunning();
    }
    catch {
        schedulerRunning = true;
    }
    // ═══ HİBRİT: Kanal bilgilerini de ekle ═══
    let channels = [];
    try {
        const rawChannels = await whatsapp_repository_1.whatsAppRepository.getCompanyChannels(companyId);
        channels = rawChannels.map((c) => ({
            channel_type: c.channel_type,
            is_active: c.is_active,
            is_default: c.is_default,
            display_name: c.display_name,
            status: c.status,
            provider: c.provider,
        }));
    }
    catch { /* skip */ }
    return {
        timestamp: now,
        companyId,
        instanceName,
        channels,
        connectionStatus: dbInstance?.connection_status || 'DISCONNECTED',
        qrStatus: dbInstance?.qr_status || null,
        phoneNumber: dbInstance?.phone_number || null,
        profileName: dbInstance?.phone_number ? dbInstance?.profile_name || null : null,
        lastQrAt: dbInstance?.last_qr_at || null,
        lastConnectedAt: dbInstance?.last_connected_at || null,
        lastError: dbInstance?.last_error || null,
        lastErrorType: dbInstance?.last_error_type || null,
        queuePending: queueStats.pending,
        queueSending: queueStats.sending,
        queueFailed: queueStats.failed,
        queueSentToday: queueStats.sentToday,
        radoreApiAlive: true,
        evolutionApiAlive: evoAlive,
        supabaseAlive: supabaseAlive,
        schedulerRunning,
        webhookRegistered: evoAlive, // Evolution açıksa webhook da kayıtlı olabilir
        activeClients,
        connectedClients,
    };
}
exports.getMultiTenantDiagnostics = getMultiTenantDiagnostics;
async function verifyArchiveRecord(companyId, providerMessageId) {
    const start = Date.now();
    try {
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        const { data, error } = await sb
            .from('whatsapp_message_archive')
            .select('id, send_status, provider_message_id, instance_name, normalized_phone, sent_at, error_type')
            .eq('company_id', companyId)
            .eq('provider_message_id', providerMessageId)
            .eq('send_status', 'SENT')
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const duration = Date.now() - start;
        if (error) {
            console.warn('[ArchiveVerify] Sorgu hatası:', error.message);
            return {
                found: false, archiveId: null, sendStatus: null,
                providerMessageId, instanceName: null, normalizedPhone: null,
                sentAt: null, errorType: `db_error: ${error.message}`, queryDuration: duration,
            };
        }
        if (data) {
            return {
                found: true,
                archiveId: data.id,
                sendStatus: data.send_status,
                providerMessageId: data.provider_message_id,
                instanceName: data.instance_name,
                normalizedPhone: data.normalized_phone,
                sentAt: data.sent_at,
                errorType: null,
                queryDuration: duration,
            };
        }
        return {
            found: false, archiveId: null, sendStatus: 'NOT_FOUND',
            providerMessageId, instanceName: null, normalizedPhone: null,
            sentAt: null, errorType: null, queryDuration: duration,
        };
    }
    catch (err) {
        const duration = Date.now() - start;
        return {
            found: false, archiveId: null, sendStatus: null,
            providerMessageId, instanceName: null, normalizedPhone: null,
            sentAt: null, errorType: `exception: ${err.message}`, queryDuration: duration,
        };
    }
}
exports.verifyArchiveRecord = verifyArchiveRecord;
//# sourceMappingURL=whatsapp.service.js.map