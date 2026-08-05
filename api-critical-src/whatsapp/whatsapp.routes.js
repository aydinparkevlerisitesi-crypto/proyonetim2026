"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const whatsapp_controller_1 = require("./whatsapp.controller");
const whatsapp_webhook_1 = require("./whatsapp.webhook"); // ← Multi-tenant webhook handler
const whatsapp_compat_1 = __importDefault(require("./whatsapp.compat"));
const router = (0, express_1.Router)();
// ═══════════════════════════════════════════════════
//  Evolution Webhook (public — Evolution API buraya bildirim gönderir)
//  No auth — Evolution API key doğrulaması handler içinde yapılır
// ═══════════════════════════════════════════════════
router.post('/webhook/evolution', whatsapp_webhook_1.handleEvolutionWebhook);
// ═══════════════════════════════════════════════════
//  Health (no auth)
// ═══════════════════════════════════════════════════
router.get('/health', whatsapp_controller_1.handleHealth);
router.get('/health/enterprise', whatsapp_controller_1.handleEnterpriseHealth);
router.get('/diagnostics', whatsapp_controller_1.handleDiagnostics);
router.post('/diagnostics/heal', auth_1.authMiddleware, whatsapp_controller_1.handleHeal);
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
router.post('/site/connect', auth_1.authMiddleware, whatsapp_controller_1.handleSiteConnect);
router.post('/site/status', auth_1.authMiddleware, whatsapp_controller_1.handleSiteStatus);
router.get('/site/qr', auth_1.authMiddleware, whatsapp_controller_1.handleSiteQr);
router.post('/site/disconnect', auth_1.authMiddleware, whatsapp_controller_1.handleSiteDisconnect);
router.post('/site/reconnect', auth_1.authMiddleware, whatsapp_controller_1.handleSiteReconnect);
router.get('/site/diagnostics', auth_1.authMiddleware, whatsapp_controller_1.handleSiteDiagnostics);
// ═══════════════════════════════════════════════════
//  YENİ: Site Bazlı Mesaj Gönderimi
// ═══════════════════════════════════════════════════
router.post('/site/send', auth_1.authMiddleware, whatsapp_controller_1.handleSiteSend);
router.post('/site/bulk-send', auth_1.authMiddleware, whatsapp_controller_1.handleSiteBulkSend);
router.post('/site/direct-send', auth_1.authMiddleware, whatsapp_controller_1.handleSiteDirectSend);
// ═══════════════════════════════════════════════════
//  Archive Doğrulama (Canlı Gönderim Testi)
// ═══════════════════════════════════════════════════
router.get('/site/archive/verify', auth_1.authMiddleware, whatsapp_controller_1.handleArchiveVerify);
// ═══════════════════════════════════════════════════
//  Company Bazlı (Geriye Dönük Uyumlu)
// ═══════════════════════════════════════════════════
router.post('/company/connect', auth_1.authMiddleware, whatsapp_controller_1.handleConnect);
router.get('/company/status', auth_1.authMiddleware, whatsapp_controller_1.handleStatus);
router.get('/company/qr', auth_1.authMiddleware, whatsapp_controller_1.handleQr);
router.post('/company/disconnect', auth_1.authMiddleware, whatsapp_controller_1.handleDisconnect);
router.post('/company/reconnect', auth_1.authMiddleware, whatsapp_controller_1.handleReconnect);
// ═══════════════════════════════════════════════════
//  Mesaj (Geriye Dönük Uyumlu)
// ═══════════════════════════════════════════════════
router.post('/send', auth_1.authMiddleware, whatsapp_controller_1.handleSend);
router.post('/bulk/send', auth_1.authMiddleware, whatsapp_controller_1.handleBulkSend);
router.post('/direct/send', auth_1.authMiddleware, whatsapp_controller_1.handleDirectSend);
// ═══════════════════════════════════════════════════
//  Session & Queue
// ═══════════════════════════════════════════════════
router.get('/sessions', auth_1.authMiddleware, whatsapp_controller_1.handleSessionList);
router.get('/queue/stats', auth_1.authMiddleware, whatsapp_controller_1.handleQueueStats);
// ═══════════════════════════════════════════════════
//  WhatsApp Compatibility Router (public bridge for /api/instance/*)
// ═══════════════════════════════════════════════════
// Mount compatibility routes at the end so they don't override primary routes
router.use('/', whatsapp_compat_1.default);
// ═══════════════════════════════════════════════════
//  HİBRİT MİMARİ: Kanal Yönetimi
// ═══════════════════════════════════════════════════
router.get('/channels', auth_1.authMiddleware, whatsapp_controller_1.handleGetChannels);
router.post('/channels/default', auth_1.authMiddleware, whatsapp_controller_1.handleSetDefaultChannel);
// ═══════════════════════════════════════════════════
//  Geriye dönük uyumluluk (eski endpoint'ler)
// ═══════════════════════════════════════════════════
router.post('/start', auth_1.authMiddleware, whatsapp_controller_1.handleConnect);
router.post('/status', auth_1.authMiddleware, async (req, res) => {
    const { company_id, site_id } = req.body;
    const targetId = company_id || site_id || '';
    if (!targetId) {
        res.status(400).json({ error: 'company_id veya site_id gerekli' });
        return;
    }
    const result = await Promise.resolve().then(() => __importStar(require('./whatsapp.service'))).then(m => m.getCompanyStatus(targetId));
    res.json({ session: result, bridge_available: result.bridge_available, bridge_status: result.status });
});
router.post('/qr', auth_1.authMiddleware, whatsapp_controller_1.handleQr);
router.post('/disconnect', auth_1.authMiddleware, whatsapp_controller_1.handleDisconnect);
router.post('/reconnect', auth_1.authMiddleware, whatsapp_controller_1.handleReconnect);
exports.default = router;
//# sourceMappingURL=whatsapp.routes.js.map