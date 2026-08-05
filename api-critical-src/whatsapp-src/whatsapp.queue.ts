/**
 * WhatsApp Message Queue — Rate limit'li toplu mesaj kuyruğu.
 *
 * Bellek içi kuyruk + Supabase persistansı.
 * Site başına rate limit, öncelik sıralaması, otomatik retry.
 * Aynı anda yüzlerce mesajı güvenle işler.
 * SOLID: Single Responsibility — sadece kuyruk yönetimi.
 */

import type { QueueItem, QueueStats, RateLimitConfig } from './whatsapp.types';
import { whatsAppRepository } from './whatsapp.repository';
import { whatsAppManager } from './whatsapp.manager';

// ─── Varsayılan rate limit ───────────────────────
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxMessagesPerMinute: 15,
  maxMessagesPerHour: 200,
  maxBulkPerRequest: 100,
  cooldownMs: 4000, // 2 mesaj arası minimum 4 saniye
};

// ─── Kuyruk durumu ──────────────────────────────
interface SiteQueue {
  items: QueueItem[];
  sentLastMinute: number;
  sentLastHour: number;
  lastSentAt: number;
  processing: boolean;
  timer: NodeJS.Timeout | null;
}

export class MessageQueue {
  private queues: Map<string, SiteQueue> = new Map();
  private rateLimit: RateLimitConfig;
  private totalSent: number = 0;
  private totalFailed: number = 0;

  constructor(rateLimit: Partial<RateLimitConfig> = {}) {
    this.rateLimit = { ...DEFAULT_RATE_LIMIT, ...rateLimit };
  }

  // ═════════════════════════════════════════════════
  //  Public API
  // ═════════════════════════════════════════════════

  /** Kuyruğa tek mesaj ekle */
  async enqueue(item: {
    siteId: string;
    companyId?: string;
    phone: string;
    message: string;
    priority?: number;
    maxRetries?: number;
  }): Promise<{ success: boolean; queueId?: string; error?: string }> {
    // DB'ye kaydet
    const result = await whatsAppRepository.enqueueMessage({
      siteId: item.siteId,
      companyId: item.companyId,
      phone: item.phone,
      message: item.message,
      priority: item.priority || 0,
      maxRetries: item.maxRetries || 3,
    });

    if (!result) {
      return { success: false, error: 'Kuyruğa eklenemedi.' };
    }

    // Bellek içi kuyruğa ekle
    const queueItem: QueueItem = {
      id: result.id,
      siteId: item.siteId,
      companyId: item.companyId,
      phone: item.phone,
      message: item.message,
      status: 'pending',
      retryCount: 0,
      maxRetries: item.maxRetries || 3,
      createdAt: Date.now(),
      priority: item.priority || 0,
    };

    this.getOrCreateQueue(item.siteId).items.push(queueItem);
    this.sortQueue(item.siteId);

    // Kuyruk işlemeyi başlat (eğer çalışmıyorsa)
    this.tick(item.siteId);

    return { success: true, queueId: result.id };
  }

  /** Toplu mesaj ekle */
  async enqueueBulk(
    siteId: string,
    companyId: string | undefined,
    recipients: Array<{ phone: string; message: string; priority?: number }>,
    maxRetries?: number,
  ): Promise<{ success: boolean; queued: number; failed: number; queueIds: string[] }> {
    if (recipients.length > this.rateLimit.maxBulkPerRequest) {
      return {
        success: false,
        queued: 0,
        failed: recipients.length,
        queueIds: [],
      };
    }

    // DB'ye toplu ekle
    const result = await whatsAppRepository.enqueueBulkMessages(
      siteId,
      companyId,
      recipients,
      maxRetries,
    );

    // Bellek içi kuyruğa ekle
    const siteQueue = this.getOrCreateQueue(siteId);
    for (let i = 0; i < result.queueIds.length; i++) {
      const recipient = recipients[i];
      if (!recipient) continue;

      siteQueue.items.push({
        id: result.queueIds[i],
        siteId,
        companyId,
        phone: recipient.phone,
        message: recipient.message,
        status: 'pending',
        retryCount: 0,
        maxRetries: maxRetries || 3,
        createdAt: Date.now(),
        priority: recipient.priority || 0,
      });
    }

    this.sortQueue(siteId);
    this.tick(siteId);

    return {
      success: result.failed === 0,
      queued: result.queued,
      failed: result.failed,
      queueIds: result.queueIds,
    };
  }

  /** Kuyruk istatistiklerini getir */
  getStats(siteId: string): QueueStats {
    const siteQueue = this.queues.get(siteId);
    const pending = siteQueue?.items.filter((i) => i.status === 'pending').length || 0;
    const sending = siteQueue?.items.filter((i) => i.status === 'sending').length || 0;
    return {
      siteId,
      pending,
      sending,
      sentToday: siteQueue?.sentLastHour || 0,
      failed: siteQueue?.items.filter((i) => i.status === 'failed').length || 0,
    };
  }

  /** Toplam gönderilen/failed */
  getTotalStats(): { totalSent: number; totalFailed: number; queueCount: number } {
    let queueCount = 0;
    this.queues.forEach((q) => {
      queueCount += q.items.filter((i) => i.status === 'pending' || i.status === 'sending').length;
    });
    return {
      totalSent: this.totalSent,
      totalFailed: this.totalFailed,
      queueCount,
    };
  }

  /** Tüm kuyrukları temizle */
  async clearAll(): Promise<void> {
    this.queues.forEach((q) => {
      if (q.timer) clearTimeout(q.timer);
    });
    this.queues.clear();
  }

