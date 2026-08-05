"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const fs = __importStar(require("fs"));
// ─── Session Manager ─────────────────────────────
class SessionManager {
    sessions = new Map();
    supabaseAdmin = null;
    getSupabaseAdmin() {
        if (!this.supabaseAdmin) {
            this.supabaseAdmin = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        }
        return this.supabaseAdmin;
    }
    /** Session key oluştur — firma bazlı */
    sessionKey(companyId) {
        return `proyonetim-company-${companyId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    }
    /** Auth state'in diske yazılacağı klasör yolu */
    sessionPath(companyId) {
        return `/opt/wpp-sessions/${this.sessionKey(companyId)}`;
    }
    /** Eski auth state klasörünü temizle */
    clearSessionPath(companyId) {
        const path = this.sessionPath(companyId);
        try {
            if (fs.existsSync(path)) {
                fs.rmSync(path, { recursive: true, force: true });
                console.log(`[SessionManager] Cleared auth state for ${companyId}`);
            }
        }
        catch (err) {
            console.error(`[SessionManager] Failed to clear auth state for ${companyId}:`, err.message);
        }
    }
    has(companyId) {
        return this.sessions.has(companyId);
    }
    get(companyId) {
        return this.sessions.get(companyId);
    }
    getAll() {
        return Array.from(this.sessions.entries()).map(([companyId, s]) => ({
            companyId,
            status: s.status,
            phoneNumber: s.phoneNumber,
        }));
    }
    set(companyId, session) {
        this.sessions.set(companyId, session);
    }
    /** Session'ı sil (bellekten, soketi kapat, DB'yi güncelle) */
    async destroy(companyId) {
        const session = this.sessions.get(companyId);
        if (session?.sock) {
            try {
                session.sock.end(undefined);
            }
            catch { /* skip */ }
        }
        this.sessions.delete(companyId);
        try {
            const sb = this.getSupabaseAdmin();
            await sb.from('whatsapp_sessions')
                .update({ status: 'DISCONNECTED', qr_code: null, error: null, updated_at: new Date().toISOString() })
                .eq('session_id', `company-${companyId}`);
        }
        catch (err) {
            console.error('[SessionManager] DB destroy error:', err.message);
        }
    }
    async destroyAll() {
        const ids = Array.from(this.sessions.keys());
        for (const id of ids) {
            await this.destroy(id);
        }
    }
    /** DB'ye session durumunu yaz (whatsapp_sessions) */
    async syncToDb(companyId, updates) {
        try {
            const sb = this.getSupabaseAdmin();
            const sessionId = `company-${companyId}`;
            const now = new Date().toISOString();
            const { data: existing } = await sb
                .from('whatsapp_sessions')
                .select('id')
                .eq('session_id', sessionId)
                .maybeSingle();
            const payload = {
                updated_at: now,
                last_activity: now,
            };
            if (updates.status !== undefined)
                payload.status = updates.status;
            if (updates.phone_number !== undefined)
                payload.phone_number = updates.phone_number;
            if (updates.qr_code !== undefined)
                payload.qr_code = updates.qr_code;
            if (updates.connected_at !== undefined)
                payload.connected_at = updates.connected_at;
            if (updates.error !== undefined)
                payload.error = updates.error;
            if (updates.device_name !== undefined)
                payload.device_name = updates.device_name;
            if (updates.session_path !== undefined)
                payload.provider_config = { session_path: updates.session_path };
            if (existing) {
                await sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
            }
            else {
                await sb.from('whatsapp_sessions').insert({
                    session_id: sessionId,
                    company_id: companyId,
                    status: updates.status || 'DISCONNECTED',
                    phone_number: updates.phone_number || null,
                    device_name: updates.device_name || 'ProYonetim Bot',
                    qr_code: updates.qr_code || null,
                    error: updates.error || null,
                    connected_at: updates.connected_at || null,
                    provider: 'baileys',
                    provider_config: updates.session_path ? { session_path: updates.session_path } : null,
                    ...payload,
                });
            }
        }
        catch (err) {
            console.error('[SessionManager] syncToDb error:', err.message);
        }
    }
    async getFromDb(companyId) {
        try {
            const sb = this.getSupabaseAdmin();
            const { data } = await sb
                .from('whatsapp_sessions')
                .select('*')
                .eq('session_id', `company-${companyId}`)
                .maybeSingle();
            return data || null;
        }
        catch {
            return null;
        }
    }
}
exports.sessionManager = new SessionManager();
//# sourceMappingURL=whatsapp.session.js.map