import { createServerSupabaseClient, type SupabaseClient } from '../../lib/supabase';
import { config } from '../../config';
import { getCompanyInstanceName } from './whatsapp.helpers';
import type {
  CompanyWhatsAppRecord,
  MessageQueueRecord,
  WhatsAppMessageRecord,
  WhatsAppChannel,
  CreateChannelParams,
  UpdateChannelParams,
  ChannelType,
} from './whatsapp.types';

// ─── Singleton Supabase Admin Client ──────────────
let supabaseAdmin: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    supabaseAdmin = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return supabaseAdmin;
}

// ─── Company Instance Record ─────────────────────
export interface CompanyInstanceRecord {
  id: string;
  company_id: string;
  site_id: string | null;
  instance_name: string;
  phone_number: string | null;
  connection_status: string;
  qr_status: string | null;
  last_qr_at: string | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════
//  Company / Site WhatsApp Session Repository
// ═══════════════════════════════════════════════════

export class WhatsAppRepository {
  private get sb(): SupabaseClient {
    return getAdmin();
  }

  // ─── Company Instance CRUD (YENİ — Multi-Tenant) ──

  /**
   * Firma için instance kaydını bul veya oluştur.
   * Her firma için SADECE 1 instance olur.
   * instanceName = getCompanyInstanceName(companyId) (deterministik)
   */
  async findOrCreateCompanyInstance(params: {
    companyId: string;
    siteId?: string;
    createdBy?: string;
  }): Promise<CompanyInstanceRecord> {
    const instanceName = getCompanyInstanceName(params.companyId);

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
      return existing as CompanyInstanceRecord;
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
      if (retry) return retry as CompanyInstanceRecord;
      throw new Error(`Company instance oluşturulamadı: ${insertError.message}`);
    }

    console.log(`[Repository] Yeni company instance oluşturuldu: ${instanceName} (company: ${params.companyId})`);
    return created as CompanyInstanceRecord;
  }

