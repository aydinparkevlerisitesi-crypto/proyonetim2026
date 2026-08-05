import fs from 'fs';
import { createServerSupabaseClient } from '../../lib/supabase';
import { config } from '../../config';
import { safeFetch } from '../../lib/fetchCompat';
import { sessionManager } from './whatsapp.session';
import { whatsAppManager } from './whatsapp.manager';
import { messageQueue } from './whatsapp.queue';
import { whatsAppRepository } from './whatsapp.repository';
import { whatsAppLock } from './whatsapp.lock';
import { EvolutionClient, fetchEvolutionInstances, pingEvolutionApi } from './evolution.client';
import { getCompanyInstanceName, resolveCompanyContext, getActiveWhatsAppContext, type ResolvedCompanyContext, type ActiveWhatsAppContext } from './whatsapp.helpers';
import { companyRateLimiter } from './whatsapp.rateLimit';
import type {
  ConnectResponse,
  DirectSendResponse,
  StatusResponse,
  QrResponse,
  SiteSendResponse,
  SiteBulkSendResponse,
  BulkSendRecipientResult,
} from './whatsapp.dto';

// ═══════════════════════════════════════════════════
//  LOG GÜVENLİĞİ: QR base64 yerine sadece meta bilgi logla
// ═══════════════════════════════════════════════════

