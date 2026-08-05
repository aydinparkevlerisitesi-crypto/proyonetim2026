"use strict";
/**
 * WhatsApp Health Check (Baileys) — Puppeteer/Chrome bağımsız.
 *
 * v4.0 Enterprise — Yeni SessionHealth ve FullHealthReport tiplerini kullanır.
 * Hem eski session hem de yeni client formatını destekler.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceHealth = exports.getSessionHealth = void 0;
// ─── Session sağlık kontrolü ─────────────────────
function getSessionHealth(sessions) {
    const now = Date.now();
    const health = [];
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
exports.getSessionHealth = getSessionHealth;
// ─── Tam health raporu ───────────────────────────
function getServiceHealth(sessions) {
    const sessionHealth = getSessionHealth(sessions);
    const hasActiveConnection = sessionHealth.some((s) => s.status === 'CONNECTED' || s.status === 'WAITING_QR');
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
exports.getServiceHealth = getServiceHealth;
//# sourceMappingURL=whatsapp.health.js.map