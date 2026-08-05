"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsAppRepository = exports.WhatsAppRepository = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
// ─── Singleton Supabase Admin Client ──────────────
let supabaseAdmin = null;
function getAdmin() {
    if (!supabaseAdmin) {
        supabaseAdmin = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
    }
    return supabaseAdmin;
}
// ═══════════════════════════════════════════════════
//  Company / Site WhatsApp Session Repository
// ═══════════════════════════════════════════════════
class WhatsAppRepository {
    get sb() {
        return getAdmin();
    }
    // ─── Company Instance CRUD (YENİ — Multi-Tenant) ──
    /**
     * Firma için instance kaydını bul veya oluştur.
     * Her firma için SADECE 1 instance olur.
     * instanceName = getCompanyInstanceName(companyId) (deterministik)
     */
    async findOrCreateCompanyInstance(params) {
        const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(params.companyId);
        // Önce var mı kontrol et
        const { data: existing, error: findError } = await this.sb
            .from('whatsapp_company_instances')
            .select('*')
            .eq('company_id', params.companyId)
            .maybeSingle();
        if (findError) {
            console.error('[Repository] findOrCreateCompanyInstance find error:', findError.message);
        }
        if (existing) {
            // instance_name güncel değilse güncelle (migration sonrası olabilir)
            if (existing.instance_name !== instanceName) {
                await this.sb
                    .from('whatsapp_company_instances')
                    .update({ instance_name: instanceName, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
                existing.instance_name = instanceName;
            }
            return existing;
        }
        // Yok → oluştur
        const now = new Date().toISOString();
        const { data: created, error: insertError } = await this.sb
            .from('whatsapp_company_instances')
            .insert({
            company_id: params.companyId,
            site_id: params.siteId || null,
            instance_name: instanceName,
            connection_status: 'DISCONNECTED',
            created_by: params.createdBy || null,
            created_at: now,
            updated_at: now,
        })
            .select('*')
            .single();
        if (insertError) {
            console.error('[Repository] findOrCreateCompanyInstance insert error:', insertError.message);
            // Race condition — belki başka bir istek aynı anda oluşturdu
            const { data: retry } = await this.sb
                .from('whatsapp_company_instances')
                .select('*')
                .eq('company_id', params.companyId)
                .maybeSingle();
            if (retry)
                return retry;
            throw new Error(`Company instance oluşturulamadı: ${insertError.message}`);
        }
        console.log(`[Repository] Yeni company instance oluşturuldu: ${instanceName} (company: ${params.companyId})`);
        return created;
    }
    /** Belirli bir firmanın instance kaydını getir */
    async getCompanyInstance(companyId) {
        const { data, error } = await this.sb
            .from('whatsapp_company_instances')
            .select('*')
            .eq('company_id', companyId)
            .maybeSingle();
        if (error) {
            console.error('[Repository] getCompanyInstance error:', error.message);
            return null;
        }
        return data;
    }
    /** Instance adına göre kayıt getir */
    async getCompanyInstanceByName(instanceName) {
        const { data, error } = await this.sb
            .from('whatsapp_company_instances')
            .select('*')
            .eq('instance_name', instanceName)
            .maybeSingle();
        if (error) {
            console.error('[Repository] getCompanyInstanceByName error:', error.message);
            return null;
        }
        return data;
    }
    /** Tüm firma instance'larını getir */
    async getAllCompanyInstances() {
        const { data, error } = await this.sb
            .from('whatsapp_company_instances')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('[Repository] getAllCompanyInstances error:', error.message);
            return [];
        }
        return (data || []);
    }
    /** Scheduler için: sadece reconnect edilmesi gereken instance'ları getir */
    async getDisconnectedCompanyInstances() {
        const { data, error } = await this.sb
            .from('whatsapp_company_instances')
            .select('*')
            .in('connection_status', ['DISCONNECTED', 'ERROR'])
            .order('updated_at', { ascending: true });
        if (error) {
            console.error('[Repository] getDisconnectedCompanyInstances error:', error.message);
            return [];
        }
        return (data || []);
    }
    /** Instance durumunu güncelle */
    async updateCompanyInstanceStatus(companyId, updates) {
        const payload = {
            updated_at: new Date().toISOString(),
        };
        if (updates.connectionStatus !== undefined)
            payload.connection_status = updates.connectionStatus;
        if (updates.qrStatus !== undefined)
            payload.qr_status = updates.qrStatus;
        if (updates.phoneNumber !== undefined)
            payload.phone_number = updates.phoneNumber;
        if (updates.profileName !== undefined)
            payload.profile_name = updates.profileName;
        if (updates.lastQrAt !== undefined)
            payload.last_qr_at = updates.lastQrAt;
        if (updates.lastConnectedAt !== undefined)
            payload.last_connected_at = updates.lastConnectedAt;
        if (updates.lastDisconnectedAt !== undefined)
            payload.last_disconnected_at = updates.lastDisconnectedAt;
        if (updates.lastError !== undefined)
            payload.last_error = updates.lastError;
        if (updates.lastErrorType !== undefined)
            payload.last_error_type = updates.lastErrorType;
        if (updates.siteId !== undefined)
            payload.site_id = updates.siteId;
        const { error } = await this.sb
            .from('whatsapp_company_instances')
            .update(payload)
            .eq('company_id', companyId);
        if (error) {
            console.error('[Repository] updateCompanyInstanceStatus error:', error.message);
        }
    }
    // ─── Session CRUD (Mevcut — whatsapp_sessions) ──
    /** Belirli bir site/company'nin WhatsApp oturum kaydını getir */
    async findSession(siteId, companyId) {
        try {
            let query = this.sb.from('whatsapp_sessions').select('*');
            if (siteId) {
                query = query.eq('site_id', siteId);
            }
            if (companyId) {
                query = query.eq('company_id', companyId);
            }
            const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
            return data || null;
        }
        catch (err) {
            console.error('[Repository] findSession error:', err.message);
            return null;
        }
    }
    /** Tüm oturumları getir */
    async findAllSessions() {
        try {
            const { data } = await this.sb
                .from('whatsapp_sessions')
                .select('*')
                .order('updated_at', { ascending: false });
            return data || [];
        }
        catch (err) {
            console.error('[Repository] findAllSessions error:', err.message);
            return [];
        }
    }
    /** Aktif bağlantısı olan oturumları getir */
    async findActiveSessions() {
        try {
            const { data } = await this.sb
                .from('whatsapp_sessions')
                .select('*')
                .in('status', ['CONNECTED', 'RECONNECTING', 'WAITING_QR']);
            return data || [];
        }
        catch (err) {
            console.error('[Repository] findActiveSessions error:', err.message);
            return [];
        }
    }
    /** Oturum oluştur veya güncelle (upsert) */
    async upsertSession(params) {
        try {
            const sessionId = `site-${params.siteId}`;
            const existing = await this.findSession(params.siteId, params.companyId);
            const now = new Date().toISOString();
            const payload = {
                updated_at: now,
                last_activity: now,
            };
            if (params.status !== undefined)
                payload.status = params.status;
            if (params.phoneNumber !== undefined)
                payload.phone_number = params.phoneNumber;
            if (params.sessionPath !== undefined) {
                payload.provider_config = { session_path: params.sessionPath };
            }
            if (params.qrCode !== undefined)
                payload.qr_code = params.qrCode;
            if (params.connectedAt !== undefined)
                payload.connected_at = params.connectedAt;
            if (params.error !== undefined)
                payload.error = params.error;
            if (params.profileName !== undefined)
                payload.device_name = params.profileName;
            if (params.instanceName !== undefined)
                payload.instance_name = params.instanceName;
            if (params.battery !== undefined)
                payload.provider_config = { ...(payload.provider_config || {}), battery: params.battery };
            if (params.lastSeen !== undefined)
                payload.last_activity = params.lastSeen;
            if (existing) {
                await this.sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
            }
            else {
                await this.sb.from('whatsapp_sessions').insert({
                    session_id: sessionId,
                    company_id: params.companyId || null,
                    site_id: params.siteId,
                    status: params.status || 'DISCONNECTED',
                    phone_number: params.phoneNumber || null,
                    device_name: params.profileName || 'ProYonetim Bot',
                    qr_code: params.qrCode || null,
                    error: params.error || null,
                    connected_at: params.connectedAt || null,
                    provider: 'baileys',
                    provider_config: params.sessionPath ? { session_path: params.sessionPath } : null,
                    ...payload,
                });
            }
            return true;
        }
        catch (err) {
            console.error('[Repository] upsertSession error:', err.message);
            return false;
        }
    }
    /** Oturum durumunu güncelle */
    async updateSessionStatus(siteId, companyId, status, extras) {
        try {
            const existing = await this.findSession(siteId, companyId);
            if (!existing)
                return;
            const payload = {
                status,
                updated_at: new Date().toISOString(),
            };
            if (extras?.error !== undefined)
                payload.error = extras.error;
            if (extras?.phoneNumber !== undefined)
                payload.phone_number = extras.phoneNumber;
            if (extras?.qrCode !== undefined)
                payload.qr_code = extras.qrCode;
            if (extras?.connectedAt !== undefined)
                payload.connected_at = extras.connectedAt;
            await this.sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
        }
        catch (err) {
            console.error('[Repository] updateSessionStatus error:', err.message);
        }
    }
    // ─── Message Queue CRUD ─────────────────────
    /** Kuyruğa mesaj ekle */
    async enqueueMessage(params) {
        try {
            const { data, error } = await this.sb
                .from('message_queue')
                .insert({
                company_id: params.companyId || params.siteId,
                site_id: params.siteId,
                phone: params.phone,
                message: params.message,
                status: 'pending',
                retry_count: 0,
                max_retries: params.maxRetries || 3,
                priority: params.priority || 0,
            })
                .select('id')
                .single();
            if (error) {
                console.error('[Repository] enqueueMessage error:', error.message);
                return null;
            }
            return { id: data.id };
        }
        catch (err) {
            console.error('[Repository] enqueueMessage error:', err.message);
            return null;
        }
    }
    /** Toplu mesajları kuyruğa ekle */
    async enqueueBulkMessages(siteId, companyId, recipients, maxRetries) {
        let queued = 0;
        let failed = 0;
        const queueIds = [];
        const rows = recipients.map((r) => ({
            company_id: companyId || siteId,
            site_id: siteId,
            phone: r.phone,
            message: r.message,
            status: 'pending',
            retry_count: 0,
            max_retries: maxRetries || 3,
            priority: r.priority || 0,
        }));
        try {
            const { data, error } = await this.sb.from('message_queue').insert(rows).select('id');
            if (error) {
                failed = recipients.length;
                console.error('[Repository] enqueueBulkMessages error:', error.message);
            }
            else if (data) {
                queued = data.length;
                failed = recipients.length - data.length;
                data.forEach((d) => queueIds.push(d.id));
            }
        }
        catch (err) {
            failed = recipients.length;
            console.error('[Repository] enqueueBulkMessages error:', err.message);
        }
        return { queued, failed, queueIds };
    }
    /** Bekleyen mesajları getir (belirli bir site için) */
    async getPendingMessages(siteId, limit = 50) {
        try {
            const { data } = await this.sb
                .from('message_queue')
                .select('*')
                .eq('site_id', siteId)
                .eq('status', 'pending')
                .order('priority', { ascending: false })
                .order('created_at', { ascending: true })
                .limit(limit);
            return data || [];
        }
        catch (err) {
            console.error('[Repository] getPendingMessages error:', err.message);
            return [];
        }
    }
    /** Takılı kalmış mesajları getir (sending status) */
    async getStuckMessages(siteId) {
        try {
            const { data } = await this.sb
                .from('message_queue')
                .select('*')
                .eq('site_id', siteId)
                .eq('status', 'sending')
                .order('created_at', { ascending: true })
                .limit(100);
            return data || [];
        }
        catch (err) {
            console.error('[Repository] getStuckMessages error:', err.message);
            return [];
        }
    }
    /** Mesaj kuyruk durumunu güncelle */
    async updateQueueStatus(queueId, status, error) {
        try {
            const payload = { status };
            if (status === 'sent' || status === 'failed') {
                payload.sent_at = new Date().toISOString();
            }
            if (error)
                payload.error = error;
            if (status === 'failed') {
                const { data: existing } = await this.sb
                    .from('message_queue')
                    .select('retry_count')
                    .eq('id', queueId)
                    .maybeSingle();
                if (existing) {
                    payload.retry_count = (existing.retry_count || 0) + 1;
                }
            }
            await this.sb.from('message_queue').update(payload).eq('id', queueId);
        }
        catch (err) {
            console.error('[Repository] updateQueueStatus error:', err.message);
        }
    }
    /** Kuyruk istatistiklerini getir */
    async getQueueStats(siteId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [{ count: pending }, { count: sending }, { count: sentToday }, { count: failed }] = await Promise.all([
                this.sb.from('message_queue').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'pending'),
                this.sb.from('message_queue').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'sending'),
                this.sb.from('message_queue').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'sent').gte('sent_at', today.toISOString()),
                this.sb.from('message_queue').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'failed'),
            ]);
            return {
                pending: pending || 0,
                sending: sending || 0,
                sentToday: sentToday || 0,
                failed: failed || 0,
            };
        }
        catch (err) {
            console.error('[Repository] getQueueStats error:', err.message);
            return { pending: 0, sending: 0, sentToday: 0, failed: 0 };
        }
    }
    /** Basit ping — bağlantı testi */
    async ping() {
        try {
            const { error } = await this.sb.from('whatsapp_sessions').select('id', { count: 'exact', head: true });
            return !error;
        }
        catch {
            return false;
        }
    }
    /** whatsapp_message_logs tablosunda provider_message_id ile eşleşen kaydın status'ünü güncelle */
    async updateMessageLogStatus(providerMessageId, status) {
        try {
            const payload = {
                updated_at: new Date().toISOString(),
                delivery_status: status,
            };
            await this.sb
                .from('whatsapp_message_logs')
                .update(payload)
                .eq('whatsapp_message_id', providerMessageId);
        }
        catch (err) {
            // whatsapp_message_logs tablosu yoksa veya kayıt bulunamazsa sessizce atla
            console.warn('[Repository] updateMessageLogStatus error (non-critical):', err.message);
        }
    }
    // ─── Message Log ────────────────────────────
    /** Gelen mesajı log'a yaz */
    async logIncomingMessage(params) {
        try {
            await this.sb.from('whatsapp_message_logs').insert({
                company_id: params.companyId || params.siteId,
                site_id: params.siteId,
                from_phone: params.fromPhone,
                body: params.body,
                direction: 'incoming',
                message_type: params.messageType || 'text',
                whatsapp_message_id: params.messageId || null,
            });
        }
        catch (err) {
            console.error('[Repository] logIncomingMessage error:', err.message);
        }
    }
    /** Giden mesajı log'a yaz */
    async logOutgoingMessage(params) {
        try {
            await this.sb.from('whatsapp_message_logs').insert({
                company_id: params.companyId || params.siteId,
                site_id: params.siteId,
                to_phone: params.toPhone,
                body: params.body,
                direction: 'outgoing',
                message_type: params.messageType || 'text',
                whatsapp_message_id: params.messageId || null,
            });
        }
        catch (err) {
            console.error('[Repository] logOutgoingMessage error:', err.message);
        }
    }
    // ─── KANAL CRUD (HİBRİT MİMARİ) ─────────────────────
    /** Firma için varsayılan kanalı getir */
    async getDefaultChannel(companyId) {
        try {
            const { data, error } = await this.sb
                .from('whatsapp_company_channels')
                .select('*')
                .eq('company_id', companyId)
                .eq('is_default', true)
                .eq('is_active', true)
                .maybeSingle();
            if (error) {
                console.error('[Repository] getDefaultChannel error:', error.message);
                return null;
            }
            // Eğer varsayılan kanal yoksa, ilk aktif CONNECTED_DEVICE'i varsayılan yap
            if (!data) {
                const { data: firstActive } = await this.sb
                    .from('whatsapp_company_channels')
                    .select('*')
                    .eq('company_id', companyId)
                    .eq('channel_type', 'CONNECTED_DEVICE')
                    .eq('is_active', true)
                    .maybeSingle();
                if (firstActive) {
                    // Bunu varsayılan yap
                    await this.sb
                        .from('whatsapp_company_channels')
                        .update({ is_default: true, updated_at: new Date().toISOString() })
                        .eq('id', firstActive.id);
                    return firstActive;
                }
                return null;
            }
            return data;
        }
        catch (err) {
            console.error('[Repository] getDefaultChannel error:', err.message);
            return null;
        }
    }
    /** Firma için tüm aktif kanalları getir */
    async getCompanyChannels(companyId) {
        try {
            const { data, error } = await this.sb
                .from('whatsapp_company_channels')
                .select('*')
                .eq('company_id', companyId)
                .eq('is_active', true)
                .order('created_at', { ascending: true });
            if (error) {
                console.error('[Repository] getCompanyChannels error:', error.message);
                return [];
            }
            return (data || []);
        }
        catch (err) {
            console.error('[Repository] getCompanyChannels error:', err.message);
            return [];
        }
    }
    /** Belirli bir kanalı ID ile getir */
    async getChannelById(channelId) {
        try {
            const { data, error } = await this.sb
                .from('whatsapp_company_channels')
                .select('*')
                .eq('id', channelId)
                .maybeSingle();
            if (error) {
                console.error('[Repository] getChannelById error:', error.message);
                return null;
            }
            return data;
        }
        catch (err) {
            console.error('[Repository] getChannelById error:', err.message);
            return null;
        }
    }
    /** Belirli bir türdeki kanalı getir (firma + channel_type) */
    async getChannelByType(companyId, channelType) {
        try {
            const { data, error } = await this.sb
                .from('whatsapp_company_channels')
                .select('*')
                .eq('company_id', companyId)
                .eq('channel_type', channelType)
                .maybeSingle();
            if (error) {
                console.error('[Repository] getChannelByType error:', error.message);
                return null;
            }
            return data;
        }
        catch (err) {
            console.error('[Repository] getChannelByType error:', err.message);
            return null;
        }
    }
    /** CONNECTED_DEVICE kanalını bul/oluştur (Evolution QR bağlantısı için) */
    async findOrCreateConnectedDeviceChannel(params) {
        const existing = await this.getChannelByType(params.companyId, 'CONNECTED_DEVICE');
        if (existing) {
            // Güncelle
            const updates = { updated_at: new Date().toISOString() };
            if (params.instanceName && existing.instance_name !== params.instanceName) {
                updates.instance_name = params.instanceName;
            }
            if (params.senderPhone && existing.sender_phone !== params.senderPhone) {
                updates.sender_phone = params.senderPhone;
            }
            if (Object.keys(updates).length > 1) {
                await this.sb.from('whatsapp_company_channels').update(updates).eq('id', existing.id);
            }
            return existing;
        }
        // Oluştur
        const now = new Date().toISOString();
        const { data: created, error } = await this.sb
            .from('whatsapp_company_channels')
            .insert({
            company_id: params.companyId,
            channel_type: 'CONNECTED_DEVICE',
            is_active: true,
            is_default: true,
            display_name: 'Bağlı WhatsApp Cihazı',
            sender_phone: params.senderPhone || null,
            instance_name: params.instanceName || (0, whatsapp_helpers_1.getCompanyInstanceName)(params.companyId),
            provider: 'evolution',
            status: 'DISCONNECTED',
            created_at: now,
            updated_at: now,
        })
            .select('*')
            .single();
        if (error) {
            console.error('[Repository] findOrCreateConnectedDeviceChannel insert error:', error.message);
            throw new Error(`Connected device channel oluşturulamadı: ${error.message}`);
        }
        console.log(`[Repository] Yeni CONNECTED_DEVICE kanalı oluşturuldu: ${params.companyId}`);
        return created;
    }
    /** OFFICIAL_CLOUD_API kanalını oluştur/güncelle */
    async upsertOfficialCloudApiChannel(params) {
        const existing = await this.getChannelByType(params.companyId, 'OFFICIAL_CLOUD_API');
        const now = new Date().toISOString();
        const payload = {
            company_id: params.companyId,
            channel_type: 'OFFICIAL_CLOUD_API',
            is_active: true,
            waba_id: params.wabaId,
            phone_number_id: params.phoneNumberId,
            access_token_encrypted: params.accessTokenEncrypted,
            webhook_verify_token_encrypted: params.webhookVerifyTokenEncrypted || null,
            display_name: params.displayName || 'Resmi WhatsApp Business API',
            provider: 'meta_cloud',
            status: 'CONFIGURED',
            updated_at: now,
        };
        if (existing) {
            const { data, error } = await this.sb
                .from('whatsapp_company_channels')
                .update(payload)
                .eq('id', existing.id)
                .select('*')
                .single();
            if (error) {
                console.error('[Repository] upsertOfficialCloudApiChannel update error:', error.message);
                throw new Error(`Official Cloud API channel güncellenemedi: ${error.message}`);
            }
            return data;
        }
        const { data, error } = await this.sb
            .from('whatsapp_company_channels')
            .insert({ ...payload, created_at: now })
            .select('*')
            .single();
        if (error) {
            console.error('[Repository] upsertOfficialCloudApiChannel insert error:', error.message);
            throw new Error(`Official Cloud API channel oluşturulamadı: ${error.message}`);
        }
        console.log(`[Repository] OFFICIAL_CLOUD_API kanalı oluşturuldu: ${params.companyId}`);
        return data;
    }
    /** Kanal durumunu güncelle */
    async updateChannelStatus(companyId, channelType, updates) {
        try {
            const payload = { updated_at: new Date().toISOString() };
            if (updates.status !== undefined)
                payload.status = updates.status;
            if (updates.lastConnectedAt !== undefined)
                payload.last_connected_at = updates.lastConnectedAt;
            if (updates.lastError !== undefined)
                payload.last_error = updates.lastError;
            if (updates.senderPhone !== undefined)
                payload.sender_phone = updates.senderPhone;
            await this.sb
                .from('whatsapp_company_channels')
                .update(payload)
                .eq('company_id', companyId)
                .eq('channel_type', channelType);
        }
        catch (err) {
            console.error('[Repository] updateChannelStatus error:', err.message);
        }
    }
    /** Varsayılan kanalı değiştir */
    async setDefaultChannel(companyId, channelType) {
        try {
            // Önce tüm kanalların is_default'unu false yap
            await this.sb
                .from('whatsapp_company_channels')
                .update({ is_default: false, updated_at: new Date().toISOString() })
                .eq('company_id', companyId);
            // Hedef kanalı varsayılan yap
            await this.sb
                .from('whatsapp_company_channels')
                .update({ is_default: true, is_active: true, updated_at: new Date().toISOString() })
                .eq('company_id', companyId)
                .eq('channel_type', channelType);
        }
        catch (err) {
            console.error('[Repository] setDefaultChannel error:', err.message);
        }
    }
}
exports.WhatsAppRepository = WhatsAppRepository;
/** Singleton repository instance */
exports.whatsAppRepository = new WhatsAppRepository();
//# sourceMappingURL=whatsapp.repository.js.map