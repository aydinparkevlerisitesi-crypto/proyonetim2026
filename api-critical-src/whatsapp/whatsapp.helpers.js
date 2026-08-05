"use strict";
/**
 * WhatsApp Helpers — Instance name üretimi ve company_id çözümleme.
 *
 * Multi-tenant mimaride TEK instance name üretim noktası.
 * Tüm modüller (connect, status, disconnect, scheduler, message)
 * aynı fonksiyonları kullanır.
 *
 * SOLID: Single Responsibility — sadece deterministik isim üretimi.
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
exports.getActiveWhatsAppContext = exports.resolveRealEvolutionInstance = exports.resolveCompanyContext = exports.getCompanyInstanceName = exports.normalizeInstanceName = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const fetchCompat_1 = require("../../lib/fetchCompat");
const fs = __importStar(require("fs"));
// ═══════════════════════════════════════════════════
//  Instance Name Üretimi
// ═══════════════════════════════════════════════════
/**
 * Instance adını normalize et:
 * - küçük harf
 * - sadece alfanumerik + alt çizgi (tire YOK — Evolution API uyumluluğu)
 * - UUID tireleri alt çizgiye dönüşür
 */
function normalizeInstanceName(input) {
    return String(input || '')
        .toLowerCase()
        .trim()
        .replace(/-/g, '_') // UUID tirelerini alt çizgiye çevir
        .replace(/[^a-z0-9_]/g, ''); // geri kalan özel karakterleri sil
}
exports.normalizeInstanceName = normalizeInstanceName;
/**
 * Firma bazlı deterministik instance adı üret.
 * Aynı companyId için HER ZAMAN aynı instanceName döner.
 *
 * Format: proyonetim_company_{normalizeInstanceName(companyId)}
 *
 * TÜM işlemler (create, connect, status, reconnect, disconnect,
 * scheduler, message send) bu fonksiyonu kullanır.
 */
function getCompanyInstanceName(companyId) {
    return `proyonetim_company_${normalizeInstanceName(companyId)}`;
}
exports.getCompanyInstanceName = getCompanyInstanceName;
// ═══════════════════════════════════════════════════
//  Company ID Çözümleme (Auth Context)
// ═══════════════════════════════════════════════════
let supabaseAdmin = null;
function getSupabaseAdmin() {
    if (!supabaseAdmin) {
        // ─── ENV GUARD: URL veya key yoksa null döndür ───
        if (!config_1.config.supabase.url || !config_1.config.supabase.serviceRoleKey) {
            console.warn('[getSupabaseAdmin] Supabase URL veya key eksik — .env dosyasını kontrol edin.');
            return null;
        }
        supabaseAdmin = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
    }
    return supabaseAdmin;
}
/**
 * Supabase token'dan userId çöz, site_users + sites üzerinden
 * company_id'yi bul. Frontend'den gelen siteId güvenilir değil,
 * kullanıcının gerçekten o site'ye erişimi var mı kontrol edilir.
 *
 * @param token - Supabase access_token (Bearer sonrası)
 * @param requestedSiteId - Frontend'den gelen siteId (body/query'den)
 * @returns ResolvedCompanyContext veya null (yetkisiz)
 */
