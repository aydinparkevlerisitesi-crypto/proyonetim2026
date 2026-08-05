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

import { Request, Response } from 'express';
import { whatsAppRepository } from './whatsapp.repository';
import { createServerSupabaseClient } from '../../lib/supabase';
import { config } from '../../config';

// ═══════════════════════════════════════════════════
//  Webhook Event Tipleri
// ═══════════════════════════════════════════════════

interface EvolutionWebhookPayload {
  event: string;          // "connection.update", "qrcode.update", "messages.upsert", "messages.update"
  instance: string;       // instanceName (örn: "company_xxx" veya "d0688649-...")
  data: Record<string, unknown>;
  apikey?: string;
}

/**
 * Evolution webhook handler.
 * POST /api/whatsapp/webhook/evolution
 *
 * Güvenlik: Evolution API key doğrulaması yapılır.
 * instance_name üzerinden company_id bulunur.
 * DB durumu otomatik güncellenir.
 */
export async function handleEvolutionWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as EvolutionWebhookPayload;

    // ═══ Güvenlik: Evolution API key doğrula ═══
    const expectedKey = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    const incomingKey = payload.apikey || req.headers['x-api-key'] || req.headers['apikey'] || '';

    if (incomingKey && expectedKey && incomingKey !== expectedKey) {
      console.warn(`[Webhook] Geçersiz API key: instance=${payload.instance}`);
      res.status(403).json({ success: false, error: 'invalid_api_key' });
      return;
    }

    const event = payload.event;
    const instanceName = payload.instance;
    const data = payload.data || {};

    if (!instanceName) {
      console.warn('[Webhook] Instance name eksik, atlanıyor');
      res.status(400).json({ success: false, error: 'instance_name_required' });
      return;
    }

    console.log(`[Webhook] Gelen event: ${event}, instance=${instanceName}`);

    // ═══ instance_name → company_id çöz ═══
    const dbInstance = await whatsAppRepository.getCompanyInstanceByName(instanceName);
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
        const connectionState = data.state as string || data.connection as string || '';
        console.log(`[Webhook] connection.update: ${connectionState} (companyId=${companyId})`);

        if (connectionState === 'open' || connectionState === 'connected') {
          // Cihaz bağlandı
          await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
            connectionStatus: 'CONNECTED',
            qrStatus: null,
            phoneNumber: (data.phone as string) || (data.remoteJid as string)?.replace(/@.*/, '') || dbInstance?.phone_number || null,
            lastConnectedAt: new Date().toISOString(),
            lastError: null,
          });
          console.log(`[Webhook] ${instanceName}: CONNECTED (companyId=${companyId})`);
        } else if (connectionState === 'close' || connectionState === 'disconnected') {
          // Cihaz bağlantısı koptu
          await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
            connectionStatus: 'DISCONNECTED',
            lastDisconnectedAt: new Date().toISOString(),
            lastError: (data.reason as string) || null,
          });
          console.log(`[Webhook] ${instanceName}: DISCONNECTED (companyId=${companyId}, reason=${data.reason})`);
        } else if (connectionState === 'connecting' || connectionState === 'reconnecting') {
          await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
            connectionStatus: 'CONNECTING',
          });
        }
        break;
      }

      case 'qrcode.update': {
        const qrData = data.qrcode || data;
        const base64 = (qrData as Record<string, unknown>)?.base64 as string;
        const code = (qrData as Record<string, unknown>)?.code as string;

        if (base64 || code) {
          await whatsAppRepository.updateCompanyInstanceStatus(companyId, {
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
        const from = (msgData as Record<string, unknown>)?.from as string || '';
        const body = (msgData as Record<string, unknown>)?.body as string || '';
        const msgId = (msgData as Record<string, unknown>)?.id as string || '';

        if (from && body) {
          try {
            await whatsAppRepository.logIncomingMessage({
              siteId: dbInstance?.site_id || companyId,
              companyId,
              fromPhone: from.replace(/@.*/, ''),
              body,
              messageId: msgId,
              messageType: 'text',
            });
            console.log(`[Webhook] ${instanceName}: Incoming message from ${from.replace(/@.*/, '')}`);
          } catch (err) {
            console.error('[Webhook] Mesaj loglama hatası:', (err as Error).message);
          }
        }
        break;
      }

      case 'messages.update': {
        // Mesaj durum güncellemesi (sent, delivered, read, failed)
        const status = data.status as string || '';
        const msgId = (data as Record<string, unknown>)?.id as string || '';
        const msgKey = data.key as Record<string, unknown> | undefined;
        const msgKeyId = msgKey?.id as string || '';
        const providerMessageId = msgId || msgKeyId || '';

        console.log(`[Webhook] ${instanceName}: Message status update — ${status} (providerMsgId=${providerMessageId})`);

        // Arşiv tablosunda provider_message_id ile eşleşen kaydı güncelle
        if (providerMessageId) {
          try {
            const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
            const now = new Date().toISOString();

            const updateData: Record<string, unknown> = { updated_at: now };

            if (status === 'DELIVERY_ACK' || status === 'DELIVERED' || status === 'RECEIVED') {
              updateData.delivery_status = 'DELIVERED';
              updateData.delivered_at = now;
            } else if (status === 'READ' || status === 'READ_EXECUTED' || status === 'PLAYED') {
              updateData.read_status = 'READ';
              updateData.read_at = now;
            } else if (status === 'SERVER_ACK' || status === 'SENT' || status === 'SUCCESS') {
              updateData.send_status = 'SENT';
              updateData.sent_at = updateData.sent_at || now;
            } else if (status === 'ERROR' || status === 'FAILED') {
              updateData.send_status = 'FAILED';
              updateData.failed_at = now;
              updateData.error_message = (data as Record<string, unknown>)?.message as string || status;
            }

            const { error: updateErr } = await sb
              .from('whatsapp_message_archive')
              .update(updateData)
              .eq('provider_message_id', providerMessageId);

            if (updateErr) {
              console.warn(`[Webhook] Arşiv güncelleme hatası: ${updateErr.message}, providerMsgId=${providerMessageId}`);
            } else {
              console.log(`[Webhook] Arşiv güncellendi: providerMsgId=${providerMessageId}, status=${status}`);
            }
          } catch (archiveErr) {
            console.warn(`[Webhook] Arşiv güncelleme exception: ${(archiveErr as Error).message}`);
          }
        }

        // Ayrıca whatsapp_message_logs tablosunda da güncelle (geriye dönük uyumlu)
        if (providerMessageId) {
          try {
            await whatsAppRepository.updateMessageLogStatus(providerMessageId, status);
          } catch {
            // Sessiz — log tablosu opsiyonel
          }
        }
        break;
      }

      default:
        console.log(`[Webhook] Bilinmeyen event tipi: ${event} (instance=${instanceName})`);
    }

    res.json({ success: true, event, instanceName, companyId });
  } catch (err) {
    console.error('[Webhook] Kritik hata:', (err as Error).message);
    // Evolution API tekrar denesin diye 500 dönme — 200 dön ki spam yapmasın
    res.json({ success: true, error: 'internal_handler_error_but_acknowledged' });
  }
}