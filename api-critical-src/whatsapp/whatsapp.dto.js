"use strict";
/**
 * WhatsApp DTOs — Request/Response Data Transfer Objects.
 *
 * Gelen isteklerin validasyonu ve response formatlarının standardizasyonu.
 * SOLID: Single Responsibility — sadece veri transfer şeması.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRecipients = exports.validateMessage = exports.validateSiteId = exports.validatePhone = void 0;
// ═══════════════════════════════════════════════════
//  Validasyon Yardımcıları
// ═══════════════════════════════════════════════════
const PHONE_REGEX = /^\+?[\d\s\-\(\)]{7,20}$/;
function validatePhone(phone) {
    return PHONE_REGEX.test(phone);
}
exports.validatePhone = validatePhone;
function validateSiteId(siteId) {
    return typeof siteId === 'string' && siteId.length > 0 && siteId.length <= 64;
}
exports.validateSiteId = validateSiteId;
function validateMessage(message) {
    return typeof message === 'string' && message.length > 0 && message.length <= 4096;
}
exports.validateMessage = validateMessage;
function validateRecipients(recipients) {
    if (!Array.isArray(recipients) || recipients.length === 0)
        return false;
    if (recipients.length > 100)
        return false;
    return recipients.every((r) => typeof r === 'object' &&
        r !== null &&
        validatePhone(r.phone) &&
        validateMessage(r.message));
}
exports.validateRecipients = validateRecipients;
//# sourceMappingURL=whatsapp.dto.js.map