/**
 * WhatsApp Routes — Express Router.
 *
 * v4.0 Enterprise — Site bazlı ve company bazlı endpoint'ler.
 * Yeni /site/* endpoint'leri WhatsAppManager + WebSocket ile çalışır.
 * Eski endpoint'ler geriye dönük uyumlu olarak korunur.
 *
 * Endpoint'ler:
 *   Site Bazlı (Yeni):
 *     POST   /api/whatsapp/site/connect     → Site için QR bağlantı başlat
 *     GET    /api/whatsapp/site/status      → Site WhatsApp durumu
 *     GET    /api/whatsapp/site/qr          → Aktif QR kodu
 *     POST   /api/whatsapp/site/disconnect  → Bağlantıyı kes
 *     POST   /api/whatsapp/site/reconnect   → Yeniden bağlan
 *     POST   /api/whatsapp/site/send        → Kuyruğa mesaj ekle
 *     POST   /api/whatsapp/site/bulk-send   → Toplu mesaj
 *     POST   /api/whatsapp/site/direct-send → Direkt mesaj
 *
 *   Company Bazlı (Geriye Dönük):
 *     POST   /api/whatsapp/company/connect
 *     GET    /api/whatsapp/company/status
 *     GET    /api/whatsapp/company/qr
 *     POST   /api/whatsapp/company/disconnect
 *     POST   /api/whatsapp/company/reconnect
 *     POST   /api/whatsapp/send
 *     POST   /api/whatsapp/bulk/send
 *     POST   /api/whatsapp/direct/send
 *
 *   Genel:
 *     GET    /api/whatsapp/health             → Sistem sağlık kontrolü
 *     GET    /api/whatsapp/health/enterprise  → Enterprise sağlık raporu
 *     GET    /api/whatsapp/sessions           → Aktif oturum listesi
 *     GET    /api/whatsapp/queue/stats        → Kuyruk istatistikleri
 *     WS     /ws/whatsapp                     → WebSocket canlı event
 */

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth';
import {
  // Eski handler'lar
  handleConnect,
  handleStatus,
  handleQr,
  handleDisconnect,
  handleReconnect,
  handleSend,
  handleBulkSend,
  handleDirectSend,
  handleHealth,
  handleHeal,
  // Yeni handler'lar
  handleSiteConnect,
  handleSiteStatus,
  handleSiteQr,
  handleSiteDisconnect,
  handleSiteReconnect,
  handleSiteSend,
  handleSiteBulkSend,
  handleSiteDirectSend,
  handleEnterpriseHealth,
  handleSessionList,
  handleQueueStats,
  handleDiagnostics,
  handleSiteDiagnostics,
  // Hibrit Mimari: Kanal Yönetimi
  handleGetChannels,
  handleSetDefaultChannel,
  // Archive Doğrulama
  handleArchiveVerify,
} from './whatsapp.controller';
import { handleEvolutionWebhook } from './whatsapp.webhook';  // ← Multi-tenant webhook handler
import { sessionManager } from './whatsapp.session';
import compatRouter from './whatsapp.compat';

const router = Router();

// ═══════════════════════════════════════════════════
//  Evolution Webhook (public — Evolution API buraya bildirim gönderir)
//  No auth — Evolution API key doğrulaması handler içinde yapılır
// ═══════════════════════════════════════════════════

router.post('/webhook/evolution', handleEvolutionWebhook);

// ═══════════════════════════════════════════════════
//  Health (no auth)
// ═══════════════════════════════════════════════════

router.get('/health', handleHealth);
router.get('/health/enterprise', handleEnterpriseHealth);
router.get('/diagnostics', handleDiagnostics);
router.post('/diagnostics/heal', authMiddleware, handleHeal);

// ═══════════════════════════════════════════════════
//  OPTIONS Preflight — tüm /site/* endpoint'leri için
//  (CORS middleware global olarak OPTIONS'ı zaten handle eder,
//   ancak explicit tanımlama güvenlik ve debugging için)
// ═══════════════════════════════════════════════════

