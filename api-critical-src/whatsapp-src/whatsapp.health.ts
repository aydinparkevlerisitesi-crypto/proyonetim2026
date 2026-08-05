/**
 * WhatsApp Health Check (Baileys) — Puppeteer/Chrome bağımsız.
 *
 * v4.0 Enterprise — Yeni SessionHealth ve FullHealthReport tiplerini kullanır.
 * Hem eski session hem de yeni client formatını destekler.
 */

import type { SessionHealth, FullHealthReport } from './whatsapp.types';

// ─── Session sağlık kontrolü ─────────────────────

export function getSessionHealth(
  sessions: Map<
    string,
    {
      status: string;
      phoneNumber: string | null;
      qrCode: string | null;
      connectedAt: string | null;
      lastActivity: number;
    }
  >,
): SessionHealth[] {
  const now = Date.now();
  const health: SessionHealth[] = [];

  for (const [companyId, session] of sessions) {
    const uptime = session.connectedAt
      ? Math.floor((now - new Date(session.connectedAt).getTime()) / 1000)
      : 0;

    health.push({
      siteId: companyId,
      companyId,
      status: session.status,
      uptime,
      phoneNumber: session.phoneNumber,
      profileName: null,
      battery: null,
      lastSeen: null,
      hasQr: !!session.qrCode,
      lastActivity: session.lastActivity,
    });
  }

  return health;
}

// ─── Tam health raporu ───────────────────────────

export function getServiceHealth(
  sessions: Map<
    string,
    {
      status: string;
      phoneNumber: string | null;
      qrCode: string | null;
      connectedAt: string | null;
      lastActivity: number;
    }
  >,
): FullHealthReport {
  const sessionHealth = getSessionHealth(sessions);
  const hasActiveConnection = sessionHealth.some(
    (s) => s.status === 'CONNECTED' || s.status === 'WAITING_QR',
  );

  return {
    timestamp: new Date().toISOString(),
    service: 'proyonetim-whatsapp-gateway',
    provider: 'baileys',
    baileys_connected: hasActiveConnection,
    sessions: sessionHealth,
    totalSessions: sessionHealth.length,
    bridge: 'radore-api',
    version: '4.0.0-enterprise',
    uptime: 0,
  };
}

export type { SessionHealth, FullHealthReport };