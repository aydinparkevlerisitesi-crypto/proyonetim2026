/**
 * WhatsApp Scheduler — Multi-Tenant: Tüm firmaların kopuk bağlantılarını otomatik reconnect
 * + Queue Worker: PENDING mesajları Evolution API üzerinden gerçekten gönderir.
 *
 * Periyodik olarak whatsapp_company_instances tablosundaki tüm firmaları kontrol eder.
 * DISCONNECTED veya ERROR durumundaki instance'ları otomatik reconnect eder.
 * QR_READY, WAITING_QR, CONNECTING, CONNECTED olanlara DOKUNMAZ.
 *
 * Queue Worker: message_queue tablosundaki PENDING kayıtları alır,
 * firmanın WhatsApp kanalını bulur ve Evolution sendText ile gerçekten gönderir.
 * Başarılı → SENT + provider_message_id yazar.
 * Başarısız → retry_count artır, max_retries dolduysa FAILED yap.
 *
 * Aynı instanceName fonksiyonunu kullanır: getCompanyInstanceName(companyId)
 * Hardcoded instance KULLANMAZ.
 * SOLID: Single Responsibility — sadece periyodik sağlık kontrolü ve reconnect + queue işleme.
 */

import { whatsAppManager } from './whatsapp.manager';
import { whatsAppRepository } from './whatsapp.repository';
import { getCompanyInstanceName } from './whatsapp.helpers';
import { messageQueue } from './whatsapp.queue';

// ─── Konfigürasyon ───────────────────────────────
const CHECK_INTERVAL_MS = 30_000; // 30 saniyede bir kontrol
const QUEUE_PROCESS_INTERVAL_MS = 10_000; // 10 saniyede bir kuyruk işle
const MIN_RECONNECT_INTERVAL_MS = 60_000; // Aynı client en az 1 dakika arayla reconnect edilir
const MAX_RECONNECT_ATTEMPTS = 5; // 5 başarısız denemeden sonra vazgeç
const RECONNECT_BACKOFF_BASE = 5000; // Backoff: 5sn, 10sn, 20sn, 40sn...

interface ReconnectRecord {
  companyId: string;
  siteId?: string;
  instanceName: string;
  attempts: number;
  lastAttemptAt: number;
  nextAttemptAt: number;
}

export class WhatsAppScheduler {
  private reconnectRecords: Map<string, ReconnectRecord> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private queueInterval: NodeJS.Timeout | null = null;
  private backoffTimer: Map<string, NodeJS.Timeout> = new Map();
  private running: boolean = false;
  private queueProcessing: boolean = false; // Aynı anda tek queue işle

  // ═════════════════════════════════════════════════
  //  Public API
  // ═════════════════════════════════════════════════

  start(): void {
    if (this.running) {
      console.warn('[WhatsAppScheduler] Zaten çalışıyor.');
      return;
    }

    this.running = true;
    console.log(`[WhatsAppScheduler] Multi-Tenant başlatıldı. Kontrol aralığı: ${CHECK_INTERVAL_MS / 1000}s, Kuyruk: ${QUEUE_PROCESS_INTERVAL_MS / 1000}s`);

    this.checkInterval = setInterval(() => {
      this.runHealthCheck();
    }, CHECK_INTERVAL_MS);

    // Queue worker — periyodik kuyruk işleme
    this.queueInterval = setInterval(() => {
      this.runQueueWorker();
    }, QUEUE_PROCESS_INTERVAL_MS);

    // İlk kontrolleri hemen yap
    setTimeout(() => this.runHealthCheck(), 5000);
    setTimeout(() => this.runQueueWorker(), 8000);
  }

  stop(): void {
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }

    this.backoffTimer.forEach((timer) => clearTimeout(timer));
    this.backoffTimer.clear();
    this.reconnectRecords.clear();

