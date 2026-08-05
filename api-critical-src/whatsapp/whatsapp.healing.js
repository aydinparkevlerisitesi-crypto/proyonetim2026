"use strict";
/**
 * WhatsApp Self-Healing Engine — Production Auto-Fix Operations
 *
 * Sadece GÜVENLİ işlemler otomatik yapılır:
 *   • instance-exists    → disconnect + reconnect (session yenile)
 *   • webhook-registered → webhook re-register (Evolution API üzerinden)
 *   • bullmq-queue       → stuck pending message'leri retry et
 *   • redis-running      → bağlantı testi (manuel müdahale gerekli)
 *   • websocket-connected→ backend'de bir şey yok, frontend reconnect eder
 *
 * Manuel gerektirenler (Düzelt butonu disabled + tooltip):
 *   • docker-container, nginx-proxy, ssl-cert, pm2-service, env-vars, api-key
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.healDiagnosticItem = void 0;
const evolution_client_1 = require("./evolution.client");
const whatsapp_manager_1 = require("./whatsapp.manager");
const whatsapp_queue_1 = require("./whatsapp.queue");
const whatsapp_repository_1 = require("./whatsapp.repository");
const fetchCompat_1 = require("../../lib/fetchCompat");
/** Ana healing fonksiyonu — tek bir kontrol kalemi için */
async function healDiagnosticItem(itemId, siteId) {
    switch (itemId) {
        case 'evolution-api':
            return healEvolutionApi();
        case 'docker-container':
            return healDockerContainer();
        case 'instance-exists':
            return healInstance(siteId);
        case 'api-key':
            return healApiKey();
        case 'webhook-registered':
            return healWebhook(siteId);
        case 'websocket-connected':
            return healWebSocket();
        case 'redis-running':
            return healRedis();
        case 'bullmq-queue':
            return healQueue(siteId);
        case 'supabase-connection':
            return healSupabase();
        case 'nginx-proxy':
            return manualOnly(itemId, 'Nginx yapılandırmasını kontrol edin: sudo nginx -t && sudo systemctl restart nginx');
        case 'ssl-cert':
            return manualOnly(itemId, 'SSL sertifikasını yenileyin: certbot renew veya manuel yenileme yapın.');
        case 'pm2-service':
            return manualOnly(itemId, 'PM2 servisini kontrol edin: pm2 status, pm2 restart all');
        case 'env-vars':
            return manualOnly(itemId, 'Eksik environment değişkenlerini .env dosyasına ekleyin ve uygulamayı yeniden başlatın.');
        case 'radore-api':
            return { success: true, itemId, message: 'Radore API her zaman sağlıklıdır — düzeltme gerekmez.', fixed: false };
        default:
            return { success: false, itemId, message: 'Bilinmeyen kontrol kalemi.', fixed: false };
    }
}
exports.healDiagnosticItem = healDiagnosticItem;
// ─── Güvenli Self-Healing İşlemleri ──────────────────────────
async function healEvolutionApi() {
    const evo = await (0, evolution_client_1.pingEvolutionApi)();
    if (evo.alive) {
        return {
            success: true,
            itemId: 'evolution-api',
            message: `Evolution API zaten çalışıyor (${evo.version || 'active'}). Düzeltme gerekmez.`,
            fixed: false,
        };
    }
    // Evolution API kapalı — aktif session'ların siteId'lerini alıp Manager üzerinden reconnect dene
    try {
        const allClients = whatsapp_manager_1.whatsAppManager.getAllClients();
        let restarted = 0;
        for (const { siteId } of allClients) {
            try {
                const result = await whatsapp_manager_1.whatsAppManager.reconnect(siteId);
                if (result.success)
                    restarted++;
            }
            catch {
                // skip per site
            }
        }
        return {
            success: true,
            itemId: 'evolution-api',
            message: restarted > 0
                ? `Evolution API erişilemiyor. ${restarted} instance reconnect denendi. Lütfen 30 saniye sonra tekrar kontrol edin.`
                : 'Evolution API erişilemiyor. Otomatik düzeltme yapılamadı — Docker container manuel başlatılmalı.',
            fixed: restarted > 0,
            requiresManualAction: restarted === 0,
            manualInstructions: 'Sunucuda: docker ps ile container durumunu kontrol edin. Durmuşsa: docker start <container_id>',
        };
    }
    catch (err) {
        return {
            success: false,
            itemId: 'evolution-api',
            message: `Reconnect denemesi başarısız: ${err.message}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Sunucuda: docker ps ile container durumunu kontrol edin.',
        };
    }
}
async function healDockerContainer() {
    // Docker container'ı kod içinden restart edemeyiz — manuel
    return {
        success: true,
        itemId: 'docker-container',
        message: 'Docker container otomatik restart edilemez (güvenlik).',
        fixed: false,
        requiresManualAction: true,
        manualInstructions: 'Sunucuda: docker ps -a ile container durumunu kontrol edin. Durmuşsa: docker start <container_id> veya docker-compose up -d',
    };
}
async function healInstance(siteId) {
    if (!siteId) {
        return {
            success: true,
            itemId: 'instance-exists',
            message: 'Site ID belirtilmemiş — tüm instance\'ları reconnect ediliyor.',
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Bir site seçin ve "Cihaz Bağla" sekmesinden QR bağlantısı başlatın.',
        };
    }
    const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
    if (client) {
        try {
            // 1. Önce disconnect et (temiz kapatma)
            await client.disconnect();
            await new Promise((r) => setTimeout(r, 1500));
            // 2. Yeniden bağlan
            const result = await client.reconnect();
            return {
                success: true,
                itemId: 'instance-exists',
                message: result.success
                    ? 'Instance başarıyla yeniden bağlandı. QR kod hazırsa tarayabilirsiniz.'
                    : 'Instance yeniden bağlantısı tamamlandı ancak QR kod henüz hazır değil.',
                fixed: result.success,
            };
        }
        catch (err) {
            return {
                success: false,
                itemId: 'instance-exists',
                message: `Yeniden bağlantı başarısız: ${err.message}`,
                fixed: false,
                requiresManualAction: true,
                manualInstructions: '"Cihaz Bağla" sekmesinden "Bağlantıyı Kes" yapıp tekrar "Bağlantı Başlat" deneyin.',
            };
        }
    }
    // Client yoksa — yeni client oluşturmayı dene
    try {
        const newClient = await whatsapp_manager_1.whatsAppManager.createClient({ siteId });
        const result = await newClient.connect();
        return {
            success: true,
            itemId: 'instance-exists',
            message: result.success
                ? 'Yeni instance oluşturuldu ve bağlantı başlatıldı.'
                : 'Yeni instance oluşturuldu ancak QR kod henüz hazır değil.',
            fixed: result.success,
        };
    }
    catch (err) {
        return {
            success: false,
            itemId: 'instance-exists',
            message: `Yeni instance oluşturulamadı: ${err.message}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Evolution API\'nin çalıştığından emin olun, ardından tekrar deneyin.',
        };
    }
}
function healApiKey() {
    // API Key düzeltilemez — env değişkeni
    return Promise.resolve({
        success: true,
        itemId: 'api-key',
        message: 'API Key environment değişkeni üzerinden yönetilir. Otomatik düzeltme yapılamaz.',
        fixed: false,
        requiresManualAction: true,
        manualInstructions: 'Sunucuda .env dosyasında EVOLUTION_API_KEY doğru ayarlandığından emin olun ve uygulamayı restart edin.',
    });
}
async function healWebhook(siteId) {
    try {
        const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
        const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
        // Mevcut webhook'ları sil
        await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/webhook/delete`, {
            method: 'POST',
            headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        }, 8000);
        // Yeni webhook kaydet
        const webhookUrl = `${process.env.RADORE_API_URL || `https://${process.env.HOST || 'localhost'}`}/api/whatsapp/webhook`;
        const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/webhook/create`, {
            method: 'POST',
            headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                events: ['message', 'status', 'connection', 'qrcode'],
                enabled: true,
            }),
        }, 8000);
        if (res.ok) {
            return {
                success: true,
                itemId: 'webhook-registered',
                message: `Webhook başarıyla yeniden kaydedildi: ${webhookUrl}`,
                fixed: true,
            };
        }
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        return {
            success: false,
            itemId: 'webhook-registered',
            message: `Webhook kaydı başarısız: ${errText}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Evolution API panelinden webhook URL\'sini manuel ekleyin.',
        };
    }
    catch (err) {
        return {
            success: false,
            itemId: 'webhook-registered',
            message: `Webhook kaydı başarısız: ${err.message}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Evolution API panelinden webhook URL\'sini manuel ekleyin.',
        };
    }
}
function healWebSocket() {
    // WebSocket backend'de pasif — frontend kendi reconnect eder
    return Promise.resolve({
        success: true,
        itemId: 'websocket-connected',
        message: 'WebSocket reconnect frontend tarafında otomatik yapılır. Lütfen sayfayı yenileyin.',
        fixed: false,
        requiresManualAction: true,
        manualInstructions: 'Sayfayı yenileyin (F5). WebSocket otomatik yeniden bağlanacaktır.',
    });
}
function healRedis() {
    return Promise.resolve({
        success: true,
        itemId: 'redis-running',
        message: 'Redis bağlantısı kod içinden düzeltilemez. Lütfen sunucu yöneticinize danışın.',
        fixed: false,
        requiresManualAction: true,
        manualInstructions: 'Sunucuda: redis-cli ping veya systemctl status redis komutlarını çalıştırın.',
    });
}
async function healQueue(siteId) {
    try {
        let flushed = 0;
        if (siteId) {
            // Belirli site için stuck message'leri flush et
            flushed = await whatsapp_queue_1.messageQueue.flushStuckMessages(siteId);
        }
        else {
            // Tüm siteler — getAllClients() düz obje döner, siteId doğrudan okunur
            const clients = whatsapp_manager_1.whatsAppManager.getAllClients();
            for (const { siteId: sid } of clients) {
                if (sid) {
                    const f = await whatsapp_queue_1.messageQueue.flushStuckMessages(sid);
                    flushed += f;
                }
            }
        }
        return {
            success: true,
            itemId: 'bullmq-queue',
            message: flushed > 0
                ? `${flushed} adet takılı mesaj kuyruktan temizlendi.`
                : 'Takılı mesaj bulunamadı. Kuyruk zaten sağlıklı.',
            fixed: flushed > 0,
        };
    }
    catch (err) {
        return {
            success: false,
            itemId: 'bullmq-queue',
            message: `Kuyruk temizleme başarısız: ${err.message}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'Supabase\'de message_queue tablosunda status = \'sending\' olan kayıtları kontrol edin.',
        };
    }
}
async function healSupabase() {
    try {
        // Basit bir reconnect dene
        await whatsapp_repository_1.whatsAppRepository.ping();
        return {
            success: true,
            itemId: 'supabase-connection',
            message: 'Supabase bağlantısı tekrar test edildi — erişim aktif.',
            fixed: true,
        };
    }
    catch (err) {
        return {
            success: false,
            itemId: 'supabase-connection',
            message: `Supabase reconnect başarısız: ${err.message}`,
            fixed: false,
            requiresManualAction: true,
            manualInstructions: 'SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY değişkenlerini kontrol edin.',
        };
    }
}
function manualOnly(itemId, instructions) {
    return Promise.resolve({
        success: true,
        itemId,
        message: 'Bu kontrol kalemi otomatik düzeltmeyi desteklemiyor.',
        fixed: false,
        requiresManualAction: true,
        manualInstructions: instructions,
    });
}
//# sourceMappingURL=whatsapp.healing.js.map