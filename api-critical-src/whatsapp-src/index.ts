/**
 * WhatsApp Module — Barrel Export
 *
 * Tüm WhatsApp modülünü tek bir import noktasından erişilebilir kılar.
 */

// Types & DTOs
export * from './whatsapp.types';
export * from './whatsapp.dto';

// Core
export { EvolutionClient } from './evolution.client';
export { whatsAppManager, WhatsAppManager } from './whatsapp.manager';
export { whatsAppRepository, WhatsAppRepository } from './whatsapp.repository';

// Gateway, Queue, Scheduler
export { whatsAppGateway, WhatsAppGateway } from './whatsapp.gateway';
export { messageQueue, MessageQueue } from './whatsapp.queue';
export { whatsAppScheduler, WhatsAppScheduler } from './whatsapp.scheduler';

// Health (geriye dönük)
export { getSessionHealth, getServiceHealth } from './whatsapp.health';

// Service (site bazlı fonksiyonlar)
export {
  connectSite,
  getSiteStatus,
  getSiteQr,
  disconnectSite,
  reconnectSite,
  sendSiteMessage,
  sendSiteBulkMessages,
  sendSiteDirectMessage,
  getEnterpriseHealth,
} from './whatsapp.service';

// Routes
export { default as whatsappRoutes } from './whatsapp.routes';

// Compatibility & Audit & Delivery
export { whatsappCompatRouter } from './whatsapp.compat';
export { whatsappDeliveryRouter } from './whatsapp.delivery.routes';
export { whatsappAuditRouter, whatsappAuditSendCapture } from './whatsapp.audit.routes';

// Session (geriye dönük)
export { sessionManager } from './whatsapp.session';