async function resolveCompanyContext(token, requestedSiteId) {
    // ─── GUARD: Supabase URL yoksa direkt null ───
    if (!config_1.config.supabase.url || !config_1.config.supabase.serviceRoleKey) {
        console.warn('[resolveCompanyContext] Supabase ayarları eksik (.env yok?) — yetkilendirme atlanıyor');
        return null;
    }
    try {
        const sb = getSupabaseAdmin();
        if (!sb) {
            console.warn('[resolveCompanyContext] Supabase admin client oluşturulamadı');
            return null;
        }
        // 1. Token'dan userId al — DİREKT FETCH (Supabase JS client PKCE bug workaround)
        let userId = null;
        try {
            const authRes = await (0, fetchCompat_1.safeFetch)(`${config_1.config.supabase.url.replace(/\/$/, '')}/auth/v1/user`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'apikey': config_1.config.supabase.anonKey,
                },
            }, 10000);
            if (authRes.ok) {
                const authData = await authRes.json();
                userId = authData?.id || null;
            }
            else {
                console.warn('[resolveCompanyContext] Token geçersiz:', authRes.status);
            }
        }
        catch (e) {
            console.warn('[resolveCompanyContext] Token doğrulama hatası:', e.message);
        }
        if (!userId) {
            console.warn('[resolveCompanyContext] Token geçersiz: userId alınamadı');
            return null;
        }
        // 2. site_users → user'ın bağlı olduğu site'leri bul
        const { data: siteUsers, error: suError } = await sb
            .from('site_users')
            .select('site_id')
            .eq('user_id', userId);
        if (suError || !siteUsers || siteUsers.length === 0) {
            console.warn('[resolveCompanyContext] Kullanıcı hiçbir site\'ye bağlı değil:', userId);
            return null;
        }
        const userSiteIds = siteUsers.map((su) => su.site_id);
        // 3. Hangi site'yi kullanacağımızı belirle
        let targetSiteId;
        if (requestedSiteId && userSiteIds.includes(requestedSiteId)) {
            // Frontend'den gelen siteId kullanıcının erişimi dahilinde → kullan
            targetSiteId = requestedSiteId;
        }
        else {
            // İlk site'yi kullan
            targetSiteId = userSiteIds[0];
        }
        // 4. sites tablosundan company_id'yi al
        const { data: siteData, error: siteError } = await sb
            .from('sites')
            .select('company_id')
            .eq('id', targetSiteId)
            .maybeSingle();
        if (siteError || !siteData?.company_id) {
            console.warn('[resolveCompanyContext] Site company_id bulunamadı:', targetSiteId);
            return null;
        }
        return {
            userId,
            companyId: siteData.company_id,
            siteId: targetSiteId,
        };
    }
    catch (err) {
        console.error('[resolveCompanyContext] Hata:', err.message);
        return null;
    }
}
exports.resolveCompanyContext = resolveCompanyContext;
/**
 * resolveRealEvolutionInstance — TEK INSTANCE ÇÖZÜMLEME NOKTASI.
 *
 * BU FONKSIYON STATUS VE SEND IÇIN ORTAK KULLANILIR.
 * AYRI AYRI INSTANCE ÇÖZME YASAKTIR.
 *
 * Adımlar:
 * 1. Bridge state dosyasından currentInstance oku
 * 2. whatsapp_company_channels → is_default=true instance
 * 3. whatsapp_sessions → aktif instance
 * 4. ENV instance oku
 * 5. Evolution API /instance/fetchInstances → GERÇEK INSTANCE LISTESI
 * 6. Gelen listede state=open/connected olan instance'ı SEÇ
 * 7. Bridge state currentInstance listede YOKSA onu KULLANMA
 * 8. Seçilen instance'ı bridge state'e YAZ
 * 9. Status ve send aynı selectedRealInstance değerini kullanır
 *
 * @param companyId - Firma ID
 * @returns ResolvedRealInstance — gerçek Evolution instance bilgisi
 */
