/**
 * WhatsApp Event Handler (Legacy stub) — Evolution API'ye geçiş sonrası kullanılmaz.
 *
 * Bu dosya geriye dönük tip uyumluluğu için korunur.
 * Yeni kodda EvolutionClient olay yönetimini kendi içinde halleder.
 *
 * @deprecated Evolution API tüm event'leri otomatik yönetir.
 */

export const QR_TIMEOUT_MS = 45000;

export function bindSessionEvents(): void {
  // Evolution API kendi event yönetimini yapar — bu stub gerekli değil
}

export function waitForQr(): Promise<{ qr: string | null; error: string | null }> {
  return Promise.resolve({ qr: null, error: 'Evolution API kullanılıyor, QR doğrudan connect endpoint\'inden alınır.' });
}

export function clearQrWaiter(): void {
  // gerekli değil
}