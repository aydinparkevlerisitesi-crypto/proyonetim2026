"use strict";
/**
 * WhatsApp Message Queue — Rate limit'li toplu mesaj kuyruğu.
 *
 * Bellek içi kuyruk + Supabase persistansı.
 * Site başına rate limit, öncelik sıralaması, otomatik retry.
 * Aynı anda yüzlerce mesajı güvenle işler.
 * SOLID: Single Responsibility — sadece kuyruk yönetimi.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageQueue = exports.MessageQueue = void 0;
const whatsapp_repository_1 = require("./whatsapp.repository");
const whatsapp_manager_1 = require("./whatsapp.manager");
// ─── Varsayılan rate limit ───────────────────────
const DEFAULT_RATE_LIMIT = {
    maxMessagesPerMinute: 15,
    maxMessagesPerHour: 200,
    maxBulkPerRequest: 100,
    cooldownMs: 4000, // 2 mesaj arası minimum 4 saniye
};
class MessageQueue {
    queues = new Map();
    rateLimit;
    totalSent = 0;
    totalFailed = 0;
    constructor(rateLimit = {}) {
        this.rateLimit = { ...DEFAULT_RATE_LIMIT, ...rateLimit };
    }
    // ═════════════════════════════════════════════════
    //  Public API
    // ═════════════════════════════════════════════════
    /** Kuyruğa tek mesaj ekle */
    async enqueue(item) {
        // DB'ye kaydet
        const result = await whatsapp_repository_1.whatsAppRepository.enqueueMessage({
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
        const queueItem = {
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
    async enqueueBulk(siteId, companyId, recipients, maxRetries) {
        if (recipients.length > this.rateLimit.maxBulkPerRequest) {
            return {
                success: false,
                queued: 0,
                failed: recipients.length,
                queueIds: [],
            };
        }
        // DB'ye toplu ekle
        const result = await whatsapp_repository_1.whatsAppRepository.enqueueBulkMessages(siteId, companyId, recipients, maxRetries);
        // Bellek içi kuyruğa ekle
        const siteQueue = this.getOrCreateQueue(siteId);
        for (let i = 0; i < result.queueIds.length; i++) {
            const recipient = recipients[i];
            if (!recipient)
                continue;
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
    getStats(siteId) {
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
    getTotalStats() {
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
    async clearAll() {
        this.queues.forEach((q) => {
            if (q.timer)
                clearTimeout(q.timer);
        });
        this.queues.clear();
    }
    /** Takılı kalmış mesajları temizle (sending → pending) */
    async flushStuckMessages(siteId) {
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
            const stuckDb = await whatsapp_repository_1.whatsAppRepository.getStuckMessages(siteId);
            if (stuckDb.length > 0) {
                for (const msg of stuckDb) {
                    await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(msg.id, 'pending', 'Self-healing: stuck message flushed');
                }
            }
            return stuckDb.length;
        }
        catch {
            return 0;
        }
    }
    // ═════════════════════════════════════════════════
    //  Private: Kuyruk İşleme Motoru
    // ═════════════════════════════════════════════════
    getOrCreateQueue(siteId) {
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
        return this.queues.get(siteId);
    }
    sortQueue(siteId) {
        const siteQueue = this.queues.get(siteId);
        if (!siteQueue)
            return;
        siteQueue.items.sort((a, b) => {
            // priority yüksek olan önce
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            // aynı priority'de eski olan önce
            return a.createdAt - b.createdAt;
        });
    }
    tick(siteId) {
        const siteQueue = this.queues.get(siteId);
        if (!siteQueue || siteQueue.processing)
            return;
        this.processNext(siteId);
    }
    async processNext(siteId) {
        const siteQueue = this.queues.get(siteId);
        if (!siteQueue)
            return;
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
        const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
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
                await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(item.id, 'sent');
                // Başarılı gönderimleri kuyruktan temizle
                siteQueue.items = siteQueue.items.filter((i) => i.status !== 'sent');
            }
            else {
                item.retryCount++;
                if (item.retryCount >= item.maxRetries) {
                    item.status = 'failed';
                    this.totalFailed++;
                    await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(item.id, 'failed', result.error);
                    siteQueue.items = siteQueue.items.filter((i) => i.status !== 'failed');
                }
                else {
                    item.status = 'pending';
                    await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(item.id, 'pending', result.error);
                }
            }
        }
        catch (err) {
            item.retryCount++;
            if (item.retryCount >= item.maxRetries) {
                item.status = 'failed';
                this.totalFailed++;
                await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(item.id, 'failed', err.message);
                siteQueue.items = siteQueue.items.filter((i) => i.status !== 'failed');
            }
            else {
                item.status = 'pending';
                await whatsapp_repository_1.whatsAppRepository.updateQueueStatus(item.id, 'pending', err.message);
            }
        }
        siteQueue.processing = false;
        // Sonraki mesaja geç
        const remaining = siteQueue.items.filter((i) => i.status === 'pending').length;
        if (remaining > 0) {
            this.scheduleNext(siteId, this.rateLimit.cooldownMs);
        }
    }
    scheduleNext(siteId, delayMs) {
        const siteQueue = this.queues.get(siteId);
        if (!siteQueue)
            return;
        if (siteQueue.timer)
            clearTimeout(siteQueue.timer);
        siteQueue.timer = setTimeout(() => {
            siteQueue.processing = false;
            this.processNext(siteId);
        }, delayMs);
    }
    /** Dakikalık sayacı sıfırla (her dakika çağrılır) */
    resetMinuteCounters() {
        this.queues.forEach((q) => {
            q.sentLastMinute = 0;
        });
    }
}
exports.MessageQueue = MessageQueue;
/** Singleton queue instance */
exports.messageQueue = new MessageQueue();
// Dakikalık sayaçları sıfırlayan zamanlayıcı
setInterval(() => {
    exports.messageQueue.resetMinuteCounters();
}, 60_000);
//# sourceMappingURL=whatsapp.queue.js.map