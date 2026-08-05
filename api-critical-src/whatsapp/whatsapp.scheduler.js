"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsAppScheduler = exports.WhatsAppScheduler = void 0;
const whatsapp_manager_1 = require("./whatsapp.manager");
const whatsapp_repository_1 = require("./whatsapp.repository");
const whatsapp_helpers_1 = require("./whatsapp.helpers");
// ─── Konfigürasyon ───────────────────────────────
const CHECK_INTERVAL_MS = 30_000; // 30 saniyede bir kontrol
const QUEUE_PROCESS_INTERVAL_MS = 10_000; // 10 saniyede bir kuyruk işle
const MIN_RECONNECT_INTERVAL_MS = 60_000; // Aynı client en az 1 dakika arayla reconnect edilir
const MAX_RECONNECT_ATTEMPTS = 5; // 5 başarısız denemeden sonra vazgeç
const RECONNECT_BACKOFF_BASE = 5000; // Backoff: 5sn, 10sn, 20sn, 40sn...
class WhatsAppScheduler {
    reconnectRecords = new Map();
    checkInterval = null;
    queueInterval = null;
    backoffTimer = new Map();
    running = false;
    queueProcessing = false; // Aynı anda tek queue işle
    // ═════════════════════════════════════════════════
    //  Public API
    // ═════════════════════════════════════════════════
    start() {
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
    stop() {
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
    isRunning() {
        return this.running;
    }
    resetReconnectRecord(companyId) {
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
    async runQueueWorker() {
        if (!this.running || this.queueProcessing)
            return;
        this.queueProcessing = true;
        try {
            // Tüm firmaların instance'larını al
            const allInstances = await whatsapp_repository_1.whatsAppRepository.getAllCompanyInstances();
            if (allInstances.length === 0) {
                this.queueProcessing = false;
                return;
            }
            let totalProcessed = 0;
            let totalSent = 0;
            let totalFailed = 0;
            for (const instance of allInstances) {
                const companyId = instance.company_id;
                const siteId = instance.site_id || companyId;
                const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId);
                // Sadece CONNECTED instance'lar için queue işle
                const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
                if (!client || !client.isConnected())
                    continue;
                // Bu firmanın PENDING mesajlarını al (en fazla 5)
                const pendingMessages = await whatsapp_repository_1.whatsAppRepository.getPendingMessages(siteId, 5);
                if (pendingMessages.length === 0)
                    continue;
                for (const msg of pendingMessages) {
                    try {
                        // Durumu sending yap
                        await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'sending');
                        // Evolution API ile gerçek gönderim
                        const result = await client.sendMessage(msg.phone, msg.message);
                        if (result.success) {
                            await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'sent');
                            totalSent++;
                            console.log(`[QueueWorker] ${instanceName}: Mesaj gönderildi → ${msg.phone}, msgId=${result.msgId || 'N/A'}`);
                        }
                        else {
                            const newRetry = (msg.retry_count || 0) + 1;
                            if (newRetry >= (msg.max_retries || 3)) {
                                await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'failed', result.error);
                                totalFailed++;
                            }
                            else {
                                // Retry: pending'e geri al, retry_count güncelle
                                await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'pending', result.error);
                            }
                        }
                        totalProcessed++;
                        // Rate limiting: 2 mesaj arası 4sn
                        await new Promise((resolve) => setTimeout(resolve, 4000));
                    }
                    catch (err) {
                        const errMsg = err.message;
                        console.error(`[QueueWorker] ${instanceName}: Mesaj hatası → ${msg.phone}: ${errMsg}`);
                        const newRetry = (msg.retry_count || 0) + 1;
                        if (newRetry >= (msg.max_retries || 3)) {
                            await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'failed', errMsg);
                        }
                        else {
                            await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'pending', errMsg);
                        }
                        totalFailed++;
                        totalProcessed++;
                    }
                }
            }
            if (totalProcessed > 0) {
                console.log(`[QueueWorker] Tur tamamlandı: ${totalSent} gönderildi, ${totalFailed} başarısız, ${totalProcessed} işlendi`);
            }
        }
        catch (err) {
            console.error('[QueueWorker] Genel hata:', err.message);
        }
        finally {
            this.queueProcessing = false;
        }
    }
    // ═════════════════════════════════════════════════
    //  Private: Multi-Tenant Sağlık Kontrolü
    // ═════════════════════════════════════════════════
    async runHealthCheck() {
        if (!this.running)
            return;
        try {
            // Multi-tenant: DB'den TÜM disconnected instance'ları oku
            const disconnectedInstances = await whatsapp_repository_1.whatsAppRepository.getDisconnectedCompanyInstances();
            if (disconnectedInstances.length === 0)
                return;
            console.log(`[WhatsAppScheduler] ${disconnectedInstances.length} kopuk firma bulundu, kontrol ediliyor...`);
            const now = Date.now();
            for (const instance of disconnectedInstances) {
                const companyId = instance.company_id;
                const instanceName = (0, whatsapp_helpers_1.getCompanyInstanceName)(companyId);
                // ═══ Scheduler güvenlik kontrolleri ═══
                // Manager'da zaten bağlı/QR bekleyen varsa atla
                const managerClient = whatsapp_manager_1.whatsAppManager.getClient(instance.site_id || companyId);
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
        }
        catch (err) {
            console.error('[WhatsAppScheduler] Health check hatası:', err.message);
        }
    }
    scheduleReconnect(companyId, siteId, instanceName, attempt, now) {
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
        console.log(`[WhatsAppScheduler] ${instanceName} (company: ${companyId}): Reconnect planlandı (deneme ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}, ${backoffMs / 1000}s sonra)`);
        const timer = setTimeout(async () => {
            this.backoffTimer.delete(companyId);
            console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect deneniyor...`);
            try {
                // Manager üzerinden reconnect
                const client = whatsapp_manager_1.whatsAppManager.getClient(siteId || companyId);
                if (!client) {
                    // Client yok → yeni oluştur ve bağlan
                    const newClient = await whatsapp_manager_1.whatsAppManager.createClient({
                        siteId: siteId || companyId,
                        companyId,
                        instanceName,
                    });
                    const result = await newClient.connect();
                    if (result.success) {
                        console.log(`[WhatsAppScheduler] ${instanceName}: Yeni client başarıyla bağlandı!`);
                        await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                            connectionStatus: 'WAITING_QR',
                            lastError: null,
                        });
                        this.reconnectRecords.delete(companyId);
                    }
                    else {
                        console.log(`[WhatsAppScheduler] ${instanceName}: Bağlantı başarısız: ${result.error}`);
                    }
                }
                else {
                    const result = await client.reconnect();
                    if (result.success) {
                        console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect başarılı!`);
                        await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                            connectionStatus: 'WAITING_QR',
                            lastError: null,
                        });
                        this.reconnectRecords.delete(companyId);
                    }
                    else {
                        console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect başarısız: ${result.error}`);
                    }
                }
            }
            catch (err) {
                console.log(`[WhatsAppScheduler] ${instanceName}: Reconnect hatası: ${err.message}`);
            }
        }, backoffMs);
        this.backoffTimer.set(companyId, timer);
    }
}
exports.WhatsAppScheduler = WhatsAppScheduler;
/** Singleton scheduler instance */
exports.whatsAppScheduler = new WhatsAppScheduler();
//# sourceMappingURL=whatsapp.scheduler.js.map