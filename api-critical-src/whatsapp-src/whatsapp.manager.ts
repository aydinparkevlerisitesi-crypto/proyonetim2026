/**
 * WhatsApp Manager — Tüm WhatsApp Client'larını yöneten orkestratör.
 *
 * Map<siteId, WhatsAppClient> yapısı ile her siteye özel izole client yönetimi.
 * Memory leak koruması, toplu işlemler, sağlık kontrolü.
 * SOLID: Single Responsibility — sadece client havuzunu yönetir.
 */

import { EvolutionClient, type WsBroadcastFn } from './evolution.client';
import type {
  ClientConfig,
  SessionHealth,
  SessionInfo,
  FullHealthReport,
  WsEventPayload,
} from './whatsapp.types';
import { whatsAppRepository } from './whatsapp.repository';
import { getCompanyInstanceName } from './whatsapp.helpers';

// ─── Default konfigürasyon ──────────────────────
const DEFAULT_MAX_SESSIONS = 500;

export class WhatsAppManager {
  private clients: Map<string, EvolutionClient> = new Map();
  private broadcastFn: WsBroadcastFn | null = null;
  private maxSessions: number;
  private startTime: number;

  constructor(maxSessions: number = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
    this.startTime = Date.now();
  }

  // ═════════════════════════════════════════════════
  //  Public API
  // ═════════════════════════════════════════════════

  /** WebSocket yayın fonksiyonunu tüm mevcut ve gelecek client'lara bağla */
  setBroadcast(fn: WsBroadcastFn): void {
    this.broadcastFn = fn;
    // Mevcut tüm client'lara broadcast'i bağla
    for (const client of this.clients.values()) {
      client.setBroadcast(fn);
    }
  }

  /** Yeni bir WhatsApp client oluştur (veya mevcut olanı döndür).
   *  Multi-tenant: companyId varsa getCompanyInstanceName ile deterministik isim üretir. */
  async createClient(config: Omit<ClientConfig, 'sessionPath'> & { sessionPath?: string }): Promise<EvolutionClient> {
    const siteId = config.siteId;

    // Kapasite kontrolü
    if (this.clients.size >= this.maxSessions && !this.clients.has(siteId)) {
      throw new Error(`Maksimum oturum sayısına ulaşıldı (${this.maxSessions}).`);
    }

    // Zaten varsa mevcut client'ı döndür
    const existing = this.clients.get(siteId);
    // ═══ KRİTİK FİX: Yeni client oluşturulurken instanceName çakışması varsa
    // eski client'ı temizle ve yeni instanceName ile oluştur.
    // Bu, sendEvolutionTextMessage'ın getActiveWhatsAppContext ile
    // bulduğu instanceName'in manager'da da kullanılmasını garantiler.
    if (existing) {
      const requestedInstanceName = config.instanceName
        || (config.companyId ? getCompanyInstanceName(config.companyId) : undefined)
        || config.siteId;
      if (existing.instanceName !== requestedInstanceName) {
        console.log(`[WhatsAppManager] InstanceName çakışması: mevcut=${existing.instanceName}, istenen=${requestedInstanceName} → eski client kapatılıp yenisi oluşturuluyor`);
        try { await existing.disconnect(); } catch {}
        try { await existing.destroy(); } catch {}
        this.clients.delete(siteId);
      } else {
        return existing;
      }
    }

    // Multi-tenant: explicit instanceName > companyId deterministik > siteId
    const effectiveInstanceName = config.instanceName
      || (config.companyId ? getCompanyInstanceName(config.companyId) : undefined)
      || config.siteId;

    const client = new EvolutionClient({
      siteId: config.siteId,
      companyId: config.companyId,
      sessionPath: '',
      phoneNumber: config.phoneNumber,
      instanceName: effectiveInstanceName,
    });

    if (this.broadcastFn) {
      client.setBroadcast(this.broadcastFn);
    }

    this.clients.set(siteId, client);
    console.log(`[WhatsAppManager] Evolution client oluşturuldu: ${siteId}, instanceName=${effectiveInstanceName}, toplam: ${this.clients.size}`);

    return client;
  }

  /** Belirli bir client'ı getir */
  getClient(siteId: string): EvolutionClient | undefined {
    return this.clients.get(siteId);
  }

  /** Belirli bir client'ı kaldır ve temizle */
  async removeClient(siteId: string): Promise<boolean> {
    const client = this.clients.get(siteId);
    if (!client) return false;

    await client.disconnect();
    await client.destroy();
    this.clients.delete(siteId);

    console.log(`[WhatsAppManager] Client kaldırıldı: ${siteId}, kalan: ${this.clients.size}`);
    return true;
  }

