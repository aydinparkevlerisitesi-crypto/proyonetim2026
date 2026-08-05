/**
 * WhatsApp Compatibility Adapter — Canlı Radore /api/instance/* bridge endpoint'leri
 * ve JSONL log helper fonksiyonları.
 *
 * Bu modül, eski relay sunucuları ve webhook callback'lerinin kullandığı
 * /api/instance/* endpoint'lerini mevcut /api/whatsapp/* endpoint'lerine
 * yönlendirir. Ayrıca mesaj gönderim loglama ve delivery tracking için
 * yardımcı fonksiyonlar sağlar.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { authMiddleware, AuthenticatedRequest } from '../../middleware/auth';
import {
  multiTenantConnect,
  multiTenantStatus,
  multiTenantDisconnect,
  sendEvolutionTextMessage,
} from './whatsapp.service';
import { resolveCompanyContext } from './whatsapp.helpers';
import { createServerSupabaseClient } from '../../lib/supabase';
import { config } from '../../config';

// ═══════════════════════════════════════════════════
//  JSONL LOG HELPERLAR (Canlı index.ts inline fonksiyonları)
// ═══════════════════════════════════════════════════

const LOG_DIR = '/var/www/proyonetim/api/logs';

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // sessiz
  }
}

/**
 * WhatsApp log dosyası yolunu döndür.
 * Canlı: waLogFile()
 */
export function waLogFile(siteId?: string): string {
  ensureLogDir();
  const suffix = siteId ? `-${siteId}` : '';
  return path.join(LOG_DIR, `whatsapp-send${suffix}.jsonl`);
}

/**
 * Generic JSONL append.
 * Canlı: appendJsonl()
 */
export function appendJsonl(filePath: string, record: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ...record, _ts: new Date().toISOString() }) + '\n';
    fs.appendFileSync(filePath, line);
  } catch {
    // sessiz
  }
}

/**
 * Generic JSONL read.
 * Canlı: readJsonl()
 */
export function readJsonl(filePath: string, limit: number = 500): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * WhatsApp send log'a kayıt ekle.
 * Canlı: appendWhatsAppSendLog()
 */
export function appendWhatsAppSendLog(
  siteId: string,
  record: {
    phone: string;
    message: string;
    status: string;
    providerMessageId?: string;
    error?: string;
    instanceName?: string;
  },
): void {
  const file = waLogFile(siteId);
  appendJsonl(file, { siteId, ...record });
}

/**
 * WhatsApp send log kayıtlarını oku.
 * Canlı: readWhatsAppSendLogs()
 */
export function readWhatsAppSendLogs(siteId: string, limit: number = 100): Array<Record<string, unknown>> {
  return readJsonl(waLogFile(siteId), limit);
}

/**
 * Webhook status string'ini normalize et.
 * Canlı: normalizeWaStatus()
 */
export function normalizeWaStatus(raw: string): string {
  const s = String(raw || '').toUpperCase().trim();
  if (s === 'OPEN' || s === 'CONNECTED') return 'CONNECTED';
  if (s === 'CLOSE' || s === 'DISCONNECTED') return 'DISCONNECTED';
  if (s === 'QRCODE' || s === 'QR') return 'QR_READY';
  if (s === 'CONNECTING') return 'CONNECTING';
  if (s === 'SERVER_ACK' || s === 'SENT' || s === 'SUCCESS') return 'SENT';
  if (s === 'DELIVERY_ACK' || s === 'DELIVERED' || s === 'RECEIVED') return 'DELIVERED';
  if (s === 'READ' || s === 'READ_EXECUTED') return 'READ';
  if (s === 'ERROR' || s === 'FAILED') return 'FAILED';
  return s || 'UNKNOWN';
}

/**
 * Evolution webhook payload'ından temel veriyi çıkar.
 * Canlı: extractWaWebhook()
 */
export function extractWaWebhook(body: Record<string, unknown>): {
  event: string;
  instance: string;
  state?: string;
  phone?: string;
  qrCode?: string;
  messageId?: string;
  status?: string;
} {
  const event = String(body.event || '');
  const instance = String(body.instance || '');
  const data = (body.data || {}) as Record<string, unknown>;

  return {
    event,
    instance,
    state: data.state as string || data.connection as string,
    phone: data.phone as string || data.number as string || data.remoteJid as string,
    qrCode: (data.qrcode as Record<string, unknown>)?.base64 as string || data.qrcode as string,
    messageId: ((data.key as Record<string, unknown>)?.id as string) || (data.id as string),
    status: data.status as string,
  };
}

/**
 * Delivery summary oluştur (archive + JSONL log birleşimi).
 * Canlı: getDeliverySummary()
 */
