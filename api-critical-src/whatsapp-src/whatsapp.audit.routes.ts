/**
 * WhatsApp Audit Routes — Mesaj gönderim denetim (audit) middleware ve endpoint'leri.
 *
 * Canlı Radore'da whatsappAuditSendCapture middleware'i tüm gönderim
 * isteklerini yakalar ve audit log'a yazar.
 *
 * SOURCE OF TRUTH: Canlı Radore davranışı korunur.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../../middleware/auth';
import { createServerSupabaseClient } from '../../lib/supabase';
import { config } from '../../config';
import { resolveCompanyContext } from './whatsapp.helpers';
import { appendJsonl, readJsonl } from './whatsapp.compat';

// ═══════════════════════════════════════════════════
//  AUDIT LOG HELPERLAR
// ═══════════════════════════════════════════════════

const AUDIT_LOG_DIR = '/var/www/proyonetim/api/logs';

function ensureAuditDir(): void {
  try {
    const fs = require('fs');
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
      fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    }
  } catch {
    // sessiz
  }
}

function auditLogFile(siteId?: string): string {
  ensureAuditDir();
  const { path } = require('path');
  const suffix = siteId ? `-${siteId}` : '';
  return path.join(AUDIT_LOG_DIR, `whatsapp-audit${suffix}.jsonl`);
}

function appendAuditLog(record: Record<string, unknown>): void {
  appendJsonl(auditLogFile(), record);
}

function readAuditLogs(limit: number = 500): Array<Record<string, unknown>> {
  return readJsonl(auditLogFile(), limit);
}

// ═══════════════════════════════════════════════════
//  AUDIT SEND CAPTURE MIDDLEWARE
//  Tüm /api/instance/* ve /api/whatsapp/* send endpoint'lerini
//  yakalar ve audit log'a yazar.
// ═══════════════════════════════════════════════════

/**
 * whatsappAuditSendCapture middleware.
 * Canlı: app.use(whatsappAuditSendCapture)
 *
 * Bu middleware, response tamamlandıktan sonra gönderim isteklerini
 * yakalar ve hem JSONL dosyasına hem de DB'ye audit kaydı yazar.
 */
export function whatsappAuditSendCapture(req: Request, res: Response, next: NextFunction): void {
  // Sadece POST isteklerini ve send/connect/reconnect endpoint'lerini yakala
  const isRelevant = req.method === 'POST' &&
    /\/(send|send-text|direct-send|bulk-send|connect|reconnect)/.test(req.path);

  if (!isRelevant) {
    next();
    return;
  }

  const startTime = Date.now();
  const originalEnd = res.end.bind(res);
  const originalJson = res.json.bind(res);

  let responseBody: unknown = null;

  // res.json() override — response body'i yakala
  res.json = function(body: unknown): Response {
    responseBody = body;
    return originalJson(body);
  };

  // res.end() override — response bittiğinde logla
  res.end = function(chunk?: unknown, ...args: unknown[]): Response {
    const duration = Date.now() - startTime;
    const path = req.path;
    const siteId = (req.params.siteId as string)
      || (req.body?.siteId as string)
      || (req.query.siteId as string)
      || 'unknown';

    try {
      const auditRecord: Record<string, unknown> = {
        type: 'send_capture',
        method: req.method,
        path,
        siteId,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        requestBody: {
          phone: req.body?.phone || req.body?.phoneNumber || req.body?.to || null,
          messagePreview: req.body?.message ? String(req.body.message).substring(0, 100) : null,
          recipientCount: Array.isArray(req.body?.recipients) ? req.body.recipients.length : null,
        },
        responseStatus: res.statusCode,
        responsePreview: responseBody
          ? JSON.stringify(responseBody).substring(0, 500)
          : null,
        durationMs: duration,
      };

      appendAuditLog(auditRecord);

      // Ayrıca notification_delivery_logs tablosuna da yaz (async, non-blocking)
      writeDbAuditLog(siteId, auditRecord).catch(() => {
        // DB yazımı opsiyonel
      });
    } catch {
      // Audit log hatası request akışını bozmamalı
    }

    // Original end'i çağır
    if (chunk !== undefined) {
      return originalEnd(chunk, ...args);
    }
    return originalEnd();
  };

  next();
}