function logQrSafe(label: string, data: Record<string, unknown> | null): void {
  if (!data) {
    console.log(`[QR-Safe] ${label}: null`);
    return;
  }
  const base64 = (data as Record<string, unknown>).base64;
  const code = (data as Record<string, unknown>).code;
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

// ═══════════════════════════════════════════════════
//  MULTI-TENANT: Token'dan company_id çöz ve connect başlat
// ═══════════════════════════════════════════════════

export interface MultiTenantConnectParams {
  token: string;
  siteId?: string;
  phoneNumber?: string;
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
export async function multiTenantConnect(params: MultiTenantConnectParams): Promise<ConnectResponse> {
  const startTime = Date.now();

  // ═══ 1. Token doğrula + company_id çöz ═══
  let ctx: ResolvedCompanyContext | null = null;
  try {
    ctx = await resolveCompanyContext(params.token, params.siteId);
  } catch (err: unknown) {
    const msg = (err as Error).message;
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
  if (!companyRateLimiter.check(companyId, 'connect')) {
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
  if (!whatsAppLock.acquire(companyId, 'connect')) {
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
    let dbInstance: { instance_name: string };
    try {
      dbInstance = await whatsAppRepository.findOrCreateCompanyInstance({
        companyId,
        siteId,
        createdBy: userId,
      });
      console.log(`[MultiTenantConnect] ADIM 4 OK — dbInstance.instanceName=${dbInstance.instance_name}`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
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
    let client: ReturnType<typeof whatsAppManager.createClient>;
    try {
      client = await whatsAppManager.createClient({
        siteId,
        companyId,
        phoneNumber: params.phoneNumber,
        instanceName,
      });
      console.log(`[MultiTenantConnect] ADIM 5 OK — client oluşturuldu, instanceName=${instanceName}`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      console.error(`[MultiTenantConnect] ADIM 5 FAIL — createClient: ${msg}`);
      return {
        success: false, status: 'ERROR', siteId, companyId,
        qrCode: null, qr_code: null, base64: null, instance: null, provider: 'evolution-api',
        error: msg, errorType: 'manager_error',
        userMessage: `Client oluşturma hatası: ${msg}`,
      };
    }

    // ═══ 6. Evolution API connect ═══
    let result: { success: boolean; qrCode?: string; error?: string; errorType?: string; userMessage?: string };
    try {
      result = await client.connect();
      console.log(`[MultiTenantConnect] ADIM 6 — client.connect() tamamlandı: success=${result.success}, qrCode=${result.qrCode ? `VAR (uzunluk: ${result.qrCode.length})` : 'YOK'}, errorType=${result.errorType || 'none'}, error=${result.error || 'none'}`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
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
      await whatsAppRepository.findOrCreateConnectedDeviceChannel({
        companyId,
        instanceName,
        senderPhone: params.phoneNumber,
      });
      console.log(`[MultiTenantConnect] ADIM 7 OK — kanal güncellendi`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      console.warn(`[MultiTenantConnect] ADIM 7 WARN — findOrCreateConnectedDeviceChannel: ${msg}`);
      // Non-critical — devam et
    }

    // ═══ 8. DB durumunu güncelle ═══
    const info = client.getSessionInfo();
    const now = new Date().toISOString();

    try {
      if (result.success && result.qrCode) {
        // ✅ QR başarıyla alındı
        await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
          connectionStatus: 'WAITING_QR',
          qrStatus: 'QR_READY',
          profileName: info.profileName,
          lastQrAt: now,
          lastError: null,
          lastErrorType: null,
          siteId,
        });
        console.log(`[MultiTenantConnect] ADIM 8 OK — DB: WAITING_QR + QR_READY`);
      } else {
        // ❌ QR alınamadı — connect() artık success true + qrCode yok dönmez
        // Buraya düşen her şey hatadır (qr_generation_failed, evolution_api_error vs.)
        const finalError = result.error || 'QR üretilemedi';
        const finalErrorType = result.errorType || 'qr_generation_failed';
        await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
          connectionStatus: 'ERROR',
          lastError: finalError,
          lastErrorType: finalErrorType,
          siteId,
        });
        console.log(`[MultiTenantConnect] ADIM 8 — DB: ERROR (errorType=${finalErrorType}, error=${finalError})`);
      }
    } catch (err: unknown) {
      const msg = (err as Error).message;
      console.warn(`[MultiTenantConnect] ADIM 8 WARN — updateCompanyInstanceStatus: ${msg}`);
      // Non-critical — devam et
    }

    // ═══ 9. Response oluştur — instanceName HER ZAMAN dolu ═══
    const response: ConnectResponse = {
      success: result.success,
      status: result.success ? (info.status === 'WAITING_QR' || info.qrCode ? 'QR_READY' : info.status) : 'ERROR',
      siteId,
      companyId,
      qrCode: result.qrCode || info.qrCode || null,
      qr_code: result.qrCode || info.qrCode || null,
      base64: result.qrCode || info.qrCode || null,
      phoneNumber: info.phoneNumber,
      profileName: info.profileName,
      instance: instanceName, // ⚠️ HER ZAMAN DB'den gelen deterministik isim
      provider: 'evolution-api',
      error: result.error || null,
      errorType: result.errorType || (result.error ? 'connect_failed' : undefined),
      userMessage: result.userMessage || result.error || undefined,
    };

    // QR-safe log
    logQrSafe('MultiTenantConnect response', response as unknown as Record<string, unknown>);

    const elapsed = Date.now() - startTime;
    console.log(`[MultiTenantConnect] ✅ Tamamlandı: ${elapsed}ms, success=${response.success}, status=${response.status}, instance=${instanceName}, qrCode=${response.qrCode ? 'VAR' : 'YOK'}, companyId=${companyId}`);

    return response;
  } catch (err) {
    const errMsg = (err as Error).message;
    const errStack = (err as Error).stack || 'stack yok';
    console.error(`[MultiTenantConnect] BEKLENMEDİK HATA (outer catch): ${errMsg}`);
    console.error(`[MultiTenantConnect] STACK: ${errStack}`);

    try {
      await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
        connectionStatus: 'ERROR',
        lastError: errMsg,
        lastErrorType: 'manager_error',
      });
    } catch { /* sessiz */ }

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
  } finally {
    whatsAppLock.release(companyId, 'connect');
  }
}

/**
 * Multi-tenant status sorgulama.
 * Token'dan company_id çöz, instance'ın durumunu döndür.
 */
export async function multiTenantStatus(token: string, siteId?: string): Promise<StatusResponse & { instanceName?: string; companyId?: string; connected?: boolean; state?: string; hasQr?: boolean; provider?: string; channel?: string; lastCheckedAt?: string }> {
  const lastCheckedAt = new Date().toISOString();
  const ctx = await resolveCompanyContext(token, siteId);
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
  const activeCtx = await getActiveWhatsAppContext(companyId);

  console.log(`[multiTenantStatus] Aktif bağlam: connected=${activeCtx.connected}, status=${activeCtx.status}, state=${activeCtx.state}, instance=${activeCtx.instanceName}, source=${activeCtx.source}`);

  // ═══ CONNECTED ise DB'yi senkronize et ═══
  if (activeCtx.connected) {
    try {
      await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
        connectionStatus: 'CONNECTED',
        qrStatus: null,
        phoneNumber: activeCtx.phone || undefined,
        profileName: activeCtx.profileName || undefined,
        lastConnectedAt: activeCtx.lastCheckedAt,
        lastError: null,
        siteId: resolvedSiteId,
      });
    } catch { /* DB güncelleme hatası UI'ı etkilemez */ }

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
      await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
        connectionStatus: 'WAITING_QR',
        qrStatus: 'QR_READY',
        lastError: null,
        siteId: resolvedSiteId,
      });
    } catch { /* sessiz */ }

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