export async function getDeliverySummary(
  companyId: string,
  siteId: string,
  hours: number = 24,
): Promise<{
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  byHour: Array<{ hour: string; sent: number; failed: number }>;
}> {
  try {
    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('whatsapp_message_archive')
      .select('send_status, delivery_status, read_status, sent_at, failed_at')
      .eq('company_id', companyId)
      .eq('site_id', siteId)
      .or(`sent_at.gte.${since},failed_at.gte.${since}`);

    if (error) {
      console.warn('[getDeliverySummary] DB hatası:', error.message);
      return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, byHour: [] };
    }

    const rows = data || [];
    const summary = {
      total: rows.length,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
      byHour: [] as Array<{ hour: string; sent: number; failed: number }>,
    };

    const hourMap = new Map<string, { sent: number; failed: number }>();

    for (const row of rows) {
      const status = row.send_status;
      if (status === 'SENT') summary.sent++;
      else if (status === 'FAILED') summary.failed++;
      else if (status === 'PENDING') summary.pending++;

      if (row.delivery_status === 'DELIVERED') summary.delivered++;
      if (row.read_status === 'READ') summary.read++;

      const ts = row.sent_at || row.failed_at || since;
      const hour = ts.slice(0, 13) + ':00';
      const h = hourMap.get(hour) || { sent: 0, failed: 0 };
      if (status === 'SENT') h.sent++;
      else if (status === 'FAILED') h.failed++;
      hourMap.set(hour, h);
    }

    summary.byHour = Array.from(hourMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, counts]) => ({ hour, ...counts }));

    return summary;
  } catch (err) {
    console.warn('[getDeliverySummary] Exception:', (err as Error).message);
    return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, byHour: [] };
  }
}

// ═══════════════════════════════════════════════════
//  COMPATIBILITY BRIDGE ROUTER
//  Eski /api/instance/* endpoint'leri → yeni /api/whatsapp/*
// ═══════════════════════════════════════════════════

const compatRouter = Router();

/**
 * POST /api/instance/connect/:siteId
 * Bridge → POST /api/whatsapp/site/connect
 */
compatRouter.post('/connect/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const { phoneNumber } = req.body as { phoneNumber?: string };

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
      return;
    }

    const result = await multiTenantConnect({ token, siteId, phoneNumber });
    const statusCode = result.success
      ? 200
      : result.errorType === 'auth_required' ? 401
      : result.errorType === 'rate_limit' ? 429
      : result.errorType === 'evolution_unreachable' || result.errorType === 'evolution_timeout' ? 503
      : 500;

    res.status(statusCode).json(result);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(503).json({ success: false, error: msg, userMessage: `WhatsApp servisi şu anda ulaşılamıyor: ${msg}` });
  }
});

/**
 * GET /api/instance/status/:siteId
 * Bridge → GET /api/whatsapp/site/status
 */
compatRouter.get('/status/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ success: false, status: 'DISCONNECTED', error: 'auth_required' });
      return;
    }

    const result = await multiTenantStatus(token, siteId);
    res.json(result);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, status: 'DISCONNECTED', error: msg });
  }
});

/**
 * POST /api/instance/send-text/:siteId
 * Bridge → POST /api/whatsapp/site/direct-send
 */
compatRouter.post('/send-text/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const { phone, message, to } = req.body as { phone?: string; message?: string; to?: string };

    const targetPhone = phone || to || '';

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required', userMessage: 'Yetkilendirme gerekli.' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed', userMessage: 'Yetkilendirme başarısız.' });
      return;
    }

    if (!targetPhone || !message) {
      res.status(400).json({ success: false, error: 'missing_fields', userMessage: 'Telefon ve mesaj zorunludur.' });
      return;
    }

    const result = await sendEvolutionTextMessage(ctx.companyId, siteId, targetPhone, message);

    // Log to JSONL
    appendWhatsAppSendLog(siteId, {
      phone: targetPhone,
      message: message.substring(0, 200),
      status: result.success ? 'SENT' : 'FAILED',
      providerMessageId: result.providerMessageId || undefined,
      error: result.user_message || undefined,
      instanceName: result.instanceName || undefined,
    });

    const statusCode = result.success
      ? 200
      : (result.error_type === 'invalid_phone' || result.error_type === 'empty_message' ? 400 : 500);

    res.status(statusCode).json(result);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg, userMessage: `Gönderim hatası: ${msg}` });
  }
});

/**
 * POST /api/instance/disconnect/:siteId
 * Bridge → POST /api/whatsapp/site/disconnect
 */
compatRouter.post('/disconnect/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const result = await multiTenantDisconnect(token, siteId);
    res.json(result);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/instance/send-logs/:siteId
 * Bridge → JSONL log dosyası okuma
 */
compatRouter.get('/send-logs/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = readWhatsAppSendLogs(siteId, limit);
    res.json({ success: true, siteId, count: logs.length, logs });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/instance/webhook/evolution
 * Bridge → POST /api/whatsapp/webhook/evolution
 * Public — no auth (Evolution API key check inside)
 */
compatRouter.post('/webhook/evolution', async (req: Request, res: Response) => {
  try {
    // Forward to the existing webhook handler
    const { handleEvolutionWebhook } = await import('./whatsapp.webhook');
    await handleEvolutionWebhook(req, res);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error('[CompatWebhook] Hata:', msg);
    res.json({ success: true, error: 'internal_error_but_acknowledged' });
  }
});

/**
 * GET /api/instance/delivery-report/:siteId
 * Bridge → delivery summary
 */
compatRouter.get('/delivery-report/:siteId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const hours = parseInt(req.query.hours as string) || 24;

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    const summary = await getDeliverySummary(ctx.companyId, siteId, hours);
    res.json({ success: true, siteId, companyId: ctx.companyId, hours, summary });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

export default compatRouter;
export { compatRouter as whatsappCompatRouter };