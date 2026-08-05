"use strict";
/**
 * Company-Based Rate Limiter — Firma + endpoint bazlı limit kontrolü.
 *
 * Global IP bazlı değil, firma + eylem bazlıdır.
 * Aynı anda yüzlerce firma kullansa bir firmanın yoğunluğu diğerini bozmaz.
 *
 * Konfigürasyon:
 *   connect:     company başına dakikada 5
 *   status:      company başına dakikada 30
 *   send:        company başına kontrollü (queue zaten limitli)
 *   bulk-send:   company başına dakikada 3
 *   disconnect:  company başına dakikada 5
 *   reconnect:   company başına dakikada 5
 *   diagnostics: company başına dakikada 10
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.companyRateLimiter = void 0;
const WINDOW_MS = 60_000; // 1 dakika pencere
const DEFAULT_LIMITS = {
    'connect': 5,
    'status': 30,
    'send': 60,
    'bulk-send': 3,
    'disconnect': 5,
    'reconnect': 5,
    'diagnostics': 10,
};
const BLOCK_DURATION_MS = 30_000; // Limit aşılınca 30 saniye block
class CompanyRateLimiter {
    windows = new Map();
    /**
     * İstek yapılabilir mi kontrol et.
     * @param companyId - Firma ID'si
     * @param action - Eylem (connect, send, vb.)
     * @returns true = izin var, false = limit aşıldı
     */
    check(companyId, action = 'connect') {
        const key = `${companyId}:${action}`;
        const limit = DEFAULT_LIMITS[action] || 10;
        const now = Date.now();
        let window = this.windows.get(key);
        if (!window) {
            window = { timestamps: [], blockedUntil: null };
            this.windows.set(key, window);
        }
        // Block süresi doldu mu?
        if (window.blockedUntil && now < window.blockedUntil) {
            const remaining = Math.ceil((window.blockedUntil - now) / 1000);
            console.log(`[RateLimiter] ${key} blocklu — ${remaining}s kaldı`);
            return false;
        }
        // Block süresi dolduysa sıfırla
        if (window.blockedUntil) {
            window.timestamps = [];
            window.blockedUntil = null;
        }
        // Pencere dışındaki zaman damgalarını temizle
        const cutoff = now - WINDOW_MS;
        window.timestamps = window.timestamps.filter((t) => t > cutoff);
        // Limit kontrolü
        if (window.timestamps.length >= limit) {
            window.blockedUntil = now + BLOCK_DURATION_MS;
            console.warn(`[RateLimiter] ${key} limit aşıldı (${window.timestamps.length}/${limit}) — ${BLOCK_DURATION_MS / 1000}s block`);
            return false;
        }
        // İzin ver
        window.timestamps.push(now);
        return true;
    }
    /** Kalan istek sayısı */
    remaining(companyId, action = 'connect') {
        const key = `${companyId}:${action}`;
        const limit = DEFAULT_LIMITS[action] || 10;
        const window = this.windows.get(key);
        if (!window)
            return limit;
        const now = Date.now();
        if (window.blockedUntil && now < window.blockedUntil)
            return 0;
        const cutoff = now - WINDOW_MS;
        const active = window.timestamps.filter((t) => t > cutoff).length;
        return Math.max(0, limit - active);
    }
    /** Block'u manuel kaldır */
    reset(companyId, action = 'connect') {
        const key = `${companyId}:${action}`;
        this.windows.delete(key);
    }
    /** Tüm limitleri temizle */
    clearAll() {
        this.windows.clear();
    }
    /** Eski pencereleri temizle (periyodik bakım) */
    cleanup() {
        const now = Date.now();
        const cutoff = now - WINDOW_MS * 2;
        for (const [key, window] of this.windows) {
            window.timestamps = window.timestamps.filter((t) => t > cutoff);
            if (window.timestamps.length === 0 && (!window.blockedUntil || now > window.blockedUntil)) {
                this.windows.delete(key);
            }
        }
    }
}
/** Singleton rate limiter instance */
exports.companyRateLimiter = new CompanyRateLimiter();
// Periyodik temizlik — her 5 dakikada bir
setInterval(() => {
    exports.companyRateLimiter.cleanup();
}, 300_000);
//# sourceMappingURL=whatsapp.rateLimit.js.map