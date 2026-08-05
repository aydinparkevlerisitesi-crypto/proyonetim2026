/**
 * WhatsApp WebSocket Gateway — React frontend'e canlı event iletimi.
 *
 * ws kütüphanesi kullanır. Express HTTP sunucusuna bağlanır.
 * Client bağlantılarını yönetir, oda bazlı (siteId) yayın yapar.
 * SOLID: Single Responsibility — sadece WebSocket iletişimi.
 */

import { Server as WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type {
  WsEventPayload,
  WsEventType,
  WsQrPayload,
  WsReadyPayload,
  WsStatePayload,
  WsMessagePayload,
  WsDisconnectedPayload,
  WsAuthFailurePayload,
  WsStatusPayload,
} from './whatsapp.types';

// ─── Bağlı client yapısı ─────────────────────────
interface WsClient {
  ws: WebSocket;
  siteIds: Set<string>;
  subscribedAll: boolean;
  connectedAt: number;
}

export class WhatsAppGateway {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, WsClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  // ═════════════════════════════════════════════════
  //  Public API
  // ═════════════════════════════════════════════════

  /** HTTP sunucusuna WebSocket sunucusunu bağla */
  attach(server: HttpServer, path: string = '/ws/whatsapp'): void {
    if (this.wss) {
      console.warn('[WhatsAppGateway] WebSocket zaten bağlı.');
      return;
    }

    this.wss = new WebSocketServer({ server, path });
    console.log(`[WhatsAppGateway] WebSocket başlatıldı: ${path}`);

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
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
  detach(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.clients.forEach((client) => {
      try { client.ws.close(1001, 'Sunucu kapatılıyor.'); } catch { /* skip */ }
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
  broadcast: (event: WsEventPayload) => void = (event: WsEventPayload) => {
    if (!this.wss) return;

    const payload = JSON.stringify(event);

    this.clients.forEach((client, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // siteId eşleşmesi veya tümüne abone
      if (client.subscribedAll || client.siteIds.has(event.siteId)) {
        try {
          ws.send(payload);
        } catch (err) {
          console.error('[WhatsAppGateway] send error:', (err as Error).message);
        }
      }
    });
  };

  /**
   * Belirli bir site'ye tek seferlik event gönder (dışarıdan kullanım için).
   */
  sendToSite(siteId: string, event: WsEventType, data: unknown): void {
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
  sendToAll(event: WsEventType, data: unknown): void {
    if (!this.wss) return;

    const payload = JSON.stringify({
      siteId: '*',
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    this.clients.forEach((client, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch { /* skip */ }
      }
    });
  }

  /** Bağlı istemci sayısı */
  get connectedClients(): number {
    return this.clients.size;
  }

  // ═════════════════════════════════════════════════
  //  Private: Bağlantı Yönetimi
  // ═════════════════════════════════════════════════

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const wsClient: WsClient = {
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

    ws.on('message', (raw: Buffer | string) => {
      this.handleMessage(ws, wsClient, raw);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WhatsAppGateway] Bağlantı kapandı. Kalan: ${this.clients.size}`);
    });

    ws.on('error', (err: Error) => {
      console.error('[WhatsAppGateway] WebSocket error:', err.message);
      this.clients.delete(ws);
    });
  }

  private handleMessage(ws: WebSocket, client: WsClient, raw: Buffer | string): void {
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
    } catch {
      console.error('[WhatsAppGateway] Geçersiz mesaj formatı.');
    }
  }
}

/** Singleton gateway instance */
export const whatsAppGateway = new WhatsAppGateway();