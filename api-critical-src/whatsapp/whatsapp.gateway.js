"use strict";
/**
 * WhatsApp WebSocket Gateway — React frontend'e canlı event iletimi.
 *
 * ws kütüphanesi kullanır. Express HTTP sunucusuna bağlanır.
 * Client bağlantılarını yönetir, oda bazlı (siteId) yayın yapar.
 * SOLID: Single Responsibility — sadece WebSocket iletişimi.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsAppGateway = exports.WhatsAppGateway = void 0;
const ws_1 = require("ws");
class WhatsAppGateway {
    wss = null;
    clients = new Map();
    pingInterval = null;
    // ═════════════════════════════════════════════════
    //  Public API
    // ═════════════════════════════════════════════════
    /** HTTP sunucusuna WebSocket sunucusunu bağla */
    attach(server, path = '/ws/whatsapp') {
        if (this.wss) {
            console.warn('[WhatsAppGateway] WebSocket zaten bağlı.');
            return;
        }
        this.wss = new ws_1.Server({ server, path });
        console.log(`[WhatsAppGateway] WebSocket başlatıldı: ${path}`);
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });
        // Heartbeat — kopuk bağlantıları temizle
        this.pingInterval = setInterval(() => {
            this.wss?.clients.forEach((ws) => {
                const client = this.clients.get(ws);
                if (client && Date.now() - client.connectedAt > 300_000) {
                    // 5 dakikadan uzun süredir ping alınamıyorsa
                }
                ws.ping();
            });
        }, 30_000);
        this.wss.on('close', () => {
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }
        });
    }
    /** WebSocket sunucusunu kapat */
    detach() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clients.forEach((client) => {
            try {
                client.ws.close(1001, 'Sunucu kapatılıyor.');
            }
            catch { /* skip */ }
        });
        this.clients.clear();
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        console.log('[WhatsAppGateway] WebSocket kapatıldı.');
    }
    /**
     * Belirli bir site'ye abone olan tüm istemcilere event yayınla.
     * Bu fonksiyon WhatsAppManager tarafından çağrılır.
     */
    broadcast = (event) => {
        if (!this.wss)
            return;
        const payload = JSON.stringify(event);
        this.clients.forEach((client, ws) => {
            if (ws.readyState !== ws_1.WebSocket.OPEN)
                return;
            // siteId eşleşmesi veya tümüne abone
            if (client.subscribedAll || client.siteIds.has(event.siteId)) {
                try {
                    ws.send(payload);
                }
                catch (err) {
                    console.error('[WhatsAppGateway] send error:', err.message);
                }
            }
        });
    };
    /**
     * Belirli bir site'ye tek seferlik event gönder (dışarıdan kullanım için).
     */
    sendToSite(siteId, event, data) {
        this.broadcast({
            siteId,
            event,
            data,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Tüm bağlı istemcilere event gönder.
     */
    sendToAll(event, data) {
        if (!this.wss)
            return;
        const payload = JSON.stringify({
            siteId: '*',
            event,
            data,
            timestamp: new Date().toISOString(),
        });
        this.clients.forEach((client, ws) => {
            if (ws.readyState === ws_1.WebSocket.OPEN) {
                try {
                    ws.send(payload);
                }
                catch { /* skip */ }
            }
        });
    }
    /** Bağlı istemci sayısı */
    get connectedClients() {
        return this.clients.size;
    }
    // ═════════════════════════════════════════════════
    //  Private: Bağlantı Yönetimi
    // ═════════════════════════════════════════════════
    handleConnection(ws, _req) {
        const wsClient = {
            ws,
            siteIds: new Set(),
            subscribedAll: false,
            connectedAt: Date.now(),
        };
        this.clients.set(ws, wsClient);
        console.log(`[WhatsAppGateway] Yeni bağlantı. Toplam: ${this.clients.size}`);
        // Karşılama mesajı
        ws.send(JSON.stringify({
            siteId: 'system',
            event: 'status',
            data: {
                status: 'connected',
                message: 'WhatsApp WebSocket Gateway\'e bağlandınız.',
                clientCount: this.clients.size,
            },
            timestamp: new Date().toISOString(),
        }));
        ws.on('message', (raw) => {
            this.handleMessage(ws, wsClient, raw);
        });
        ws.on('close', () => {
            this.clients.delete(ws);
            console.log(`[WhatsAppGateway] Bağlantı kapandı. Kalan: ${this.clients.size}`);
        });
        ws.on('error', (err) => {
            console.error('[WhatsAppGateway] WebSocket error:', err.message);
            this.clients.delete(ws);
        });
    }
    handleMessage(ws, client, raw) {
        try {
            const msg = JSON.parse(raw.toString());
            const action = msg.action;
            const siteId = msg.siteId;
            switch (action) {
                case 'subscribe':
                    // Belirli bir site'ye abone ol
                    if (siteId && typeof siteId === 'string') {
                        client.siteIds.add(siteId);
                        ws.send(JSON.stringify({
                            siteId,
                            event: 'status',
                            data: { subscribed: true, siteId },
                            timestamp: new Date().toISOString(),
                        }));
                    }
                    break;
                case 'unsubscribe':
                    if (siteId && typeof siteId === 'string') {
                        client.siteIds.delete(siteId);
                        ws.send(JSON.stringify({
                            siteId,
                            event: 'status',
                            data: { subscribed: false, siteId },
                            timestamp: new Date().toISOString(),
                        }));
                    }
                    break;
                case 'subscribe_all':
                    client.subscribedAll = true;
                    ws.send(JSON.stringify({
                        siteId: 'system',
                        event: 'status',
                        data: { subscribed: 'all' },
                        timestamp: new Date().toISOString(),
                    }));
                    break;
                case 'ping':
                    ws.send(JSON.stringify({
                        siteId: 'system',
                        event: 'status',
                        data: { pong: true },
                        timestamp: new Date().toISOString(),
                    }));
                    break;
                default:
                    console.log(`[WhatsAppGateway] Bilinmeyen aksiyon: ${action}`);
            }
        }
        catch {
            console.error('[WhatsAppGateway] Geçersiz mesaj formatı.');
        }
    }
}
exports.WhatsAppGateway = WhatsAppGateway;
/** Singleton gateway instance */
exports.whatsAppGateway = new WhatsAppGateway();
//# sourceMappingURL=whatsapp.gateway.js.map