/**
 * Multi-tenant disconnect.
 * SADECE ilgili firmanın instance'ını disconnect et.
 */
export async function multiTenantDisconnect(
  token: string,
  siteId?: string,
): Promise<{ success: boolean; siteId: string; companyId?: string; status: string }> {
  const ctx = await resolveCompanyContext(token, siteId);
  if (!ctx) {
    return { success: false, siteId: siteId || '', status: 'AUTH_FAILED' };
  }

  const { companyId, siteId: resolvedSiteId } = ctx;
  const instanceName = getCompanyInstanceName(companyId);

  // Manager'da disconnect
  const client = whatsAppManager.getClient(resolvedSiteId);
  if (client) {
    await client.disconnect();
  }

  // DB güncelle
  const now = new Date().toISOString();
  await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
    connectionStatus: 'DISCONNECTED',
    qrStatus: null,
    lastDisconnectedAt: now,
    lastError: null,
  });

  console.log(`[MultiTenantDisconnect] ${instanceName} (company: ${companyId}) disconnect edildi`);
  return { success: true, siteId: resolvedSiteId, companyId, status: 'DISCONNECTED' };
}

// ═══════════════════════════════════════════════════
//  FAZ 1: Firma Bazlı Bağlantı Yönetimi (Geriye Dönük)
//  → Evolution API üzerinden çalışır
// ═══════════════════════════════════════════════════

export interface ConnectResult {
  success: boolean;
  status: string;
  qr_code?: string | null;
  phone_number?: string | null;
  error?: string;
  error_type?: string;
  user_message?: string;
}

/**
 * Firma için WhatsApp bağlantısı başlat — Evolution API üzerinden.
 */
export async function connectCompany(
  companyId: string,
  phoneNumber?: string,
  instanceName?: string,
): Promise<ConnectResult> {
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
  } catch (err) {
    const errMsg = (err as Error).message;
    return {
      success: false,
      status: 'ERROR',
      error: errMsg,
      error_type: 'evolution_api_error',
      user_message: `Evolution API bağlantı hatası: ${errMsg}`,
    };
  }
}

// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Bağlantı (WhatsAppManager)
// ═══════════════════════════════════════════════════

