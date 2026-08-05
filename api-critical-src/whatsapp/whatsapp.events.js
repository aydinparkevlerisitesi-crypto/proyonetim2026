"use strict";
/**
 * WhatsApp Event Handler (Legacy stub) — Evolution API'ye geçiş sonrası kullanılmaz.
 *
 * Bu dosya geriye dönük tip uyumluluğu için korunur.
 * Yeni kodda EvolutionClient olay yönetimini kendi içinde halleder.
 *
 * @deprecated Evolution API tüm event'leri otomatik yönetir.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearQrWaiter = exports.waitForQr = exports.bindSessionEvents = exports.QR_TIMEOUT_MS = void 0;
exports.QR_TIMEOUT_MS = 45000;
function bindSessionEvents() {
    // Evolution API kendi event yönetimini yapar — bu stub gerekli değil
}
exports.bindSessionEvents = bindSessionEvents;
function waitForQr() {
    return Promise.resolve({ qr: null, error: 'Evolution API kullanılıyor, QR doğrudan connect endpoint\'inden alınır.' });
}
exports.waitForQr = waitForQr;
function clearQrWaiter() {
    // gerekli değil
}
exports.clearQrWaiter = clearQrWaiter;
//# sourceMappingURL=whatsapp.events.js.map