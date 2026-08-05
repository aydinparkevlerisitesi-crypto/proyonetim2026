"use strict";
/**
 * WhatsApp Idempotency Lock — Aynı firma için tek instance garantisi.
 *
 * In-memory lock (production'da Redis'e geçilebilir).
 * Aynı company_id için aynı anda 10 connect isteği gelirse
 * sadece 1 tanesi Evolution API'ye gider.
 *
 * SOLID: Single Responsibility — sadece lock yönetimi.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsAppLock = void 0;
// ─── Konfigürasyon ──────────────────────────────
const LOCK_TTL_MS = 30_000; // 30 saniye — bu sürede connect tamamlanmazsa lock otomatik kalkar
const MAX_LOCKS = 1000; // Maksimum eşzamanlı lock — memory koruması
class WhatsAppLock {
    locks = new Map();
    /**
     * Lock almayı dene.
     * @returns true = lock alındı, işlem yapılabilir. false = zaten lock'lu, bekle.
     */
    acquire(companyId, operation = 'connect') {
        const key = `${operation}:${companyId}`;
        // Zaten lock'lu mu?
        const existing = this.locks.get(key);
        if (existing) {
            // Süresi dolmuş lock varsa temizle
            if (Date.now() - existing.acquiredAt > LOCK_TTL_MS) {
                clearTimeout(existing.timeout);
                this.locks.delete(key);
            }
            else {
                console.log(`[WhatsAppLock] ${key} zaten lock'lu, atlanıyor`);
                return false;
            }
        }
        // Kapasite kontrolü
        if (this.locks.size >= MAX_LOCKS) {
            console.warn('[WhatsAppLock] Maksimum lock sayısına ulaşıldı, en eski lock temizleniyor');
            const oldest = [...this.locks.entries()].sort((a, b) => a[1].acquiredAt - b[1].acquiredAt)[0];
            if (oldest) {
                clearTimeout(oldest[1].timeout);
                this.locks.delete(oldest[0]);
            }
        }
        // Yeni lock oluştur
        const timeout = setTimeout(() => {
            this.locks.delete(key);
            console.log(`[WhatsAppLock] ${key} lock TTL doldu, otomatik kaldırıldı`);
        }, LOCK_TTL_MS);
        this.locks.set(key, {
            companyId,
            acquiredAt: Date.now(),
            operation,
            timeout,
        });
        console.log(`[WhatsAppLock] ${key} lock alındı (${this.locks.size} aktif lock)`);
        return true;
    }
    /**
     * Lock'u serbest bırak.
     */
    release(companyId, operation = 'connect') {
        const key = `${operation}:${companyId}`;
        const entry = this.locks.get(key);
        if (entry) {
            clearTimeout(entry.timeout);
            this.locks.delete(key);
            console.log(`[WhatsAppLock] ${key} lock serbest bırakıldı`);
        }
    }
    /**
     * Belirli bir lock var mı?
     */
    isLocked(companyId, operation = 'connect') {
        const key = `${operation}:${companyId}`;
        const entry = this.locks.get(key);
        if (!entry)
            return false;
        if (Date.now() - entry.acquiredAt > LOCK_TTL_MS) {
            clearTimeout(entry.timeout);
            this.locks.delete(key);
            return false;
        }
        return true;
    }
    /** Aktif lock sayısı */
    get size() {
        return this.locks.size;
    }
    /** Tüm lock'ları temizle */
    clear() {
        for (const entry of this.locks.values()) {
            clearTimeout(entry.timeout);
        }
        this.locks.clear();
        console.log('[WhatsAppLock] Tüm lock\'lar temizlendi');
    }
}
/** Singleton lock instance */
exports.whatsAppLock = new WhatsAppLock();
//# sourceMappingURL=whatsapp.lock.js.map