  /** Belirli bir client'ı yeniden bağlat */
  async reconnect(siteId: string): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    const client = this.clients.get(siteId);
    if (!client) {
      return { success: false, error: `Site ${siteId} için client bulunamadı.` };
    }
    return client.reconnect();
  }

  /** Belirli bir client'ın bağlantısını kes (ama client'ı bellekte tut) */
  async disconnect(siteId: string): Promise<boolean> {
    const client = this.clients.get(siteId);
    if (!client) return false;

    await client.disconnect();
    return true;
  }

  /** Tüm client'ları listele */
  getAllClients(): Array<{ siteId: string; status: string; phoneNumber: string | null }> {
    return Array.from(this.clients.entries()).map(([siteId, client]) => ({
      siteId,
      status: client.getStatus(),
      phoneNumber: client.getPhoneNumber(),
    }));
  }

  /** Belirli bir site için session bilgisini getir */
  getSessionInfo(siteId: string): SessionInfo | null {
    const client = this.clients.get(siteId);
    return client ? client.getSessionInfo() : null;
  }

  /** Tüm session bilgilerini getir */
  getAllSessionInfos(): SessionInfo[] {
    return Array.from(this.clients.values()).map((c) => c.getSessionInfo());
  }

  /** Client var mı? */
  has(siteId: string): boolean {
    return this.clients.has(siteId);
  }

  /** Toplam aktif client sayısı */
  get size(): number {
    return this.clients.size;
  }

  /** Bağlı (CONNECTED) client sayısı */
  get connectedCount(): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.isConnected()) count++;
    }
    return count;
  }

  /** Tüm client'ları temizle (graceful shutdown için) */
  async destroyAll(): Promise<void> {
    console.log(`[WhatsAppManager] Tüm client'lar kapatılıyor... (${this.clients.size} adet)`);
    const ids = Array.from(this.clients.keys());
    for (const id of ids) {
      await this.removeClient(id);
    }
    console.log('[WhatsAppManager] Tüm client\'lar kapatıldı.');
  }

  /** Kopmuş client'ları bul (scheduler için).
   *  ⛔ WAITING_QR/QR_READY durumundaki client'lar kopmuş sayılmaz.
   *  Multi-tenant: Manager'da yoksa DB'deki disconnected instance'ları da döndürür. */
  getDisconnectedClients(): Array<{ siteId: string; companyId?: string }> {
    const disconnected: Array<{ siteId: string; companyId?: string }> = [];
    for (const [siteId, client] of this.clients) {
      const status = client.getStatus();
      // SADECE gerçekten kopmuş veya hatalı olanları döndür
      // WAITING_QR, LOADING, CONNECTED, QR_READY olanlara dokunma!
      if (status === 'DISCONNECTED' || status === 'ERROR') {
        disconnected.push({ siteId, companyId: client.companyId });
      }
      if (status === 'WAITING_QR' || status === 'QR_READY') {
        console.log(`[WhatsAppManager] ${siteId}: ${status} durumunda — scheduler atlanıyor (QR akışı korunuyor)`);
      }
    }
    return disconnected;
  }

  /** DB'den aktif oturumları yükle ve bağlan */
  async restoreSessions(): Promise<number> {
    try {
      const activeSessions = await whatsAppRepository.findActiveSessions();
      let restored = 0;

      for (const session of activeSessions) {
        const siteId = session.site_id || session.company_id;
        if (!siteId || this.clients.has(siteId)) continue;

        const client = await this.createClient({
          siteId,
          companyId: session.company_id,
          phoneNumber: session.phone_number || undefined,
        });

        if (this.broadcastFn) {
          client.setBroadcast(this.broadcastFn);
        }

        restored++;
        console.log(`[WhatsAppManager] Oturum geri yüklendi: ${siteId} (status: ${session.status})`);
      }

      return restored;
    } catch (err) {
      console.error('[WhatsAppManager] restoreSessions error:', (err as Error).message);
      return 0;
    }
  }

  /** Tam sağlık raporu */
  async getHealthReport(): Promise<FullHealthReport> {
    const sessions: SessionHealth[] = [];
    let hasActiveConnection = false;

    for (const client of this.clients.values()) {
      const info = client.getSessionInfo();
      const uptime = info.connectedAt
        ? Math.floor((Date.now() - new Date(info.connectedAt).getTime()) / 1000)
        : 0;

      sessions.push({
        siteId: info.siteId,
        companyId: info.companyId,
        status: info.status,
        uptime,
        phoneNumber: info.phoneNumber,
        profileName: info.profileName,
        battery: info.battery,
        lastSeen: info.lastSeen,
        hasQr: !!info.qrCode,
        lastActivity: info.lastActivity,
      });

      if (info.status === 'CONNECTED' || info.status === 'WAITING_QR') {
        hasActiveConnection = true;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      service: 'proyonetim-whatsapp-gateway',
      provider: 'evolution-api',
      baileys_connected: hasActiveConnection,
      sessions,
      totalSessions: sessions.length,
      bridge: 'radore-api',
      version: '4.0.0-enterprise',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}

/** Singleton manager instance */
export const whatsAppManager = new WhatsAppManager();