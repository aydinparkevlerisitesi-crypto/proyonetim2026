"use strict";
/**
 * WhatsApp Module — Barrel Export
 *
 * Tüm WhatsApp modülünü tek bir import noktasından erişilebilir kılar.
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = exports.whatsappAuditSendCapture = exports.whatsappAuditRouter = exports.whatsappDeliveryRouter = exports.whatsappCompatRouter = exports.whatsappRoutes = exports.getEnterpriseHealth = exports.sendSiteDirectMessage = exports.sendSiteBulkMessages = exports.sendSiteMessage = exports.reconnectSite = exports.disconnectSite = exports.getSiteQr = exports.getSiteStatus = exports.connectSite = exports.getServiceHealth = exports.getSessionHealth = exports.WhatsAppScheduler = exports.whatsAppScheduler = exports.MessageQueue = exports.messageQueue = exports.WhatsAppGateway = exports.whatsAppGateway = exports.WhatsAppRepository = exports.whatsAppRepository = exports.WhatsAppManager = exports.whatsAppManager = exports.EvolutionClient = void 0;
// Types & DTOs
__exportStar(require("./whatsapp.types"), exports);
__exportStar(require("./whatsapp.dto"), exports);
// Core
var evolution_client_1 = require("./evolution.client");
Object.defineProperty(exports, "EvolutionClient", { enumerable: true, get: function () { return evolution_client_1.EvolutionClient; } });
var whatsapp_manager_1 = require("./whatsapp.manager");
Object.defineProperty(exports, "whatsAppManager", { enumerable: true, get: function () { return whatsapp_manager_1.whatsAppManager; } });
Object.defineProperty(exports, "WhatsAppManager", { enumerable: true, get: function () { return whatsapp_manager_1.WhatsAppManager; } });
var whatsapp_repository_1 = require("./whatsapp.repository");
Object.defineProperty(exports, "whatsAppRepository", { enumerable: true, get: function () { return whatsapp_repository_1.whatsAppRepository; } });
Object.defineProperty(exports, "WhatsAppRepository", { enumerable: true, get: function () { return whatsapp_repository_1.WhatsAppRepository; } });
// Gateway, Queue, Scheduler
var whatsapp_gateway_1 = require("./whatsapp.gateway");
Object.defineProperty(exports, "whatsAppGateway", { enumerable: true, get: function () { return whatsapp_gateway_1.whatsAppGateway; } });
Object.defineProperty(exports, "WhatsAppGateway", { enumerable: true, get: function () { return whatsapp_gateway_1.WhatsAppGateway; } });
var whatsapp_queue_1 = require("./whatsapp.queue");
Object.defineProperty(exports, "messageQueue", { enumerable: true, get: function () { return whatsapp_queue_1.messageQueue; } });
Object.defineProperty(exports, "MessageQueue", { enumerable: true, get: function () { return whatsapp_queue_1.MessageQueue; } });
var whatsapp_scheduler_1 = require("./whatsapp.scheduler");
Object.defineProperty(exports, "whatsAppScheduler", { enumerable: true, get: function () { return whatsapp_scheduler_1.whatsAppScheduler; } });
Object.defineProperty(exports, "WhatsAppScheduler", { enumerable: true, get: function () { return whatsapp_scheduler_1.WhatsAppScheduler; } });
// Health (geriye dönük)
var whatsapp_health_1 = require("./whatsapp.health");
Object.defineProperty(exports, "getSessionHealth", { enumerable: true, get: function () { return whatsapp_health_1.getSessionHealth; } });
Object.defineProperty(exports, "getServiceHealth", { enumerable: true, get: function () { return whatsapp_health_1.getServiceHealth; } });
// Service (site bazlı fonksiyonlar)
var whatsapp_service_1 = require("./whatsapp.service");
Object.defineProperty(exports, "connectSite", { enumerable: true, get: function () { return whatsapp_service_1.connectSite; } });
Object.defineProperty(exports, "getSiteStatus", { enumerable: true, get: function () { return whatsapp_service_1.getSiteStatus; } });
Object.defineProperty(exports, "getSiteQr", { enumerable: true, get: function () { return whatsapp_service_1.getSiteQr; } });
Object.defineProperty(exports, "disconnectSite", { enumerable: true, get: function () { return whatsapp_service_1.disconnectSite; } });
Object.defineProperty(exports, "reconnectSite", { enumerable: true, get: function () { return whatsapp_service_1.reconnectSite; } });
Object.defineProperty(exports, "sendSiteMessage", { enumerable: true, get: function () { return whatsapp_service_1.sendSiteMessage; } });
Object.defineProperty(exports, "sendSiteBulkMessages", { enumerable: true, get: function () { return whatsapp_service_1.sendSiteBulkMessages; } });
Object.defineProperty(exports, "sendSiteDirectMessage", { enumerable: true, get: function () { return whatsapp_service_1.sendSiteDirectMessage; } });
Object.defineProperty(exports, "getEnterpriseHealth", { enumerable: true, get: function () { return whatsapp_service_1.getEnterpriseHealth; } });
// Routes
var whatsapp_routes_1 = require("./whatsapp.routes");
Object.defineProperty(exports, "whatsappRoutes", { enumerable: true, get: function () { return __importDefault(whatsapp_routes_1).default; } });
// Compatibility & Audit & Delivery
var whatsapp_compat_1 = require("./whatsapp.compat");
Object.defineProperty(exports, "whatsappCompatRouter", { enumerable: true, get: function () { return whatsapp_compat_1.whatsappCompatRouter; } });
var whatsapp_delivery_routes_1 = require("./whatsapp.delivery.routes");
Object.defineProperty(exports, "whatsappDeliveryRouter", { enumerable: true, get: function () { return whatsapp_delivery_routes_1.whatsappDeliveryRouter; } });
var whatsapp_audit_routes_1 = require("./whatsapp.audit.routes");
Object.defineProperty(exports, "whatsappAuditRouter", { enumerable: true, get: function () { return whatsapp_audit_routes_1.whatsappAuditRouter; } });
Object.defineProperty(exports, "whatsappAuditSendCapture", { enumerable: true, get: function () { return whatsapp_audit_routes_1.whatsappAuditSendCapture; } });
// Session (geriye dönük)
var whatsapp_session_1 = require("./whatsapp.session");
Object.defineProperty(exports, "sessionManager", { enumerable: true, get: function () { return whatsapp_session_1.sessionManager; } });
//# sourceMappingURL=index.js.map