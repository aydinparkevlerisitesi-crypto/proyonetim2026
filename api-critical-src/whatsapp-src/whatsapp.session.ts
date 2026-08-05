import { createServerSupabaseClient, SupabaseClient } from '../../lib/supabase';
import { config } from '../../config';
import * as fs from 'fs';

// ─── Session durumları ────────────────────────────
export type SessionStatus =
  | 'DISCONNECTED'
  | 'WAITING_QR'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

// ─── Aktif oturum (Baileys) ──────────────────────
export interface ActiveSession {
  companyId: string;
  sock: any | null; // Baileys WASocket
  status: SessionStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  connectedAt: string | null;
  error: string | null;
  createdAt: number;
  lastActivity: number;
}

// ─── DB kaydı (whatsapp_sessions) ────────────────
export interface WhatsAppSessionRecord {
  id: number;
  session_id: string;
  company_id: string | null;
  site_id: string | null;
  status: string;
  phone_number: string | null;
  device_name: string | null;
  qr_code: string | null;
  error: string | null;
  connected_at: string | null;
  last_activity: string | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Session Manager ─────────────────────────────
class SessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private supabaseAdmin: SupabaseClient | null = null;

  private getSupabaseAdmin(): SupabaseClient {
    if (!this.supabaseAdmin) {
      this.supabaseAdmin = createServerSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);
    }
    return this.supabaseAdmin;
  }

  /** Session key oluştur — firma bazlı */
  sessionKey(companyId: string): string {
    return `proyonetim-company-${companyId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  /** Auth state'in diske yazılacağı klasör yolu */
  sessionPath(companyId: string): string {
    return `/opt/wpp-sessions/${this.sessionKey(companyId)}`;
  }

  /** Eski auth state klasörünü temizle */
  clearSessionPath(companyId: string): void {
    const path = this.sessionPath(companyId);
    try {
      if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
        console.log(`[SessionManager] Cleared auth state for ${companyId}`);
      }
    } catch (err) {
      console.error(`[SessionManager] Failed to clear auth state for ${companyId}:`, (err as Error).message);
    }
  }

  has(companyId: string): boolean {
    return this.sessions.has(companyId);
  }

  get(companyId: string): ActiveSession | undefined {
    return this.sessions.get(companyId);
  }

  getAll(): Array<{ companyId: string; status: SessionStatus; phoneNumber: string | null }> {
    return Array.from(this.sessions.entries()).map(([companyId, s]) => ({
      companyId,
      status: s.status,
      phoneNumber: s.phoneNumber,
    }));
  }

  set(companyId: string, session: ActiveSession): void {
    this.sessions.set(companyId, session);
  }

  /** Session'ı sil (bellekten, soketi kapat, DB'yi güncelle) */
  async destroy(companyId: string): Promise<void> {
    const session = this.sessions.get(companyId);
    if (session?.sock) {
      try { session.sock.end(undefined); } catch { /* skip */ }
    }
    this.sessions.delete(companyId);

    try {
      const sb = this.getSupabaseAdmin();
      await sb.from('whatsapp_sessions')
        .update({ status: 'DISCONNECTED', qr_code: null, error: null, updated_at: new Date().toISOString() })
        .eq('session_id', `company-${companyId}`);
    } catch (err) {
      console.error('[SessionManager] DB destroy error:', (err as Error).message);
    }
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.destroy(id);
    }
  }

  /** DB'ye session durumunu yaz (whatsapp_sessions) */
  async syncToDb(companyId: string, updates: {
    status?: SessionStatus;
    phone_number?: string | null;
    session_path?: string | null;
    qr_code?: string | null;
    connected_at?: string | null;
    error?: string | null;
    device_name?: string | null;
    last_activity?: string | null;
  }): Promise<void> {
    try {
      const sb = this.getSupabaseAdmin();
      const sessionId = `company-${companyId}`;
      const now = new Date().toISOString();

      const { data: existing } = await sb
        .from('whatsapp_sessions')
        .select('id')
        .eq('session_id', sessionId)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        updated_at: now,
        last_activity: now,
      };

      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.phone_number !== undefined) payload.phone_number = updates.phone_number;
      if (updates.qr_code !== undefined) payload.qr_code = updates.qr_code;
      if (updates.connected_at !== undefined) payload.connected_at = updates.connected_at;
      if (updates.error !== undefined) payload.error = updates.error;
      if (updates.device_name !== undefined) payload.device_name = updates.device_name;
      if (updates.session_path !== undefined) payload.provider_config = { session_path: updates.session_path };

      if (existing) {
        await sb.from('whatsapp_sessions').update(payload).eq('id', existing.id);
      } else {
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
    } catch (err) {
      console.error('[SessionManager] syncToDb error:', (err as Error).message);
    }
  }

  async getFromDb(companyId: string): Promise<WhatsAppSessionRecord | null> {
    try {
      const sb = this.getSupabaseAdmin();
      const { data } = await sb
        .from('whatsapp_sessions')
        .select('*')
        .eq('session_id', `company-${companyId}`)
        .maybeSingle();
      return data || null;
    } catch {
      return null;
    }
  }
}

export const sessionManager = new SessionManager();