  /** Belirli bir firmanın instance kaydını getir */
  async getCompanyInstance(companyId: string): Promise<CompanyInstanceRecord | null> {
    const { data, error } = await this.sb
      .from('whatsapp_company_instances')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      console.error('[Repository] getCompanyInstance error:', error.message);
      return null;
    }
    return data as CompanyInstanceRecord | null;
  }

  /** Instance adına göre kayıt getir */
  async getCompanyInstanceByName(instanceName: string): Promise<CompanyInstanceRecord | null> {
    const { data, error } = await this.sb
      .from('whatsapp_company_instances')
      .select('*')
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (error) {
      console.error('[Repository] getCompanyInstanceByName error:', error.message);
      return null;
    }
    return data as CompanyInstanceRecord | null;
  }

  /** Tüm firma instance'larını getir */
  async getAllCompanyInstances(): Promise<CompanyInstanceRecord[]> {
    const { data, error } = await this.sb
      .from('whatsapp_company_instances')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Repository] getAllCompanyInstances error:', error.message);
      return [];
    }
    return (data || []) as CompanyInstanceRecord[];
  }

  /** Scheduler için: sadece reconnect edilmesi gereken instance'ları getir */
  async getDisconnectedCompanyInstances(): Promise<CompanyInstanceRecord[]> {
    const { data, error } = await this.sb
      .from('whatsapp_company_instances')
      .select('*')
      .in('connection_status', ['DISCONNECTED', 'ERROR'])
      .order('updated_at', { ascending: true });

    if (error) {
      console.error('[Repository] getDisconnectedCompanyInstances error:', error.message);
      return [];
    }
    return (data || []) as CompanyInstanceRecord[];
  }

  /** Instance durumunu güncelle */
  async updateCompanyInstanceStatus(
    companyId: string,
    updates: {
      connectionStatus?: string;
      qrStatus?: string | null;
      phoneNumber?: string | null;
      profileName?: string | null;
      lastQrAt?: string | null;
      lastConnectedAt?: string | null;
      lastDisconnectedAt?: string | null;
      lastError?: string | null;
      lastErrorType?: string | null;
      siteId?: string | null;
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.connectionStatus !== undefined) payload.connection_status = updates.connectionStatus;
    if (updates.qrStatus !== undefined) payload.qr_status = updates.qrStatus;
    if (updates.phoneNumber !== undefined) payload.phone_number = updates.phoneNumber;
    if (updates.profileName !== undefined) payload.profile_name = updates.profileName;
    if (updates.lastQrAt !== undefined) payload.last_qr_at = updates.lastQrAt;
    if (updates.lastConnectedAt !== undefined) payload.last_connected_at = updates.lastConnectedAt;
    if (updates.lastDisconnectedAt !== undefined) payload.last_disconnected_at = updates.lastDisconnectedAt;
    if (updates.lastError !== undefined) payload.last_error = updates.lastError;
    if (updates.lastErrorType !== undefined) payload.last_error_type = updates.lastErrorType;
    if (updates.siteId !== undefined) payload.site_id = updates.siteId;

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
  async findSession(siteId: string, companyId?: string): Promise<CompanyWhatsAppRecord | null> {
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
    } catch (err) {
      console.error('[Repository] findSession error:', (err as Error).message);
      return null;
    }
  }

  /** Tüm oturumları getir */
  async findAllSessions(): Promise<CompanyWhatsAppRecord[]> {
    try {
      const { data } = await this.sb
        .from('whatsapp_sessions')
        .select('*')
        .order('updated_at', { ascending: false });

      return data || [];
    } catch (err) {
      console.error('[Repository] findAllSessions error:', (err as Error).message);
      return [];
    }
  }

  /** Aktif bağlantısı olan oturumları getir */
  async findActiveSessions(): Promise<CompanyWhatsAppRecord[]> {
    try {
      const { data } = await this.sb
        .from('whatsapp_sessions')
        .select('*')
        .in('status', ['CONNECTED', 'RECONNECTING', 'WAITING_QR']);

      return data || [];
    } catch (err) {
      console.error('[Repository] findActiveSessions error:', (err as Error).message);
      return [];
    }
  }

  /** Oturum oluştur veya güncelle (upsert) */
  async upsertSession(params: {
    siteId: string;
    companyId?: string;
    status?: string;
    phoneNumber?: string | null;
    sessionPath?: string | null;
    qrCode?: string | null;
    connectedAt?: string | null;
    error?: string | null;
    profileName?: string | null;
    battery?: number | null;
    lastSeen?: string | null;
    instanceName?: string | null;
  }): Promise<boolean> {
    try {
      const sessionId = `site-${params.siteId}`;
      const existing = await this.findSession(params.siteId, params.companyId);
      const now = new Date().toISOString();

      const payload: Record<string, unknown> = {
        updated_at: now,
        last_activity: now,
      };

      if (params.status !== undefined) payload.status = params.status;
      if (params.phoneNumber !== undefined) payload.phone_number = params.phoneNumber;
      if (params.sessionPath !== undefined) {
        payload.provider_config = { session_path: params.sessionPath };
      }
      if (params.qrCode !== undefined) payload.qr_code = params.qrCode;
      if (params.connectedAt !== undefined) payload.connected_at = params.connectedAt;
      if (params.error !== undefined) payload.error = params.error;
      if (params.profileName !== undefined) payload.device_name = params.profileName;
      if (params.instanceName !== undefined) payload.instance_name = params.instanceName;
      if (params.battery !== undefined) payload.provider_config = { ...((payload.provider_config as Record<string, unknown>) || {}), battery: params.battery };
      if (params.lastSeen !== undefined) payload.last_activity = params.lastSeen;

      if (existing) {
        await this.sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
      } else {
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
    } catch (err) {
      console.error('[Repository] upsertSession error:', (err as Error).message);
      return false;
    }
  }

  /** Oturum durumunu güncelle */
  async updateSessionStatus(
    siteId: string,
    companyId: string | undefined,
    status: string,
    extras?: { error?: string | null; phoneNumber?: string | null; qrCode?: string | null; connectedAt?: string | null },
  ): Promise<void> {
    try {
      const existing = await this.findSession(siteId, companyId);
      if (!existing) return;

      const payload: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (extras?.error !== undefined) payload.error = extras.error;
      if (extras?.phoneNumber !== undefined) payload.phone_number = extras.phoneNumber;
      if (extras?.qrCode !== undefined) payload.qr_code = extras.qrCode;
      if (extras?.connectedAt !== undefined) payload.connected_at = extras.connectedAt;

      await this.sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
    } catch (err) {
      console.error('[Repository] updateSessionStatus error:', (err as Error).message);
    }
  }

  // ─── Message Queue CRUD ─────────────────────

  /** Kuyruğa mesaj ekle */
  async enqueueMessage(params: {
    siteId: string;
    companyId?: string;
    phone: string;
    message: string;
    priority?: number;
    maxRetries?: number;
  }): Promise<{ id: string } | null> {
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
    } catch (err) {
      console.error('[Repository] enqueueMessage error:', (err as Error).message);
      return null;
    }
  }

  /** Toplu mesajları kuyruğa ekle */
  async enqueueBulkMessages(
    siteId: string,
    companyId: string | undefined,
    recipients: Array<{ phone: string; message: string; priority?: number }>,
    maxRetries?: number,
  ): Promise<{ queued: number; failed: number; queueIds: string[] }> {
    let queued = 0;
    let failed = 0;
    const queueIds: string[] = [];

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
      } else if (data) {
        queued = data.length;
        failed = recipients.length - data.length;
        data.forEach((d) => queueIds.push(d.id));
      }
    } catch (err) {
      failed = recipients.length;
      console.error('[Repository] enqueueBulkMessages error:', (err as Error).message);
    }

    return { queued, failed, queueIds };
  }

  /** Bekleyen mesajları getir (belirli bir site için) */
  async getPendingMessages(siteId: string, limit: number = 50): Promise<MessageQueueRecord[]> {
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
    } catch (err) {
      console.error('[Repository] getPendingMessages error:', (err as Error).message);
      return [];
    }
  }

  /** Takılı kalmış mesajları getir (sending status) */
  async getStuckMessages(siteId: string): Promise<MessageQueueRecord[]> {
    try {
      const { data } = await this.sb
        .from('message_queue')
        .select('*')
        .eq('site_id', siteId)
        .eq('status', 'sending')
        .order('created_at', { ascending: true })
        .limit(100);

      return data || [];
    } catch (err) {
      console.error('[Repository] getStuckMessages error:', (err as Error).message);
      return [];
    }
  }

  /** Mesaj kuyruk durumunu güncelle */
  async updateQueueStatus(
    queueId: string,
    status: 'pending' | 'sending' | 'sent' | 'failed',
    error?: string | null,
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = { status };
      if (status === 'sent' || status === 'failed') {
        payload.sent_at = new Date().toISOString();
      }
      if (error) payload.error = error;
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
    } catch (err) {
      console.error('[Repository] updateQueueStatus error:', (err as Error).message);
    }
  }

  /** Kuyruk istatistiklerini getir */
  async getQueueStats(siteId: string): Promise<{
    pending: number;
    sending: number;
    sentToday: number;
    failed: number;
  }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [{ count: pending }, { count: sending }, { count: sentToday }, { count: failed }] =
        await Promise.all([
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
    } catch (err) {
      console.error('[Repository] getQueueStats error:', (err as Error).message);
      return { pending: 0, sending: 0, sentToday: 0, failed: 0 };
    }
  }

  /** Basit ping — bağlantı testi */
  async ping(): Promise<boolean> {
    try {
      const { error } = await this.sb.from('whatsapp_sessions').select('id', { count: 'exact', head: true });
      return !error;
    } catch {
      return false;
    }
  }

  /** whatsapp_message_logs tablosunda provider_message_id ile eşleşen kaydın status'ünü güncelle */
  async updateMessageLogStatus(providerMessageId: string, status: string): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        delivery_status: status,
      };
      await this.sb
        .from('whatsapp_message_logs')
        .update(payload)
        .eq('whatsapp_message_id', providerMessageId);
    } catch (err) {
      // whatsapp_message_logs tablosu yoksa veya kayıt bulunamazsa sessizce atla
      console.warn('[Repository] updateMessageLogStatus error (non-critical):', (err as Error).message);
    }
  }

  // ─── Message Log ────────────────────────────

  /** Gelen mesajı log'a yaz */
  async logIncomingMessage(params: {
    siteId: string;
    companyId?: string;
    fromPhone: string;
    body: string;
    messageId?: string;
    messageType?: string;
  }): Promise<void> {
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
    } catch (err) {
      console.error('[Repository] logIncomingMessage error:', (err as Error).message);
    }
  }

  /** Giden mesajı log'a yaz */
  async logOutgoingMessage(params: {
    siteId: string;
    companyId?: string;
    toPhone: string;
    body: string;
    messageId?: string;
    messageType?: string;
  }): Promise<void> {
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
    } catch (err) {
      console.error('[Repository] logOutgoingMessage error:', (err as Error).message);
    }
  }

  // ─── KANAL CRUD (HİBRİT MİMARİ) ─────────────────────

  /** Firma için varsayılan kanalı getir */
  async getDefaultChannel(companyId: string): Promise<WhatsAppChannel | null> {
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
            .eq('id', (firstActive as WhatsAppChannel).id);
          return firstActive as WhatsAppChannel;
        }

        return null;
      }

      return data as WhatsAppChannel;
    } catch (err) {
      console.error('[Repository] getDefaultChannel error:', (err as Error).message);
      return null;
    }
  }

  /** Firma için tüm aktif kanalları getir */
  async getCompanyChannels(companyId: string): Promise<WhatsAppChannel[]> {
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
      return (data || []) as WhatsAppChannel[];
    } catch (err) {
      console.error('[Repository] getCompanyChannels error:', (err as Error).message);
      return [];
    }
  }

  /** Belirli bir kanalı ID ile getir */
  async getChannelById(channelId: string): Promise<WhatsAppChannel | null> {
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
      return data as WhatsAppChannel | null;
    } catch (err) {
      console.error('[Repository] getChannelById error:', (err as Error).message);
      return null;
    }
  }

  /** Belirli bir türdeki kanalı getir (firma + channel_type) */
  async getChannelByType(companyId: string, channelType: ChannelType): Promise<WhatsAppChannel | null> {
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
      return data as WhatsAppChannel | null;
    } catch (err) {
      console.error('[Repository] getChannelByType error:', (err as Error).message);
      return null;
    }
  }

  /** CONNECTED_DEVICE kanalını bul/oluştur (Evolution QR bağlantısı için) */
  async findOrCreateConnectedDeviceChannel(params: {
    companyId: string;
    instanceName?: string;
    senderPhone?: string;
  }): Promise<WhatsAppChannel> {
    const existing = await this.getChannelByType(params.companyId, 'CONNECTED_DEVICE');

    if (existing) {
      // Güncelle
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
        instance_name: params.instanceName || getCompanyInstanceName(params.companyId),
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
    return created as WhatsAppChannel;
  }

  /** OFFICIAL_CLOUD_API kanalını oluştur/güncelle */
  async upsertOfficialCloudApiChannel(params: {
    companyId: string;
    wabaId: string;
    phoneNumberId: string;
    accessTokenEncrypted: string;
    webhookVerifyTokenEncrypted?: string;
    displayName?: string;
  }): Promise<WhatsAppChannel> {
    const existing = await this.getChannelByType(params.companyId, 'OFFICIAL_CLOUD_API');
    const now = new Date().toISOString();

    const payload = {
      company_id: params.companyId,
      channel_type: 'OFFICIAL_CLOUD_API' as const,
      is_active: true,
      waba_id: params.wabaId,
      phone_number_id: params.phoneNumberId,
      access_token_encrypted: params.accessTokenEncrypted,
      webhook_verify_token_encrypted: params.webhookVerifyTokenEncrypted || null,
      display_name: params.displayName || 'Resmi WhatsApp Business API',
      provider: 'meta_cloud' as const,
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
      return data as WhatsAppChannel;
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
    return data as WhatsAppChannel;
  }

  /** Kanal durumunu güncelle */
  async updateChannelStatus(
    companyId: string,
    channelType: ChannelType,
    updates: {
      status?: string;
      lastConnectedAt?: string;
      lastError?: string;
      senderPhone?: string;
    },
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.lastConnectedAt !== undefined) payload.last_connected_at = updates.lastConnectedAt;
      if (updates.lastError !== undefined) payload.last_error = updates.lastError;
      if (updates.senderPhone !== undefined) payload.sender_phone = updates.senderPhone;

      await this.sb
        .from('whatsapp_company_channels')
        .update(payload)
        .eq('company_id', companyId)
        .eq('channel_type', channelType);
    } catch (err) {
      console.error('[Repository] updateChannelStatus error:', (err as Error).message);
    }
  }

  /** Varsayılan kanalı değiştir */
  async setDefaultChannel(companyId: string, channelType: ChannelType): Promise<void> {
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
    } catch (err) {
      console.error('[Repository] setDefaultChannel error:', (err as Error).message);
    }
  }
}

/** Singleton repository instance */
export const whatsAppRepository = new WhatsAppRepository();