    console.log('[WhatsAppScheduler] Durduruldu.');
  }

  isRunning(): boolean {
    return this.running;
  }

  resetReconnectRecord(companyId: string): void {
    this.reconnectRecords.delete(companyId);
    const timer = this.backoffTimer.get(companyId);
    if (timer) {
      clearTimeout(timer);
      this.backoffTimer.delete(companyId);
    }
  }

  // ═════════════════════════════════════════════════
  //  Queue Worker — PENDING mesajları gerçekten gönder
  // ═════════════════════════════════════════════════

  private async runQueueWorker(): Promise<void> {
    if (!this.running || this.queueProcessing) return;
    this.queueProcessing = true;

    try {
      // Tüm firmaların instance'larını al
      const allInstances = await whatsAppRepository.getAllCompanyInstances();
      if (allInstances.length === 0) { this.queueProcessing = false; return; }

      let totalProcessed = 0;
      let totalSent = 0;
      let totalFailed = 0;

      for (const instance of allInstances) {
        const companyId = instance.company_id;
        const siteId = instance.site_id || companyId;
        const instanceName = getCompanyInstanceName(companyId);

        // Sadece CONNECTED instance'lar için queue işle
        const client = whatsAppManager.getClient(siteId);
        if (!client || !client.isConnected()) continue;

        // Bu firmanın PENDING mesajlarını al (en fazla 5)
        const pendingMessages = await whatsAppRepository.getPendingMessages(siteId, 5);
        if (pendingMessages.length === 0) continue;

        for (const msg of pendingMessages) {
          try {
            // Durumu sending yap
            await whatsAppRepository.updateQueueStatus(msg.id, 'sending');

            // Evolution API ile gerçek gönderim
            const result = await client.sendMessage(msg.phone, msg.message);

            if (result.success) {
              await whatsAppRepository.updateQueueStatus(msg.id, 'sent');
              totalSent++;
              console.log(`[QueueWorker] ${instanceName}: Mesaj gönderildi → ${msg.phone}, msgId=${result.msgId || 'N/A'}`);
            } else {
              const newRetry = (msg.retry_count || 0) + 1;
              if (newRetry >= (msg.max_retries || 3)) {
                await whatsAppRepository.updateQueueStatus(msg.id, 'failed', result.error);
                totalFailed++;
              } else {
                // Retry: pending'e geri al, retry_count güncelle
                await whatsAppRepository.updateQueueStatus(msg.id, 'pending', result.error);
              }
            }

            totalProcessed++;
            // Rate limiting: 2 mesaj arası 4sn
            await new Promise((resolve) => setTimeout(resolve, 4000));
          } catch (err) {
            const errMsg = (err as Error).message;
            console.error(`[QueueWorker] ${instanceName}: Mesaj hatası → ${msg.phone}: ${errMsg}`);
            const newRetry = (msg.retry_count || 0) + 1;
            if (newRetry >= (msg.max_retries || 3)) {
              await whatsAppRepository.updateQueueStatus(msg.id, 'failed', errMsg);
            } else {
              await whatsAppRepository.updateQueueStatus(msg.id, 'pending', errMsg);
            }
            totalFailed++;
            totalProcessed++;
          }
        }
      }

      if (totalProcessed > 0) {
        console.log(`[QueueWorker] Tur tamamlandı: ${totalSent} gönderildi, ${totalFailed} başarısız, ${totalProcessed} işlendi`);
      }
    } catch (err) {
      console.error('[QueueWorker] Genel hata:', (err as Error).message);
    } finally {
      this.queueProcessing = false;
    }
  }

  // ═════════════════════════════════════════════════
  //  Private: Multi-Tenant Sağlık Kontrolü
  // ═════════════════════════════════════════════════

  private async runHealthCheck(): Promise<void> {
    if (!this.running) return;

    try {
      // Multi-tenant: DB'den TÜM disconnected instance'ları oku
      const disconnectedInstances = await whatsAppRepository.getDisconnectedCompanyInstances();

      if (disconnectedInstances.length === 0) return;

      console.log(`[WhatsAppScheduler] ${disconnectedInstances.length} kopuk firma bulundu, kontrol ediliyor...`);

      const now = Date.now();

      for (const instance of disconnectedInstances) {
        const companyId = instance.company_id;
        const instanceName = getCompanyInstanceName(companyId);

        // ═══ Scheduler güvenlik kontrolleri ═══

        // Manager'da zaten bağlı/QR bekleyen varsa atla
        const managerClient = whatsAppManager.getClient(instance.site_id || companyId);
        if (managerClient) {
          const status = managerClient.getStatus();
          if (status === 'CONNECTED' || status === 'WAITING_QR' || status === 'QR_READY' || status === 'LOADING') {
            console.log(`[WhatsAppScheduler] ${instanceName}: Manager'da ${status} — atlanıyor`);
            continue;
          }
        }

        const record = this.reconnectRecords.get(companyId);

        // İlk kez kopmuş
        if (!record) {
          this.scheduleReconnect(companyId, instance.site_id, instanceName, 0, now);
          continue;
        }

        // Maksimum deneme sayısına ulaştı mı?
        if (record.attempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log(`[WhatsAppScheduler] ${instanceName}: Maksimum deneme sayısına ulaşıldı (${MAX_RECONNECT_ATTEMPTS}), vazgeçiliyor.`);
          continue;
        }

        // Henüz reconnect zamanı gelmedi mi?
        if (now < record.nextAttemptAt) {
          continue;
        }

        this.scheduleReconnect(companyId, instance.site_id, instanceName, record.attempts + 1, now);
      }
    } catch (err) {
      console.error('[WhatsAppScheduler] Health check hatası:', (err as Error).message);
    }
  }

  private scheduleReconnect(
    companyId: string,
    siteId: string | null | undefined,
    instanceName: string,
    attempt: number,
    now: number,
  ): void {
    const backoffMs = RECONNECT_BACKOFF_BASE * Math.pow(2, Math.min(attempt, 5));
    const nextAttemptAt = now + backoffMs;

    this.reconnectRecords.set(companyId, {
      companyId,
      siteId: siteId || undefined,
      instanceName,
      attempts: attempt,
      lastAttemptAt: now,
      nextAttemptAt,
    });

    console.log(
      `[WhatsAppScheduler] ${instanceName} (company: ${companyId}): Reconnect planlandı (deneme ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}, ${backoffMs / 1000}s sonra)`,
    );

    const timer = setTimeout(async () => {
      this.backoffTimer.delete(companyId);

      console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect deneniyor...`);

      try {
        // Manager üzerinden reconnect
        const client = whatsAppManager.getClient(siteId || companyId);
        if (!client) {
          // Client yok → yeni oluştur ve bağlan
          const newClient = await whatsAppManager.createClient({
            siteId: siteId || companyId,
            companyId,
            instanceName,
          });
          const result = await newClient.connect();
          if (result.success) {
            console.log(`[WhatsAppScheduler] ${instanceName}: Yeni client başarıyla bağlandı!`);
            await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
              connectionStatus: 'WAITING_QR',
              lastError: null,
            });
            this.reconnectRecords.delete(companyId);
          } else {
            console.log(`[WhatsAppScheduler] ${instanceName}: Bağlantı başarısız: ${result.error}`);
          }
        } else {
          const result = await client.reconnect();
          if (result.success) {
            console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect başarılı!`);
            await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
              connectionStatus: 'WAITING_QR',
              lastError: null,
            });
            this.reconnectRecords.delete(companyId);
          } else {
            console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect başarısız: ${result.error}`);
          }
        }
      } catch (err) {
        console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect hatası: ${(err as Error).message}`);
      }
    }, backoffMs);

    this.backoffTimer.set(companyId, timer);
  }
}

/** Singleton scheduler instance */
export const whatsAppScheduler = new WhatsAppScheduler();