export async function connectSite(
  siteId: string,
  companyId?: string,
  phoneNumber?: string,
  instanceName?: string,
): Promise<ConnectResponse> {
  try {
    const client = await whatsAppManager.createClient({
      siteId,
      companyId,
      phoneNumber,
      instanceName,
    });

    const result = await client.connect();

    const info = client.getSessionInfo();
    const response: ConnectResponse = {
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

    logQrSafe('connectSite response', response as unknown as Record<string, unknown>);

    return response;
  } catch (err) {
    const errMsg = (err as Error).message;
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

export async function getSiteStatus(siteId: string, companyId?: string): Promise<StatusResponse> {
  const lastCheckedAt = new Date().toISOString();

  // ═══ AKTİF WHATSAPP BAĞLAMINI ÇÖZ ═══
  // Eğer companyId yoksa, siteId'den çözmeye çalış
  let effectiveCompanyId = companyId;
  if (!effectiveCompanyId) {
    try {
      const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
      const { data: site } = await sb.from('sites').select('company_id').eq('id', siteId).maybeSingle();
      effectiveCompanyId = site?.company_id || undefined;
    } catch { /* sessiz */ }
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

  const activeCtx = await getActiveWhatsAppContext(effectiveCompanyId);

  // DB senkronizasyonu
  if (activeCtx.connected) {
    try {
      await whatsAppRepository.updateCompanyInstanceStatus(effectiveCompanyId, {
        connectionStatus: 'CONNECTED',
        qrStatus: null,
        phoneNumber: activeCtx.phone || undefined,
        profileName: activeCtx.profileName || undefined,
        lastConnectedAt: activeCtx.lastCheckedAt,
        lastError: null,
        siteId,
      });
    } catch { /* sessiz */ }
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

export async function getSiteQr(siteId: string, companyId?: string): Promise<QrResponse> {
  const client = whatsAppManager.getClient(siteId);
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

export async function disconnectSite(siteId: string, companyId?: string): Promise<{ success: boolean; siteId: string; status: string }> {
  const client = whatsAppManager.getClient(siteId);
  if (client) {
    await client.disconnect();
    return { success: true, siteId, status: client.getStatus() };
  }

  await disconnectCompany(siteId);
  return { success: true, siteId, status: 'DISCONNECTED' };
}

export async function reconnectSite(
  siteId: string,
  companyId?: string,
  phoneNumber?: string,
): Promise<ConnectResponse> {
  const client = whatsAppManager.getClient(siteId);
  if (client) {
    const result = await client.reconnect();
    const info = client.getSessionInfo();
    const response: ConnectResponse = {
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
    logQrSafe('reconnectSite response', response as unknown as Record<string, unknown>);
    return response;
  }

  return connectSite(siteId, companyId, phoneNumber);
}

// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Mesaj — DİREKT EVOLUTION GÖNDERİM
//  Artık message_queue kullanmaz, queue sadece toplu gönderim içindir.
//  Bu sayede RLS hatası YAŞANMAZ — tekli mesaj direkt gider.
// ═══════════════════════════════════════════════════

export async function sendSiteMessage(
  siteId: string,
  companyId: string | undefined,
  phone: string,
  message: string,
  _priority?: number,
): Promise<{ success: boolean; queueId?: string; error?: string }> {
  // Tekli mesajda ASLA queue kullanma — direkt Evolution gönder
  const result = await sendEvolutionTextMessage(
    companyId || siteId,
    siteId,
    phone,
    message,
  );

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

export async function sendSiteBulkMessages(
  siteId: string,
  companyId: string | undefined,
  recipients: Array<{ phone: string; message: string; priority?: number }>,
): Promise<{ success: boolean; queued: number; failed: number; queueIds: string[] }> {
  // Toplu gönderimde Evolution API üzerinden tek tek gönder
  // Eğer 50+ alıcı varsa queue kullan, yoksa direkt gönder
  if (recipients.length <= 50) {
    const bulkResult = await sendEvolutionBulkMessages(
      companyId || siteId,
      siteId,
      recipients.map((r) => ({ phoneNumber: r.phone })),
      recipients[0]?.message || '',
    );

    return {
      success: bulkResult.success,
      queued: bulkResult.sent,
      failed: bulkResult.failed,
      queueIds: [],
    };
  }

  // 50+ alıcı → queue kullan (service_role client ile, RLS'ye takılmaz)
  return messageQueue.enqueueBulk(siteId, companyId, recipients);
}

export async function sendSiteDirectMessage(
  siteId: string,
  phone: string,
  message: string,
  companyId?: string,
): Promise<SiteSendResponse> {
  // Tam Evolution gönderim akışına yönlendir — manager fallback + bridge state + env + arşivleme
  return sendEvolutionTextMessage(
    companyId || siteId,
    siteId,
    phone,
    message,
  );
}

// ═══════════════════════════════════════════════════
//  GERÇEK EVOLUTION GÖNDERİM + ARŞİVLEME
//  Frontend formatıyla uyumlu: phoneNumber (değil phone)
//  Evolution API → sendText → arşive yaz → response dön
// ═══════════════════════════════════════════════════

function normalizePhoneTR(phone: string): string | null {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '90' + d.slice(1);
  if (d.startsWith('5') && d.length === 10) d = '90' + d;
  if (d.startsWith('90') && d.length === 12) return d;
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
function extractMessageId(data: unknown, depth: number = 0): string | null {
  if (!data || typeof data !== 'object' || depth > 20) return null;
  const d = data as Record<string, unknown>;

  // Önce bilinen pattern'leri tara
  const known = ((d.key as Record<string, unknown>)?.id as string)
    || (((d.message as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string)
    || ((Array.isArray(d.messages) && d.messages.length > 0) ? ((d.messages[0] as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string : null)
    || ((d.data as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string
    || ((d.result as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string
    || (d.id as string)
    || (d.messageId as string)
    || ((d.key as Record<string, unknown>)?.remoteJid as string)
    || null;
  if (known) return known;

  // Deep recursive scan
  if (Array.isArray(data)) {
    for (let i = 0; i < Math.min((data as unknown[]).length, 50); i++) {
      const found = extractMessageId((data as unknown[])[i], depth + 1);
      if (found) return found;
    }
  } else {
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
        if (found) return found;
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
export async function sendEvolutionTextMessage(
  companyId: string,
  siteId: string,
  phoneNumber: string,
  message: string,
  metadata?: { residentId?: string; unitId?: string; recipientName?: string },
): Promise<SiteSendResponse> {
  // ═══ 1. Telefon normalizasyonu ═══
  const normalized = normalizePhoneTR(phoneNumber);
  if (!normalized) {
    const response: SiteSendResponse = {
      success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
      instanceName: getCompanyInstanceName(companyId), error_type: 'invalid_phone',
      user_message: 'Telefon numarası geçersiz.',
    };
    await archiveMessage(companyId, siteId, metadata, phoneNumber, '', response, getCompanyInstanceName(companyId), message, 'evolution');
    return response;
  }

  // ═══ 2. Mesaj boş mu? ═══
  if (!message || !String(message).trim()) {
    const response: SiteSendResponse = {
      success: false, status: 'FAILED', sent: 0, failed: 1, total: 1,
      instanceName: getCompanyInstanceName(companyId), normalizedPhone: normalized,
      error_type: 'empty_message', user_message: 'Mesaj metni boş olamaz.',
    };
    await archiveMessage(companyId, siteId, metadata, normalized, '', response, getCompanyInstanceName(companyId), message, 'evolution');
    return response;
  }

  // ═══ 3. AKTİF WHATSAPP BAĞLAMINI ÇÖZ ═══
  // Bu, multiTenantStatus ile AYNI fonksiyondur.
  // Status ne görüyorsa, send de aynı instance'ı kullanır.
  const ctx = await getActiveWhatsAppContext(companyId);
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
    const response: SiteSendResponse = {
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
    const evoRes = await safeFetch(
      sendUrl,
      {
        method: 'POST',
        headers: { 'apikey': evoKey, 'Content-Type': 'application/json' } as Record<string, string>,
        body: JSON.stringify({ number: normalized, text: trimmedMessage, delay: 1200, linkPreview: false }),
      },
      15000,
    );

    let evoBody: any = {};
    try {
      const evoText = await evoRes.text();
      evoBody = evoText ? JSON.parse(evoText) : {};
    } catch {
      evoBody = { raw: 'parse_failed' };
    }

    // ─── HTTP 0 / network hata kontrolü ───
    if (!evoRes.ok && evoRes.status === 0) {
      const errMsg = 'Evolution API\'ye ulaşılamadı — ağ hatası veya instance adı geçersiz. Lütfen WhatsApp cihaz bağlantısını kontrol edin.';
      console.error(`[EvoSend] Evolution NETWORK HATA (status=0): url=${sendUrl}, instance=${instanceName}, to=${normalized}`);

      const response: SiteSendResponse = {
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

      const response: SiteSendResponse = {
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

      const response: SiteSendResponse = {
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

      const response: SiteSendResponse = {
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
    const response: SiteSendResponse = {
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
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[EvoSend] EXCEPTION: ${errMsg}`);
    const response: SiteSendResponse = {
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

/**
 * Toplu mesaj gönderimi — her alıcı için tek tek Evolution üzerinden gönder.
 */
export async function sendEvolutionBulkMessages(
  companyId: string,
  siteId: string,
  recipients: Array<{ phoneNumber: string; name?: string; residentId?: string; unitId?: string }>,
  message: string,
): Promise<SiteBulkSendResponse> {
  const instanceName = getCompanyInstanceName(companyId);

  if (!recipients || recipients.length === 0) {
    return {
      success: false, status: 'FAILED', sent: 0, failed: 0, total: 0,
      instanceName, results: [],
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  const results: BulkSendRecipientResult[] = [];

  for (const recipient of recipients) {
    const singleResult = await sendEvolutionTextMessage(
      companyId,
      siteId,
      recipient.phoneNumber,
      message,
      {
        residentId: recipient.residentId,
        unitId: recipient.unitId,
        recipientName: recipient.name,
      },
    );

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

    if (singleResult.success) sentCount++;
    else failedCount++;

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

/**
 * Mesajı arşiv tablosuna yaz.
 */
async function archiveMessage(
  companyId: string,
  siteId: string,
  metadata: { residentId?: string; unitId?: string; recipientName?: string } | undefined,
  normalizedPhone: string,
  providerMessageId: string,
  result: SiteSendResponse,
  instanceName: string,
  messageText: string,
  provider?: string,
): Promise<string | null> {
  try {
    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
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
  } catch (err) {
    console.warn('[ArchiveMessage] Exception:', (err as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
//  Durum Sorgulama (Geriye Dönük)
// ═══════════════════════════════════════════════════

export interface StatusResult {
  company_id: string;
  status: string;
  phone_number: string | null;
  connected_at: string | null;
  qr_available: boolean;
  qr_code: string | null;
  error: string | null;
  session_path: string | null;
  bridge_available: boolean;
}

export async function getCompanyStatus(companyId: string): Promise<StatusResult> {
  const sessionInfo = whatsAppManager.getSessionInfo(companyId);
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

export interface QrResult {
  company_id: string;
  qr_code: string | null;
  status: string;
  qr_available: boolean;
}

export async function getCompanyQr(companyId: string): Promise<QrResult> {
  const client = whatsAppManager.getClient(companyId);
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

export interface DisconnectResult {
  success: boolean;
  company_id: string;
  status: string;
}

// ═══════════════════════════════════════════════════
//  HİBRİT MİMARİ: Kanal Yönetimi
// ═══════════════════════════════════════════════════

export interface GetChannelsResult {
  channels: Array<{
    id: string;
    channelType: string;
    isActive: boolean;
    isDefault: boolean;
    displayName: string | null;
    senderPhone: string | null;
    instanceName: string | null;
    provider: string;
    status: string;
    lastConnectedAt: string | null;
    hasCloudApi: boolean;
    cloudApiConfigured: boolean;
  }>;
  defaultChannel: string | null;
}

export async function getCompanyChannels(token: string, siteId?: string): Promise<GetChannelsResult> {
  const ctx = await resolveCompanyContext(token, siteId);
  if (!ctx) {
    return { channels: [], defaultChannel: null };
  }

  const channels = await whatsAppRepository.getCompanyChannels(ctx.companyId);
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

export interface SetDefaultChannelResult {
  success: boolean;
  channelType: string;
  message: string;
}

export async function setDefaultChannel(token: string, channelType: 'CONNECTED_DEVICE' | 'OFFICIAL_CLOUD_API', siteId?: string): Promise<SetDefaultChannelResult> {
  const ctx = await resolveCompanyContext(token, siteId);
  if (!ctx) {
    return { success: false, channelType, message: 'Yetkilendirme başarısız.' };
  }

  // OFFICIAL_CLOUD_API seçilirse, o kanalın yapılandırılmış olması gerek
  if (channelType === 'OFFICIAL_CLOUD_API') {
    const cloudChannel = await whatsAppRepository.getChannelByType(ctx.companyId, 'OFFICIAL_CLOUD_API');
    if (!cloudChannel || !cloudChannel.waba_id || !cloudChannel.phone_number_id) {
      return {
        success: false,
        channelType,
        message: 'Resmi WhatsApp Business API bu firma için tanımlı değil. Önce API bilgilerini yapılandırın.',
      };
    }
  }

  await whatsAppRepository.setDefaultChannel(ctx.companyId, channelType);
  return {
    success: true,
    channelType,
    message: channelType === 'CONNECTED_DEVICE'
      ? 'Varsayılan kanal: Bağlı WhatsApp Cihazı olarak değiştirildi.'
      : 'Varsayılan kanal: Resmi WhatsApp Business API olarak değiştirildi.',
  };
}

export async function disconnectCompany(companyId: string): Promise<DisconnectResult> {
  const managerClient = whatsAppManager.getClient(companyId);
  if (managerClient) {
    await managerClient.disconnect();
    return { success: true, company_id: companyId, status: 'DISCONNECTED' };
  }

  try {
    await sessionManager.destroy(companyId);
  } catch { /* skip */ }

  return { success: true, company_id: companyId, status: 'DISCONNECTED' };
}

export async function reconnectCompany(
  companyId: string,
  phoneNumber?: string,
): Promise<ConnectResult> {
  await disconnectCompany(companyId);
  await new Promise(r => setTimeout(r, 2000));
  return connectCompany(companyId, phoneNumber);
}

// ═══════════════════════════════════════════════════
//  FAZ 3: Queue Tabanlı Mesaj (Geriye Dönük)
// ═══════════════════════════════════════════════════

export interface QueueResult {
  success: boolean;
  message?: string;
  queue_id?: string;
  error?: string;
}

export async function queueMessage(
  companyId: string,
  phone: string,
  message: string,
  siteId?: string,
): Promise<QueueResult> {
  // Repository service_role client kullanır — RLS'ye takılmaz
  const result = await whatsAppRepository.enqueueMessage({
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

export async function queueBulkMessages(
  companyId: string,
  recipients: Array<{ phone: string; message: string }>,
  siteId?: string,
): Promise<{ success: boolean; queued: number; failed: number; queue_ids: string[] }> {
  // Repository service_role client kullanır — RLS'ye takılmaz
  const result = await whatsAppRepository.enqueueBulkMessages(
    siteId || companyId,
    companyId,
    recipients,
  );

  return {
    success: result.failed === 0,
    queued: result.queued,
    failed: result.failed,
    queue_ids: result.queueIds,
  };
}

export async function sendDirectMessage(
  companyId: string,
  to: string,
  message: string,
): Promise<{ success: boolean; error?: string; providerMessageId?: string | null }> {
  const result = await sendSiteDirectMessage(companyId, to, message);
  return {
    success: result.success,
    error: result.user_message || result.error_type,
    providerMessageId: result.providerMessageId,
  };
}

// ═══════════════════════════════════════════════════
//  Sağlık Kontrolü
// ═══════════════════════════════════════════════════

export async function getHealth() {
  const report = await whatsAppManager.getHealthReport();
  let evoPing: { alive: boolean; error?: string; version?: string; instances?: any[] };
  try {
    evoPing = await pingEvolutionApi();
  } catch {
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

export async function getEnterpriseHealth() {
  const managerReport = await whatsAppManager.getHealthReport();
  let evoPing: { alive: boolean; error?: string; version?: string; instances?: any[] };
  try {
    evoPing = await pingEvolutionApi();
  } catch {
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

// ═══════════════════════════════════════════════════
//  MULTI-TENANT DIAGNOSTICS
// ═══════════════════════════════════════════════════

export interface MultiTenantDiagnostics {
  timestamp: string;
  companyId: string;
  instanceName: string;
  connectionStatus: string;
  qrStatus: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  lastQrAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastErrorType: string | null;
  queuePending: number;
  queueSending: number;
  queueFailed: number;
  queueSentToday: number;
  radoreApiAlive: boolean;
  evolutionApiAlive: boolean;
  supabaseAlive: boolean;
  schedulerRunning: boolean;
  webhookRegistered: boolean;
  activeClients: number;
  connectedClients: number;
}

/**
 * Multi-tenant diagnostics — firma bazlı tüm sistem durumu.
 */
export async function getMultiTenantDiagnostics(token: string, siteId?: string): Promise<MultiTenantDiagnostics> {
  const ctx = await resolveCompanyContext(token, siteId);
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
  const instanceName = getCompanyInstanceName(companyId);

  // DB kaydını al
  const dbInstance = await whatsAppRepository.getCompanyInstance(companyId);

  // Queue istatistikleri
  let queueStats = { pending: 0, sending: 0, failed: 0, sentToday: 0 };
  try {
    queueStats = await whatsAppRepository.getQueueStats(resolvedSiteId);
  } catch { /* skip */ }

  // Evolution API ping
  let evoAlive = false;
  try {
    const evoPing = await pingEvolutionApi();
    evoAlive = evoPing.alive;
  } catch { /* skip */ }

  // Supabase ping
  let supabaseAlive = false;
  try {
    supabaseAlive = await whatsAppRepository.ping();
  } catch { /* skip */ }

  // Manager stats
  const activeClients = whatsAppManager.size;
  const connectedClients = whatsAppManager.connectedCount;

  // Scheduler (import edilemiyorsa true varsay)
  let schedulerRunning = false;
  try {
    const { whatsAppScheduler } = await import('./whatsapp.scheduler');
    schedulerRunning = whatsAppScheduler.isRunning();
  } catch { schedulerRunning = true; }

  // ═══ HİBRİT: Kanal bilgilerini de ekle ═══
  let channels: Array<{ channel_type: string; is_active: boolean; is_default: boolean; display_name: string | null; status: string; provider: string }> = [];
  try {
    const rawChannels = await whatsAppRepository.getCompanyChannels(companyId);
    channels = rawChannels.map((c) => ({
      channel_type: c.channel_type,
      is_active: c.is_active,
      is_default: c.is_default,
      display_name: c.display_name,
      status: c.status,
      provider: c.provider,
    }));
  } catch { /* skip */ }

  return {
    timestamp: now,
    companyId,
    instanceName,
    channels,
    connectionStatus: dbInstance?.connection_status || 'DISCONNECTED',
    qrStatus: dbInstance?.qr_status || null,
    phoneNumber: dbInstance?.phone_number || null,
    profileName: dbInstance?.phone_number ? (dbInstance as any)?.profile_name || null : null,
    lastQrAt: dbInstance?.last_qr_at || null,
    lastConnectedAt: dbInstance?.last_connected_at || null,
    lastError: dbInstance?.last_error || null,
    lastErrorType: (dbInstance as any)?.last_error_type || null,
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

// ═══════════════════════════════════════════════════
//  ARCHIVE DOĞRULAMA — Canlı Gönderim Testi için
// ═══════════════════════════════════════════════════

export interface ArchiveVerifyResult {
  found: boolean;
  archiveId: string | null;
  sendStatus: string | null;
  providerMessageId: string | null;
  instanceName: string | null;
  normalizedPhone: string | null;
  sentAt: string | null;
  errorType: string | null;
  queryDuration: number;
}

export async function verifyArchiveRecord(
  companyId: string,
  providerMessageId: string,
): Promise<ArchiveVerifyResult> {
  const start = Date.now();
  try {
    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
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
  } catch (err) {
    const duration = Date.now() - start;
    return {
      found: false, archiveId: null, sendStatus: null,
      providerMessageId, instanceName: null, normalizedPhone: null,
      sentAt: null, errorType: `exception: ${(err as Error).message}`, queryDuration: duration,
    };
  }
}