  /** Takılı kalmış mesajları temizle (sending → pending) */
  async flushStuckMessages(siteId: string): Promise<number> {
    const siteQueue = this.queues.get(siteId);
    if (siteQueue) {
      let stuck = 0;
      siteQueue.items.forEach((item) => {
        if (item.status === 'sending') {
          item.status = 'pending';
          stuck++;
        }
      });
      if (stuck > 0) {
        this.tick(siteId);
      }
    }

    // DB'de de sending kalmış kayıtları pending yap
    try {
      const stuckDb = await whatsAppRepository.getStuckMessages(siteId);
      if (stuckDb.length > 0) {
        for (const msg of stuckDb) {
          await whatsAppRepository.updateQueueStatus(msg.id, 'pending', 'Self-healing: stuck message flushed');
        }
      }
      return stuckDb.length;
    } catch {
      return 0;
    }
  }

  // ═════════════════════════════════════════════════
  //  Private: Kuyruk İşleme Motoru
  // ═════════════════════════════════════════════════

  private getOrCreateQueue(siteId: string): SiteQueue {
    if (!this.queues.has(siteId)) {
      this.queues.set(siteId, {
        items: [],
        sentLastMinute: 0,
        sentLastHour: 0,
        lastSentAt: 0,
        processing: false,
        timer: null,
      });
    }
    return this.queues.get(siteId)!;
  }

  private sortQueue(siteId: string): void {
    const siteQueue = this.queues.get(siteId);
    if (!siteQueue) return;

    siteQueue.items.sort((a, b) => {
      // priority yüksek olan önce
      if (b.priority !== a.priority) return b.priority - a.priority;
      // aynı priority'de eski olan önce
      return a.createdAt - b.createdAt;
    });
  }

  private tick(siteId: string): void {
    const siteQueue = this.queues.get(siteId);
    if (!siteQueue || siteQueue.processing) return;

    this.processNext(siteId);
  }

  private async processNext(siteId: string): Promise<void> {
    const siteQueue = this.queues.get(siteId);
    if (!siteQueue) return;

    // Rate limit kontrolü
    const now = Date.now();

    // Dakikalık limit
    if (siteQueue.sentLastMinute >= this.rateLimit.maxMessagesPerMinute) {
      this.scheduleNext(siteId, 1000);
      return;
    }

    // Cooldown
    if (now - siteQueue.lastSentAt < this.rateLimit.cooldownMs) {
      this.scheduleNext(siteId, this.rateLimit.cooldownMs - (now - siteQueue.lastSentAt));
      return;
    }

    // Gönderilecek mesaj bul
    const pending = siteQueue.items.filter((i) => i.status === 'pending');
    if (pending.length === 0) {
      siteQueue.processing = false;
      return;
    }

    siteQueue.processing = true;
    const item = pending[0];
    item.status = 'sending';

    // WhatsApp client'ı bul
    const client = whatsAppManager.getClient(siteId);
    if (!client || !client.isConnected()) {
      console.warn(`[MessageQueue] ${siteId}: Client bağlı değil, mesajlar kuyrukta bekleyecek.`);
      item.status = 'pending';
      siteQueue.processing = false;
      this.scheduleNext(siteId, 5000); // 5 saniye sonra tekrar dene
      return;
    }

    // Mesajı gönder
    try {
      const result = await client.sendMessage(item.phone, item.message);

      siteQueue.lastSentAt = Date.now();
      siteQueue.sentLastMinute++;

      if (result.success) {
        item.status = 'sent';
        this.totalSent++;
        await whatsAppRepository.updateQueueStatus(item.id, 'sent');

        // Başarılı gönderimleri kuyruktan temizle
        siteQueue.items = siteQueue.items.filter((i) => i.status !== 'sent');
      } else {
        item.retryCount++;
        if (item.retryCount >= item.maxRetries) {
          item.status = 'failed';
          this.totalFailed++;
          await whatsAppRepository.updateQueueStatus(item.id, 'failed', result.error);
          siteQueue.items = siteQueue.items.filter((i) => i.status !== 'failed');
        } else {
          item.status = 'pending';
          await whatsAppRepository.updateQueueStatus(item.id, 'pending', result.error);
        }
      }
    } catch (err) {
      item.retryCount++;
      if (item.retryCount >= item.maxRetries) {
        item.status = 'failed';
        this.totalFailed++;
        await whatsAppRepository.updateQueueStatus(item.id, 'failed', (err as Error).message);
        siteQueue.items = siteQueue.items.filter((i) => i.status !== 'failed');
      } else {
        item.status = 'pending';
        await whatsAppRepository.updateQueueStatus(item.id, 'pending', (err as Error).message);
      }
    }

    siteQueue.processing = false;

    // Sonraki mesaja geç
    const remaining = siteQueue.items.filter((i) => i.status === 'pending').length;
    if (remaining > 0) {
      this.scheduleNext(siteId, this.rateLimit.cooldownMs);
    }
  }

  private scheduleNext(siteId: string, delayMs: number): void {
    const siteQueue = this.queues.get(siteId);
    if (!siteQueue) return;

    if (siteQueue.timer) clearTimeout(siteQueue.timer);

    siteQueue.timer = setTimeout(() => {
      siteQueue.processing = false;
      this.processNext(siteId);
    }, delayMs);
  }

  /** Dakikalık sayacı sıfırla (her dakika çağrılır) */
  resetMinuteCounters(): void {
    this.queues.forEach((q) => {
      q.sentLastMinute = 0;
    });
  }
}

/** Singleton queue instance */
export const messageQueue = new MessageQueue();

// Dakikalık sayaçları sıfırlayan zamanlayıcı
setInterval(() => {
  messageQueue.resetMinuteCounters();
}, 60_000);