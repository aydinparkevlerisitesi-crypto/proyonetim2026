import type { SessionStatus, ClientConfig, SessionInfo, WsEventPayload, WsEventType } from './whatsapp.types';
import { whatsAppRepository } from './whatsapp.repository';
export type WsBroadcastFn = (event: WsEventPayload) => void;
export class WhatsAppClient {
  public readonly siteId: string;
  public readonly companyId: string | undefined;
  public readonly sessionPath: string;
  private status: SessionStatus = 'DISCONNECTED';
  private phoneNumber: string | null = null;
  private broadcastFn: WsBroadcastFn | null = null;
  private destroyed: boolean = false;
  constructor(config: ClientConfig) {
    this.siteId = config.siteId;
    this.companyId = config.companyId;
    this.sessionPath = config.sessionPath;
  }
  setBroadcast(fn: WsBroadcastFn): void { this.broadcastFn = fn; }
  async connect(): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
  }
  async disconnect(): Promise<void> { this.status = 'DISCONNECTED'; }
  async reconnect(): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
  }
  async sendMessage(_phone: string, _message: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
  }
  getSessionInfo(): SessionInfo {
    return { siteId: this.siteId, companyId: this.companyId, status: this.status, phoneNumber: null, profileName: null, battery: null, lastSeen: null, connectedAt: null, sessionAge: 0, qrCode: null, error: null, createdAt: Date.now(), lastActivity: Date.now() };
  }
  getStatus(): SessionStatus { return this.status; }
  getQrCode(): string | null { return null; }
  getPhoneNumber(): string | null { return null; }
  isConnected(): boolean { return false; }
  async destroy(): Promise<void> { this.destroyed = true; this.broadcastFn = null; }
}