router.options('/site/connect', (_req, res) => {
  res.status(204).end();
});
router.options('/site/status', (_req, res) => {
  res.status(204).end();
});
router.options('/site/qr', (_req, res) => {
  res.status(204).end();
});
router.options('/site/disconnect', (_req, res) => {
  res.status(204).end();
});
router.options('/site/reconnect', (_req, res) => {
  res.status(204).end();
});

// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Bağlantı Yönetimi
// ═══════════════════════════════════════════════════

router.post('/site/connect', authMiddleware, handleSiteConnect);
router.post('/site/status', authMiddleware, handleSiteStatus);
router.get('/site/qr', authMiddleware, handleSiteQr);
router.post('/site/disconnect', authMiddleware, handleSiteDisconnect);
router.post('/site/reconnect', authMiddleware, handleSiteReconnect);
router.get('/site/diagnostics', authMiddleware, handleSiteDiagnostics);

// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Mesaj Gönderimi
// ═══════════════════════════════════════════════════

router.post('/site/send', authMiddleware, handleSiteSend);
router.post('/site/bulk-send', authMiddleware, handleSiteBulkSend);
router.post('/site/direct-send', authMiddleware, handleSiteDirectSend);

// ═══════════════════════════════════════════════════
//  Archive Doğrulama (Canlı Gönderim Testi)
// ═══════════════════════════════════════════════════

router.get('/site/archive/verify', authMiddleware, handleArchiveVerify);

// ═══════════════════════════════════════════════════
//  Company Bazlı (Geriye Dönük Uyumlu)
// ═══════════════════════════════════════════════════

router.post('/company/connect', authMiddleware, handleConnect);
router.get('/company/status', authMiddleware, handleStatus);
router.get('/company/qr', authMiddleware, handleQr);
router.post('/company/disconnect', authMiddleware, handleDisconnect);
router.post('/company/reconnect', authMiddleware, handleReconnect);

// ═══════════════════════════════════════════════════
//  Mesaj (Geriye Dönük Uyumlu)
// ═══════════════════════════════════════════════════

router.post('/send', authMiddleware, handleSend);
router.post('/bulk/send', authMiddleware, handleBulkSend);
router.post('/direct/send', authMiddleware, handleDirectSend);

// ═══════════════════════════════════════════════════
//  Session & Queue
// ═══════════════════════════════════════════════════

router.get('/sessions', authMiddleware, handleSessionList);
router.get('/queue/stats', authMiddleware, handleQueueStats);

// ═══════════════════════════════════════════════════
//  WhatsApp Compatibility Router (public bridge for /api/instance/*)
// ═══════════════════════════════════════════════════

// Mount compatibility routes at the end so they don't override primary routes
router.use('/', compatRouter);

// ═══════════════════════════════════════════════════
//  HİBRİT MİMARİ: Kanal Yönetimi
// ═══════════════════════════════════════════════════

router.get('/channels', authMiddleware, handleGetChannels);
router.post('/channels/default', authMiddleware, handleSetDefaultChannel);

// ═══════════════════════════════════════════════════
//  Geriye dönük uyumluluk (eski endpoint'ler)
// ═══════════════════════════════════════════════════

router.post('/start', authMiddleware, handleConnect);
router.post('/status', authMiddleware, async (req, res) => {
  const { company_id, site_id } = req.body as { company_id?: string; site_id?: string };
  const targetId = company_id || site_id || '';
  if (!targetId) {
    res.status(400).json({ error: 'company_id veya site_id gerekli' });
    return;
  }
  const result = await import('./whatsapp.service').then(m => m.getCompanyStatus(targetId));
  res.json({ session: result, bridge_available: result.bridge_available, bridge_status: result.status });
});
router.post('/qr', authMiddleware, handleQr);
router.post('/disconnect', authMiddleware, handleDisconnect);
router.post('/reconnect', authMiddleware, handleReconnect);

export default router;