/**
 * WhatsApp DTOs — Request/Response Data Transfer Objects.
 *
 * Gelen isteklerin validasyonu ve response formatlarının standardizasyonu.
 * SOLID: Single Responsibility — sadece veri transfer şeması.
 */

// ═══════════════════════════════════════════════════
//  Request DTOs
// ═══════════════════════════════════════════════════

/** POST /api/whatsapp/connect */
export interface ConnectRequest {
  siteId: string;
  companyId?: string;
  phoneNumber?: string;
  instanceName?: string;
}

/** POST /api/whatsapp/disconnect */
export interface DisconnectRequest {
  siteId: string;
  companyId?: string;
}

/** POST /api/whatsapp/reconnect */
export interface ReconnectRequest {
  siteId: string;
  companyId?: string;
  phoneNumber?: string;
}

/** GET /api/whatsapp/status */
export interface StatusQuery {
  siteId: string;
  companyId?: string;
}

/** GET /api/whatsapp/qr */
export interface QrQuery {
  siteId: string;
  companyId?: string;
}

/** POST /api/whatsapp/send */
export interface SendMessageRequest {
  siteId: string;
  companyId?: string;
  phone: string;
  message: string;
  priority?: number;
}

// ═══════════════════════════════════════════════════
//  Frontend-Uyumlu Request DTOs (phoneNumber formatı)
// ═══════════════════════════════════════════════════

/** POST /api/whatsapp/site/send — Frontend'den gelen format */
export interface SiteSendFrontendRequest {
  phoneNumber: string;
  message: string;
  residentId?: string;
  unitId?: string;
  siteId?: string;
  recipientName?: string;
}

/** POST /api/whatsapp/site/bulk-send — Frontend'den gelen format */
export interface SiteBulkSendFrontendRequest {
  recipients: Array<{
    phoneNumber: string;
    name?: string;
    residentId?: string;
    unitId?: string;
    siteId?: string;
  }>;
  message: string;
}

/** Single send response */
export interface SiteSendResponse {
  success: boolean;
  status: string;
  sent: number;
  failed: number;
  total: number;
  normalizedPhone?: string;
  providerMessageId?: string | null;
  archiveId?: string | null;
  instanceName?: string;
  error_type?: string;
  user_message?: string;
  technical?: unknown;
}

/** Bulk send per-recipient result */
export interface BulkSendRecipientResult {
  phoneNumber?: string;
  normalizedPhone?: string;
  name?: string;
  residentId?: string;
  success: boolean;
  status: string;
  error_type?: string;
  user_message?: string;
  providerStatus?: number;
  providerMessageId?: string | null;
  technical?: unknown;
}

/** Bulk send response */
export interface SiteBulkSendResponse {
  success: boolean;
  status: string;
  sent: number;
  failed: number;
  total: number;
  instanceName?: string;
  results: BulkSendRecipientResult[];
}

/** POST /api/whatsapp/bulk/send */
export interface BulkSendRequest {
  siteId: string;
  companyId?: string;
  recipients: Array<{ phone: string; message: string; priority?: number }>;
}

/** GET /api/whatsapp/sessions */
export interface SessionListQuery {
  companyId?: string;
}

// ═══════════════════════════════════════════════════
//  Response DTOs
// ═══════════════════════════════════════════════════

export interface ConnectResponse {
  success: boolean;
  status: string;
  siteId: string;
  companyId?: string;
  qrCode?: string | null;
  qr_code?: string | null;
  base64?: string | null;
  phoneNumber?: string | null;
  profileName?: string | null;
  instance?: string | null;
  instanceName?: string;
  provider?: string;
  error?: string;
  errorType?: string;
  userMessage?: string;
}

export interface DisconnectResponse {
  success: boolean;
  siteId: string;
  companyId?: string;
  status: string;
}

export interface ReconnectResponse extends ConnectResponse {}

export interface StatusResponse {
  success?: boolean;
  siteId: string;
  companyId?: string;
  status: string;
  connected?: boolean;
  state?: string;
  phoneNumber: string | null;
  profileName: string | null;
  battery: number | null;
  lastSeen: string | null;
  sessionAge: number;
  connectedAt: string | null;
  qrAvailable: boolean;
  hasQr?: boolean;
  qrCode: string | null;
  error: string | null;
  sessionPath: string | null;
  provider?: string;
  channel?: string;
  lastCheckedAt?: string;
  instanceName?: string;
}

export interface QrResponse {
  siteId: string;
  companyId?: string;
  qrCode: string | null;
  status: string;
  qrAvailable: boolean;
}

export interface SendMessageResponse {
  success: boolean;
  message?: string;
  queueId?: string;
  error?: string;
}

export interface BulkSendResponse {
  success: boolean;
  queued: number;
  failed: number;
  queueIds: string[];
  errors?: string[];
}

export interface DirectSendResponse {
  success: boolean;
  error?: string;
  messageId?: string;
}

export interface SessionListResponse {
  sessions: Array<{
    siteId: string;
    companyId?: string;
    status: string;
    phoneNumber: string | null;
    profileName: string | null;
    connectedAt: string | null;
  }>;
  total: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: string;
  timestamp: string;
}

// ═══════════════════════════════════════════════════
//  Validasyon Yardımcıları
// ═══════════════════════════════════════════════════

const PHONE_REGEX = /^\+?[\d\s\-\(\)]{7,20}$/;

export function validatePhone(phone: string): boolean {
  return PHONE_REGEX.test(phone);
}

export function validateSiteId(siteId: unknown): siteId is string {
  return typeof siteId === 'string' && siteId.length > 0 && siteId.length <= 64;
}

export function validateMessage(message: unknown): message is string {
  return typeof message === 'string' && message.length > 0 && message.length <= 4096;
}

export function validateRecipients(
  recipients: unknown,
): recipients is Array<{ phone: string; message: string }> {
  if (!Array.isArray(recipients) || recipients.length === 0) return false;
  if (recipients.length > 100) return false;
  return recipients.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      validatePhone(r.phone) &&
      validateMessage(r.message),
  );
}