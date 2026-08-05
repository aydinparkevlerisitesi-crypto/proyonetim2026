"use strict";
/**
 * WhatsApp Webhook Handler — Evolution API'den gelen event'leri işler.
 *
 * Evolution API webhook payload'ları:
 * - connection.update → CONNECTED / DISCONNECTED durum değişikliği
 * - qrcode.update → QR kod eventi
 * - messages.upsert → Gelen mesajlar
 * - messages.update → Mesaj durum güncellemeleri (sent, delivered, read)
 *
 * Multi-tenant: instance_name üzerinden company_id bulunur.
 * Bilinmeyen instance'lar loglanır ama başka firmaya bağlanmaz.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEvolutionWebhook = void 0;
const whatsapp_repository_1 = require("./whatsapp.repository");
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
/**
 * Evolution webhook handler.
 * POST /api/whatsapp/webhook/evolution
 *
 * Güvenlik: Evolution API key doğrulaması yapılır.
 * instance_name üzerinden company_id bulunur.
 * DB durumu otomatik güncellenir.
 */
async function handleEvolutionWebhook(req, res) {
    try {
        const payload = req.body;
        // ═══ Güvenlik: yalnızca HEADER apikey (QR-UNSUCCESSFUL-20260804) ═══
        // Evolution body.apikey = instance token (örn. 41B510E6-…) ≠ EVOLUTION_API_KEY → eski kod 403
        // veriyordu; CONNECTION_UPDATE/QR hiç işlenmiyor → telefonda başarısız, yazılım DISCONNECTED.
        const expectedKey = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
        const headerKey = req.headers['x-api-key'] || req.headers['apikey'] || '';
        if (headerKey && expectedKey && headerKey !== expectedKey) {
            console.warn(`[Webhook] Geçersiz API key (header): instance=${payload.instance}`);
            res.status(403).json({ success: false, error: 'invalid_api_key' });
            return;
        }
        // Evolution event adları: CONNECTION_UPDATE / qrcode.updated → normalize
        let event = String(payload.event || '').toLowerCase().replace(/_/g, '.');
        if (event === 'qrcode.updated') event = 'qrcode.update';
        const instanceName = payload.instance;
        const data = payload.data || {};
        if (!instanceName) {
            console.warn('[Webhook] Instance name eksik, atlanıyor');
            res.status(400).json({ success: false, error: 'instance_name_required' });
            return;
        }
        console.log(`[Webhook] Gelen event: ${event}, instance=${instanceName}`);
        // ═══ instance_name → company_id çöz ═══
        const dbInstance = await whatsapp_repository_1.whatsAppRepository.getCompanyInstanceByName(instanceName);
        const companyId = dbInstance?.company_id;
        if (!companyId) {
            // Bilinmeyen instance — logla ama 200 dön (Evolution tekrar göndermesin)
            console.warn(`[Webhook] Bilinmeyen instance: ${instanceName} — DB'de kayıtlı değil`);
            res.json({ success: true, message: 'instance_not_registered' });
            return;
        }
        // ═══ Event işleme ═══
        switch (event) {
            case 'connection.update': {
                const connectionState = data.state || data.connection || '';
                console.log(`[Webhook] connection.update: ${connectionState} (companyId=${companyId})`);
                if (connectionState === 'open' || connectionState === 'connected') {
                    // Cihaz bağlandı
                    await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                        connectionStatus: 'CONNECTED',
                        qrStatus: null,
                        phoneNumber: data.phone || data.remoteJid?.replace(/@.*/, '') || dbInstance?.phone_number || null,
                        lastConnectedAt: new Date().toISOString(),
                        lastError: null,
                    });
                    console.log(`[Webhook] ${instanceName}: CONNECTED (companyId=${companyId})`);
                }
                else if (connectionState === 'close' || connectionState === 'disconnected') {
                    // Cihaz bağlantısı koptu
                    await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                        connectionStatus: 'DISCONNECTED',
                        lastDisconnectedAt: new Date().toISOString(),
                        lastError: data.reason || null,
                    });
                    console.log(`[Webhook] ${instanceName}: DISCONNECTED (companyId=${companyId}, reason=${data.reason})`);
                }
                else if (connectionState === 'connecting' || connectionState === 'reconnecting') {
                    await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                        connectionStatus: 'CONNECTING',
                    });
                }
                break;
            }
            case 'qrcode.update': {
                const qrData = data.qrcode || data;
                const base64 = qrData?.base64;
                const code = qrData?.code;
                if (base64 || code) {
                    await whatsapp_repository_1.whatsAppRepository.updateCompanyInstanceStatus(companyId, {
                        connectionStatus: 'WAITING_QR',
                        qrStatus: 'QR_READY',
                        lastQrAt: new Date().toISOString(),
                        lastError: null,
                    });
                    console.log(`[Webhook] ${instanceName}: QR_READY (base64_exists=${!!base64})`);
                }
                break;
            }
            case 'messages.upsert': {
                // Gelen mesaj — whatsapp_message_logs tablosuna yaz
                const msgData = data.message || data;
                const from = msgData?.from || '';
                const body = msgData?.body || '';
                const msgId = msgData?.id || '';
                if (from && body) {
                    try {
                        await whatsapp_repository_1.whatsAppRepository.logIncomingMessage({
                            siteId: dbInstance?.site_id || companyId,
                            companyId,
                            fromPhone: from.replace(/@.*/, ''),
                            body,
                            messageId: msgId,
                            messageType: 'text',
                        });
                        console.log(`[Webhook] ${instanceName}: Incoming message from ${from.replace(/@.*/, '')}`);
                    }
                    catch (err) {
                        console.error('[Webhook] Mesaj loglama hatası:', err.message);
                    }
                }
                break;
            }
            case 'messages.update': {
                // Mesaj durum güncellemesi (sent, delivered, read, failed)
                const status = data.status || '';
                const msgId = data?.id || '';
                const msgKey = data.key;
                const msgKeyId = msgKey?.id || '';
                const providerMessageId = msgId || msgKeyId || '';
                console.log(`[Webhook] ${instanceName}: Message status update — ${status} (providerMsgId=${providerMessageId})`);
                // Arşiv tablosunda provider_message_id ile eşleşen kaydı güncelle
                if (providerMessageId) {
                    try {
                        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
                        const now = new Date().toISOString();
                        const updateData = { updated_at: now };
                        if (status === 'DELIVERY_ACK' || status === 'DELIVERED' || status === 'RECEIVED') {
                            updateData.delivery_status = 'DELIVERED';
                            updateData.delivered_at = now;
                        }
                        else if (status === 'READ' || status === 'READ_EXECUTED' || status === 'PLAYED') {
                            updateData.read_status = 'READ';
                            updateData.read_at = now;
                        }
                        else if (status === 'SERVER_ACK' || status === 'SENT' || status === 'SUCCESS') {
                            updateData.send_status = 'SENT';
                            updateData.sent_at = updateData.sent_at || now;
                        }
                        else if (status === 'ERROR' || status === 'FAILED') {
                            updateData.send_status = 'FAILED';
                            updateData.failed_at = now;
                            updateData.error_message = data?.message || status;
                        }
                        const { error: updateErr } = await sb
                            .from('whatsapp_message_archive')
                            .update(updateData)
                            .eq('provider_message_id', providerMessageId);
                        if (updateErr) {
                            console.warn(`[Webhook] Arşiv güncelleme hatası: ${updateErr.message}, providerMsgId=${providerMessageId}`);
                        }
                        else {
                            console.log(`[Webhook] Arşiv güncellendi: providerMsgId=${providerMessageId}, status=${status}`);
                        }
                    }
                    catch (archiveErr) {
                        console.warn(`[Webhook] Arşiv güncelleme exception: ${archiveErr.message}`);
                    }
                }
                // Ayrıca whatsapp_message_logs tablosunda da güncelle (geriye dönük uyumlu)
                if (providerMessageId) {
                    try {
                        await whatsapp_repository_1.whatsAppRepository.updateMessageLogStatus(providerMessageId, status);
                    }
                    catch {
                        // Sessiz — log tablosu opsiyonel
                    }
                }
                break;
            }
            default:
                console.log(`[Webhook] Bilinmeyen event tipi: ${event} (instance=${instanceName})`);
        }
        res.json({ success: true, event, instanceName, companyId });
    }
    catch (err) {
        console.error('[Webhook] Kritik hata:', err.message);
        // Evolution API tekrar denesin diye 500 dönme — 200 dön ki spam yapmasın
        res.json({ success: true, error: 'internal_handler_error_but_acknowledged' });
    }
}
exports.handleEvolutionWebhook = handleEvolutionWebhook;
//# sourceMappingURL=whatsapp.webhook.js.map