/**
 * WhatsApp Types — Merkezi tip tanımları.
 *
 * Proje genelinde kullanılan tüm interface ve type'lar burada toplanır.
 * SOLID: Interface Segregation — her bileşen sadece ihtiyacı olan tipi import eder.
 */

// ═══════════════════════════════════════════════════
//  Kanal Tipleri (HIBRIT MIMARI)
// ═══════════════════════════════════════════════════

export type ChannelType = 'CONNECTED_DEVICE' | 'OFFICIAL_CLOUD_API';

export type ChannelProvider = 'evolution' | 'meta_cloud' | 'bsp';

export interface WhatsAppChannel {
  id: string;
  company_id: string;
  channel_type: ChannelType;
  is_active: boolean;
  is_default: boolean;
  display_name: string | null;
  sender_phone: string | null;
  instance_name: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  access_token_encrypted: string | null;
  webhook_verify_token_encrypted: string | null;
  provider: ChannelProvider;
  status: string;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelParams {
  companyId: string;
  channelType: ChannelType;
  displayName?: string;
  senderPhone?: string;
  instanceName?: string;
  wabaId?: string;
  phoneNumberId?: string;
  accessTokenEncrypted?: string;
  webhookVerifyTokenEncrypted?: string;
  provider?: ChannelProvider;
  isDefault?: boolean;
}

export interface UpdateChannelParams {
  isActive?: boolean;
  isDefault?: boolean;
  displayName?: string;
  senderPhone?: string;
  status?: string;
  lastConnectedAt?: string;
  lastError?: string;
  wabaId?: string;
  phoneNumberId?: string;
  accessTokenEncrypted?: string;
  webhookVerifyTokenEncrypted?: string;
}

// ═══════════════════════════════════════════════════
//  Session Durumları
// ═══════════════════════════════════════════════════

export type SessionStatus =
  | 'DISCONNECTED'
  | 'WAITING_QR'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR'
  | 'LOADING';

// ═══════════════════════════════════════════════════
//  WebSocket Event Tipleri
// ═══════════════════════════════════════════════════

export type WsEventType =
  | 'qr'
  | 'ready'
  | 'authenticated'
  | 'disconnected'
  | 'message'
  | 'state'
  | 'status'
  | 'auth_failure'
  | 'loading'
  | 'state_change'
  | 'connection_error'
  | 'reconnecting';

// ═══════════════════════════════════════════════════
//  WebSocket Event Payload
// ═══════════════════════════════════════════════════

export interface WsEventPayload {
  siteId: string;
  companyId?: string;
  event: WsEventType;
  data?: unknown;
  timestamp: string;
}

export interface WsQrPayload extends WsEventPayload {
  event: 'qr';
  data: {
    qrCode: string;
    expiresIn?: number;
  };
}

export interface WsReadyPayload extends WsEventPayload {
  event: 'ready';
  data: {
    phoneNumber: string;
    profileName?: string;
    battery?: number;
  };
}

export interface WsStatePayload extends WsEventPayload {
  event: 'state' | 'state_change';
  data: {
    status: SessionStatus;
    previousStatus?: SessionStatus;
  };
}

export interface WsMessagePayload extends WsEventPayload {
  event: 'message';
  data: {
    from: string;
    body: string;
    timestamp: number;
    messageId?: string;
  };
}

export interface WsDisconnectedPayload extends WsEventPayload {
  event: 'disconnected';
  data: {
    reason: string;
    willReconnect: boolean;
  };
}

export interface WsAuthFailurePayload extends WsEventPayload {
  event: 'auth_failure';
  data: {
    reason: string;
    statusCode?: number;
  };
}

export interface WsStatusPayload extends WsEventPayload {
  event: 'status';
  data: {
    status: SessionStatus;
    phone?: string | null;
    profileName?: string | null;
    battery?: number | null;
    lastSeen?: string | null;
    sessionAge?: number;
  };
}

// ═══════════════════════════════════════════════════
//  Client Konfigürasyon
// ═══════════════════════════════════════════════════

export interface ClientConfig {
  siteId: string;
  companyId?: string;
  sessionPath: string;
  phoneNumber?: string;
  instanceName?: string;
  browser?: [string, string, string];
  qrTimeoutMs?: number;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  keepAliveIntervalMs?: number;
}

// ═══════════════════════════════════════════════════
//  Session Yapısı (Bellek)
// ═══════════════════════════════════════════════════

export interface SessionInfo {
  siteId: string;
  companyId?: string;
  status: SessionStatus;
  phoneNumber: string | null;
  profileName: string | null;
  battery: number | null;
  lastSeen: string | null;
  connectedAt: string | null;
  sessionAge: number;
  qrCode: string | null;
  error: string | null;
  createdAt: number;
  lastActivity: number;
}

// ═══════════════════════════════════════════════════
//  Queue & Rate Limit
// ═══════════════════════════════════════════════════

export interface QueueItem {
  id: string;
  siteId: string;
  companyId?: string;
  phone: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  priority: number;
}

export interface RateLimitConfig {
  maxMessagesPerMinute: number;
  maxMessagesPerHour: number;
  maxBulkPerRequest: number;
  cooldownMs: number;
}

export interface QueueStats {
  siteId: string;
  pending: number;
  sending: number;
  sentToday: number;
  failed: number;
}

// ═══════════════════════════════════════════════════
//  DB Kayıt Tipleri
// ═══════════════════════════════════════════════════

export interface CompanyWhatsAppRecord {
  id: string;
  company_id: string;
  site_id?: string;
  phone_number: string | null;
  status: string;
  session_path: string | null;
  connected_at: string | null;
  qr_code: string | null;
  error: string | null;
  profile_name: string | null;
  battery: number | null;
  last_seen: string | null;
  instance_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageQueueRecord {
  id: string;
  company_id?: string;
  site_id?: string;
  phone: string;
  message: string;
  status: string;
  retry_count: number;
  max_retries: number;
  priority: number;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export interface WhatsAppMessageRecord {
  id: string;
  company_id?: string;
  site_id?: string;
  from_phone: string;
  to_phone?: string;
  body: string;
  direction: 'incoming' | 'outgoing';
  message_type: string;
  whatsapp_message_id: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════
//  Health Check
// ═══════════════════════════════════════════════════

export interface SessionHealth {
  siteId: string;
  companyId?: string;
  status: string;
  uptime: number;
  phoneNumber: string | null;
  profileName: string | null;
  battery: number | null;
  lastSeen: string | null;
  hasQr: boolean;
  lastActivity: number;
}

export interface FullHealthReport {
  timestamp: string;
  service: string;
  provider: string;
  baileys_connected: boolean;
  sessions: SessionHealth[];
  totalSessions: number;
  bridge: string;
  version: string;
  queueStats?: QueueStats[];
  uptime: number;
}