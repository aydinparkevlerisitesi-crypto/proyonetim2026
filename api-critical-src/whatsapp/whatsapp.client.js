"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClient = void 0;
class WhatsAppClient {
    siteId;
    companyId;
    sessionPath;
    status = 'DISCONNECTED';
    phoneNumber = null;
    broadcastFn = null;
    destroyed = false;
    constructor(config) {
        this.siteId = config.siteId;
        this.companyId = config.companyId;
        this.sessionPath = config.sessionPath;
    }
    setBroadcast(fn) { this.broadcastFn = fn; }
    async connect() {
        return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
    }
    async disconnect() { this.status = 'DISCONNECTED'; }
    async reconnect() {
        return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
    }
    async sendMessage(_phone, _message) {
        return { success: false, error: 'Kullanimdan kaldirildi. EvolutionClient kullanin.' };
    }
    getSessionInfo() {
        return { siteId: this.siteId, companyId: this.companyId, status: this.status, phoneNumber: null, profileName: null, battery: null, lastSeen: null, connectedAt: null, sessionAge: 0, qrCode: null, error: null, createdAt: Date.now(), lastActivity: Date.now() };
    }
    getStatus() { return this.status; }
    getQrCode() { return null; }
    getPhoneNumber() { return null; }
    isConnected() { return false; }
    async destroy() { this.destroyed = true; this.broadcastFn = null; }
}
exports.WhatsAppClient = WhatsAppClient;
//# sourceMappingURL=whatsapp.client.js.map