async function resolveRealEvolutionInstance(companyId) {
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
    const evoKey = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    let currentBridgeInstance = null;
    let dbInstance = null;
    let sessionInstance = null;
    let envInstance = null;
    // ═══ 1. Bridge state ═══
    const bridgeStatePath = '/var/www/proyonetim/api/whatsapp-qr-bridge-state.json';
    try {
        if (fs.existsSync(bridgeStatePath)) {
            const raw = fs.readFileSync(bridgeStatePath, 'utf-8');
            const state = JSON.parse(raw);
            const rawInst = state?.currentInstance;
            if (rawInst && typeof rawInst === 'string' && rawInst.length > 0) {
                currentBridgeInstance = rawInst;
                console.log(`[resolveRealEvolutionInstance] Bridge: ${currentBridgeInstance}`);
            }
        }
    }
    catch (e) {
        console.warn('[resolveRealEvolutionInstance] Bridge okuma hatası:', e.message);
    }
    // ═══ 2. whatsapp_company_channels ═══
    try {
        const sb = getSupabaseAdmin();
        const { data: channel } = await sb
            .from('whatsapp_company_channels')
            .select('instance_name')
            .eq('company_id', companyId)
            .eq('is_default', true)
            .eq('is_active', true)
            .maybeSingle();
        const raw = channel?.instance_name;
        if (raw) {
            const clean = normalizeInstanceName(raw);
            if (clean && clean.length > 3) {
                dbInstance = clean;
                console.log(`[resolveRealEvolutionInstance] company_channels: ${dbInstance}`);
            }
        }
    }
    catch (e) {
        console.warn('[resolveRealEvolutionInstance] company_channels hatası:', e.message);
    }
    // ═══ 3. whatsapp_sessions ═══
    try {
        const sb = getSupabaseAdmin();
        const { data: session } = await sb
            .from('whatsapp_sessions')
            .select('instance_name')
            .eq('company_id', companyId)
            .in('status', ['CONNECTED', 'connected', 'WAITING_QR'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const raw = session?.instance_name;
        if (raw) {
            const clean = normalizeInstanceName(raw);
            if (clean && clean.length > 3) {
                sessionInstance = clean;
                console.log(`[resolveRealEvolutionInstance] sessions: ${sessionInstance}`);
            }
        }
    }
    catch (e) {
        console.warn('[resolveRealEvolutionInstance] sessions hatası:', e.message);
    }
    // ═══ 4. ENV ═══
    const rawEnv = process.env.EVOLUTION_INSTANCE_NAME || process.env.WHATSAPP_INSTANCE_NAME || '';
    const cleanEnv = normalizeInstanceName(rawEnv);
    if (cleanEnv && cleanEnv.length > 3) {
        envInstance = cleanEnv;
        console.log(`[resolveRealEvolutionInstance] ENV: ${envInstance}`);
    }
    // ═══ 5. Evolution API'DEN GERÇEK INSTANCE LISTESI ═══
    let availableInstances = [];
    try {
        const res = await (0, fetchCompat_1.safeFetch)(`${evoUrl}/instance/fetchInstances`, {
            headers: { apikey: evoKey },
        }, 8000);
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data?.instances || []);
            availableInstances = list.map((i) => ({
                instanceName: i.instanceName || i.name || 'unknown',
                // Evolution v2: connectionStatus (status/state often absent)
                status: i.connectionStatus || i.status || i.state || 'unknown',
                number: i.number || i.owner || (typeof i.ownerJid === 'string' ? i.ownerJid.split('@')[0] : undefined),
                profileName: i.profileName || i.pushName || undefined,
            }));
            console.log(`[resolveRealEvolutionInstance] fetchInstances: ${availableInstances.length} instance bulundu, open olanlar: ${availableInstances.filter(i => i.status === 'open' || i.status === 'connected').map(i => i.instanceName).join(', ')}`);
        }
        else {
            console.warn(`[resolveRealEvolutionInstance] fetchInstances HTTP ${res.status}`);
        }
    }
    catch (err) {
        console.warn(`[resolveRealEvolutionInstance] fetchInstances BAŞARISIZ: ${err.message}`);
    }
    // ═══ 5b. Stale "open" temizliği — connectionState ile doğrula ═══
    // fetchInstances connectionStatus=open iken Baileys kapalı olabilir (Connection Closed → 500).
    const verifiedOpen = [];
    for (const inst of availableInstances) {
        const listedOpen = inst.status === 'open' || inst.status === 'connected' || inst.status === 'CONNECTED';
        if (!listedOpen)
            continue;
        try {
            const stRes = await (0, fetchCompat_1.safeFetch)(`${evoUrl}/instance/connectionState/${encodeURIComponent(inst.instanceName)}`, { headers: { apikey: evoKey } }, 6000);
            if (!stRes.ok)
                continue;
            const stData = await stRes.json();
            const live = String(stData?.instance?.state || stData?.state || '').toLowerCase();
            if (live === 'open' || live === 'connected') {
                verifiedOpen.push({ ...inst, status: 'open' });
            }
            else {
                console.warn(`[resolveRealEvolutionInstance] Stale open elendi: ${inst.instanceName} live=${live || 'unknown'}`);
            }
        }
        catch (e) {
            console.warn(`[resolveRealEvolutionInstance] connectionState doğrulama hatası (${inst.instanceName}): ${e.message}`);
        }
    }
    // ═══ 6. Aday instance'ları sırayla tara ═══
    const candidates = [currentBridgeInstance, dbInstance, sessionInstance, envInstance].filter(Boolean);
    // ═══ 7. Gerçek listede open/connected olan instance'ı bul ═══
    const openInstances = verifiedOpen.length > 0
        ? verifiedOpen
        : availableInstances.filter(i => i.status === 'open' || i.status === 'connected');
    let selectedInstanceName = '';
    let selectedState = '';
    let selectedPhone = null;
    let selectedProfileName = null;
    let source = '';
    if (openInstances.length > 0) {
        // Önce adaylar arasından open olanı bul
        const matchedOpen = openInstances.find(i => candidates.includes(i.instanceName));
        if (matchedOpen) {
            selectedInstanceName = matchedOpen.instanceName;
            selectedState = matchedOpen.status;
            selectedPhone = matchedOpen.number || null;
            selectedProfileName = matchedOpen.profileName || null;
            source = 'fetchInstances_matched_candidate';
            console.log(`[resolveRealEvolutionInstance] Aday eşleşti + open: ${selectedInstanceName}`);
        }
        else if (candidates.length > 0) {
            // Adaylar open değil → başka firmanın open instance'ını ÇALMA
            selectedInstanceName = candidates[0];
            selectedState = 'close';
            source = 'candidate_not_live_open';
            console.warn(`[resolveRealEvolutionInstance] Adaylar canlı open değil; yabancı instance kullanılmadı. aday=${selectedInstanceName}`);
        }
        else {
            // Aday yok → ilk doğrulanmış open (yalnızca bridge/DB boşken)
            const firstOpen = openInstances[0];
            selectedInstanceName = firstOpen.instanceName;
            selectedState = firstOpen.status;
            selectedPhone = firstOpen.number || null;
            selectedProfileName = firstOpen.profileName || null;
            source = 'fetchInstances_first_open';
            console.log(`[resolveRealEvolutionInstance] Aday yok, ilk open instance: ${selectedInstanceName}`);
        }
    }
    else if (availableInstances.length > 0) {
        // Open yok ama instance'lar var → ilk adayla eşleşeni bul
        const matchedAny = availableInstances.find(i => candidates.includes(i.instanceName));
        if (matchedAny) {
            selectedInstanceName = matchedAny.instanceName;
            selectedState = matchedAny.status;
            selectedPhone = matchedAny.number || null;
            selectedProfileName = matchedAny.profileName || null;
            source = 'fetchInstances_matched_candidate_not_open';
            console.log(`[resolveRealEvolutionInstance] Aday eşleşti ama open değil (${selectedState}): ${selectedInstanceName}`);
        }
        else {
            // Hiç eşleşme yok → yabancı/stale instance ÇALMA; firma kanoniğine dön
            selectedInstanceName = getCompanyInstanceName(companyId);
            selectedState = 'close';
            selectedPhone = null;
            selectedProfileName = null;
            source = 'deterministic_fallback_no_candidate_match';
            console.warn(`[resolveRealEvolutionInstance] Aday yok/eşleşmedi; kanonik instance: ${selectedInstanceName} (stale first_any engellendi)`);
        }
    }
    else {
        // Evolution'da hiç instance yok → deterministik fallback
        selectedInstanceName = getCompanyInstanceName(companyId);
        selectedState = 'close';
        source = 'deterministic_fallback_no_instances';
        console.log(`[resolveRealEvolutionInstance] Evolution'da instance yok, fallback: ${selectedInstanceName}`);
    }
    // ═══ 8. Bridge state'i güncelle ═══
    const connected = selectedState === 'open' || selectedState === 'connected';
    if (selectedInstanceName && selectedInstanceName !== currentBridgeInstance) {
        try {
            const dir = '/var/www/proyonetim/api';
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(bridgeStatePath, JSON.stringify({
                currentInstance: selectedInstanceName,
                resolvedAt: new Date().toISOString(),
                source,
                connected,
                state: selectedState,
                previousInstance: currentBridgeInstance,
            }, null, 2));
            console.log(`[resolveRealEvolutionInstance] Bridge state güncellendi: ${currentBridgeInstance || 'YOK'} → ${selectedInstanceName}`);
        }
        catch (e) {
            console.warn('[resolveRealEvolutionInstance] Bridge state yazma hatası:', e.message);
        }
    }
    return {
        instanceName: selectedInstanceName,
        connected,
        state: selectedState,
        phone: selectedPhone,
        profileName: selectedProfileName,
        source,
        availableInstances,
        currentBridgeInstance,
    };
}
exports.resolveRealEvolutionInstance = resolveRealEvolutionInstance;
/**
 * Aktif WhatsApp bağlamını çöz.
 *
 * Bu fonksiyon, STATUS ve SEND akışları için TEK instance çözümleme noktasıdır.
 * Her iki endpoint de aynı instanceName'i kullanır.
 *
 * Çözümleme sırası:
 * 1. resolveRealEvolutionInstance() — Evolution API'den gerçek instance listesini çeker
 *    ve bridge state + company_channels + sessions + ENV ile cross-check yapar.
 *    SADECE Evolution'da gerçekten kayıtlı ve open/connected olan instance'ı seçer.
 *
 * Instance bulunduktan sonra Evolution API'den canlı connectionState kontrolü yapılır.
 * SADECE 'open' veya 'connected' durumu CONNECTED kabul edilir.
 */