async function writeDbAuditLog(siteId: string, record: Record<string, unknown>): Promise<void> {
  try {
    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    await sb.from('notification_delivery_logs').insert({
      site_id: siteId,
      channel: 'whatsapp',
      event_type: record.type as string || 'send_capture',
      status_code: record.responseStatus as number || 0,
      request_preview: JSON.stringify(record.requestBody || {}),
      response_preview: JSON.stringify(record.responsePreview || {}),
      duration_ms: record.durationMs as number || 0,
      ip_address: record.ip as string || null,
      user_agent: record.userAgent as string || null,
    });
  } catch {
    // Sessiz
  }
}

// ═══════════════════════════════════════════════════
//  AUDIT ROUTER
// ═══════════════════════════════════════════════════

const router = Router();

/**
 * GET /api/instance/audit/logs
 * Son audit kayıtlarını döndür.
 */
router.get('/logs', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = readAuditLogs(limit);
    res.json({ success: true, count: logs.length, logs });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/instance/audit/:siteId
 * Belirli site için audit özetini döndür.
 */
router.get('/:siteId', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error, count } = await sb
      .from('notification_delivery_logs')
      .select('*', { count: 'exact' })
      .eq('site_id', siteId)
      .eq('channel', 'whatsapp')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Basit istatistikler
    const stats = {
      total: count || 0,
      success: 0,
      failed: 0,
      avgDurationMs: 0,
    };

    let totalDuration = 0;
    for (const row of data || []) {
      const status = row.status_code || 0;
      if (status >= 200 && status < 300) stats.success++;
      else if (status >= 400) stats.failed++;
      totalDuration += row.duration_ms || 0;
    }

    if ((data || []).length > 0) {
      stats.avgDurationMs = Math.round(totalDuration / (data || []).length);
    }

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      hours,
      stats,
      logs: data || [],
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/instance/audit/:siteId/stats
 * Site bazlı gönderim istatistikleri.
 */
router.get('/:siteId/stats', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const siteId = req.params.siteId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);

    if (!token) {
      res.status(401).json({ success: false, error: 'auth_required' });
      return;
    }

    const ctx = await resolveCompanyContext(token, siteId);
    if (!ctx) {
      res.status(401).json({ success: false, error: 'auth_failed' });
      return;
    }

    const sb = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Archive tablosundan gönderim istatistikleri
    const { data: archiveStats, error: archiveError } = await sb
      .from('whatsapp_message_archive')
      .select('send_status, delivery_status, read_status')
      .eq('company_id', ctx.companyId)
      .eq('site_id', siteId)
      .or(`sent_at.gte.${since},failed_at.gte.${since}`);

    if (archiveError) {
      res.status(500).json({ success: false, error: archiveError.message });
      return;
    }

    const stats = {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
      deliveryRate: 0,
      readRate: 0,
    };

    for (const row of archiveStats || []) {
      stats.total++;
      if (row.send_status === 'SENT') stats.sent++;
      else if (row.send_status === 'FAILED') stats.failed++;
      else if (row.send_status === 'PENDING') stats.pending++;

      if (row.delivery_status === 'DELIVERED') stats.delivered++;
      if (row.read_status === 'READ') stats.read++;
    }

    if (stats.sent > 0) {
      stats.deliveryRate = Math.round((stats.delivered / stats.sent) * 100);
      stats.readRate = Math.round((stats.read / stats.sent) * 100);
    }

    res.json({
      success: true,
      siteId,
      companyId: ctx.companyId,
      hours,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
export { router as whatsappAuditRouter };