async function getActiveWhatsAppContext(companyId) {
    const lastCheckedAt = new Date().toISOString();
    // ═══ TEK KAYNAK: resolveRealEvolutionInstance ═══
    // Bu fonksiyon Evolution API'den instance listesini çeker,
    // open/connected instance'ı seçer, bridge state'i günceller.
    const resolved = await resolveRealEvolutionInstance(companyId);
    const instanceName = resolved.instanceName;
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
    const evoKey = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    let liveState = resolved.state;
    let phone = resolved.phone;
    let profileName = resolved.profileName;
    // ═══ Evolution API canlı connectionState kontrolü ═══
    // resolveRealEvolutionInstance zaten state'i getirdi, ama
    // burada tekrar kontrol ederek canlı state'i güncelliyoruz
    const encodedInstance = encodeURIComponent(instanceName);
    try {
        const res = await (0, fetchCompat_1.safeFetch)(`${evoUrl}/instance/connectionState/${encodedInstance}`, { headers: { apikey: evoKey } }, 8000);
        if (res.ok) {
            const data = await res.json();
            const fetchedState = data?.instance?.state || data?.state || liveState;
            if (fetchedState !== liveState) {
                console.log(`[getActiveWhatsAppContext] Canlı state değişti: ${liveState} → ${fetchedState}`);
                liveState = fetchedState;
            }
            console.log(`[getActiveWhatsAppContext] Evolution canlı durum: ${liveState}, instance=${instanceName}, encoded=${encodedInstance}`);
            // Telefon/profil bilgilerini güncelle
            if (liveState === 'open' || liveState === 'connected') {
                try {
                    const infoRes = await (0, fetchCompat_1.safeFetch)(`${evoUrl}/instance/fetchInstances?instanceName=${encodedInstance}`, { headers: { apikey: evoKey } }, 5000);
                    if (infoRes.ok) {
                        const infoData = await infoRes.json();
                        const instances = Array.isArray(infoData) ? infoData : (infoData?.instances || [infoData?.instance || infoData]);
                        const instance = Array.isArray(instances) ? instances.find((i) => i.instanceName === instanceName || i.name === instanceName) : instances;
                        if (instance) {
                            phone = instance.owner || instance.number || phone;
                            profileName = instance.profileName || instance.pushName || profileName;
                        }
                    }
                }
                catch {
                    // Telefon bilgisi opsiyonel
                }
            }
        }
    }
    catch (err) {
        console.warn(`[getActiveWhatsAppContext] Evolution API erişilemedi: ${err.message}`);
    }
    // ═══ State mapping ═══
    const ls = String(liveState || '').toLowerCase();
    const connected = ls === 'open' || ls === 'connected';
    let status = connected ? 'CONNECTED'
        : (ls === 'qrcode' || ls === 'qr') ? 'QR_READY'
            : (ls === 'connecting' || ls === 'reconnecting') ? 'CONNECTING'
                : 'DISCONNECTED';
    // Asla ham/boş state'i UNKNOWN olarak yüzeye çıkarma
    if (!status || status === 'UNKNOWN' || status === 'unknown') status = 'DISCONNECTED';
    liveState = ls || 'close';
    // KEEP_OPEN_SYNC/*RESTORE_HELPER_OPEN*/
    {
        const ls = String(liveState || '').toLowerCase();
        if (ls === 'open' || ls === 'connected' || connected) {
            console.log(`[getActiveWhatsAppContext] KEEP_OPEN_SYNC → CONNECTED (${instanceName})`);
            return {
                connected: true,
                status: 'CONNECTED',
                state: 'open',
                instanceName,
                phone,
                profileName,
                provider: 'evolution',
                channel: 'CONNECTED_DEVICE',
                source: 'keep_open_sync',
                lastCheckedAt,
                availableInstances: resolved.availableInstances,
                currentBridgeInstance: resolved.currentBridgeInstance,
                selectedRealInstance: instanceName,
            };
        }
    }
    return {
        connected,
        status,
        state: liveState,
        instanceName,
        phone,
        profileName,
        provider: 'evolution',
        channel: 'CONNECTED_DEVICE',
        source: resolved.source,
        lastCheckedAt,
        availableInstances: resolved.availableInstances,
        currentBridgeInstance: resolved.currentBridgeInstance,
        selectedRealInstance: instanceName,
    };
}
exports.getActiveWhatsAppContext = getActiveWhatsAppContext;
//# sourceMappingURL=whatsapp.helpers.js.map