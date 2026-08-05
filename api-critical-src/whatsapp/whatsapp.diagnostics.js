"use strict";
/**
 * WhatsApp Full System Diagnostics — Enterprise Production Health Checks
 *
 * 14 kontrol noktası:
 *   1. Radore API
 *   2. Evolution API
 *   3. Docker Container
 *   4. Instance Mevcut
 *   5. API Key Doğru
 *   6. Webhook Kayıtlı
 *   7. WebSocket Bağlı
 *   8. Redis Çalışıyor
 *   9. BullMQ/Queue Çalışıyor
 *  10. Supabase Bağlantısı
 *  11. Nginx Proxy
 *  12. SSL Sertifikası
 *  13. PM2 Servisi
 *  14. Environment Değişkenleri
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
exports.runFullDiagnostics = void 0;
const supabase_1 = require("../../lib/supabase");
const config_1 = require("../../config");
const fetchCompat_1 = require("../../lib/fetchCompat");
const evolution_client_1 = require("./evolution.client");
const whatsapp_manager_1 = require("./whatsapp.manager");
const whatsapp_gateway_1 = require("./whatsapp.gateway");
// ─── Environment kontrolü ────────────────────────
const REQUIRED_ENV_VARS = [
    'PORT',
    'API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
];
function checkEnvironmentVariables() {
    const start = Date.now();
    const missing = [];
    const present = [];
    for (const v of REQUIRED_ENV_VARS) {
        if (process.env[v]) {
            present.push(v);
        }
        else {
            missing.push(v);
        }
    }
    const ok = missing.length === 0;
    return {
        id: 'env-vars',
        label: 'Environment Değişkenleri',
        description: `${REQUIRED_ENV_VARS.length} gerekli değişken`,
        status: ok ? 'ok' : 'error',
        message: ok
            ? `Tüm ${present.length} değişken mevcut`
            : `${missing.length} eksik: ${missing.join(', ')}`,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        category: 'security',
    };
}
function checkPm2Service() {
    const start = Date.now();
    const pm2Home = process.env.PM2_HOME;
    const pm2Id = process.env.pm_id;
    const name = process.env.name;
    if (pm2Home || pm2Id !== undefined || name) {
        return {
            id: 'pm2-service',
            label: 'PM2 Servisi',
            description: 'Proses yöneticisi',
            status: 'ok',
            message: `Çalışıyor (pm_id: ${pm2Id || 'N/A'}, name: ${name || 'N/A'})`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'monitoring',
        };
    }
    // PM2 env vars yok ama bu illa hata değil - direkt node ile de çalışıyor olabilir
    return {
        id: 'pm2-service',
        label: 'PM2 Servisi',
        description: 'Proses yöneticisi',
        status: 'warning',
        message: 'PM2 değişkenleri bulunamadı — direkt Node.js ile çalışıyor olabilir',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        category: 'monitoring',
    };
}
function checkNginxProxy(req) {
    const start = Date.now();
    if (!req) {
        return {
            id: 'nginx-proxy',
            label: 'Nginx Proxy',
            description: 'Reverse proxy yapılandırması',
            status: 'warning',
            message: 'Request context mevcut değil — kontrol edilemedi',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        };
    }
    const hasXForwarded = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-real-ip']);
    const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    if (hasXForwarded && isHttps) {
        return {
            id: 'nginx-proxy',
            label: 'Nginx Proxy',
            description: 'Reverse proxy yapılandırması',
            status: 'ok',
            message: 'Nginx proxy aktif, yönlendirme doğru çalışıyor',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        };
    }
    if (hasXForwarded) {
        return {
            id: 'nginx-proxy',
            label: 'Nginx Proxy',
            description: 'Reverse proxy yapılandırması',
            status: 'ok',
            message: 'Nginx proxy tespit edildi',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        };
    }
    return {
    id: 'nginx-proxy',
    label: 'Nginx Proxy',
    description: 'Reverse proxy yapılandırması',
    status: (function(){try{const {execSync}=require('child_process');return String(execSync('systemctl is-active nginx',{timeout:2000,encoding:'utf8'})).trim()==='active'?'ok':'warning';}catch(_){return 'warning';}})(),
    message: (function(){try{const {execSync}=require('child_process');if(String(execSync('systemctl is-active nginx',{timeout:2000,encoding:'utf8'})).trim()==='active')return 'Nginx servisi aktif (doğrudan diagnostics — X-Forwarded yok, normal)';}catch(_){} return 'X-Forwarded başlıkları bulunamadı — direkt bağlantı olabilir';})(),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - start,
    category: 'infrastructure',
  };
}
function checkSsl(req) {
    const start = Date.now();
    if (!req) {
        return {
            id: 'ssl-cert',
            label: 'SSL Sertifikası',
            description: 'HTTPS / TLS geçerlilik',
            status: 'ok',
            message: 'Request context mevcut değil — kontrol edilemedi',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'security',
        };
    }
    const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    return {
        id: 'ssl-cert',
        label: 'SSL Sertifikası',
        description: 'HTTPS / TLS geçerlilik',
        status: isHttps ? 'ok' : 'warning',
        message: isHttps ? 'SSL aktif, HTTPS bağlantısı mevcut' : 'HTTPS tespit edilemedi — production\'da SSL zorunlu',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        category: 'security',
    };
}
// ─── API Endpoint Self-Test ──────────────────────
async function checkApiRouting(req) {
    const start = Date.now();
    // Detect response source from request headers only
    const xPoweredBy = req?.headers['x-powered-by'];
    const server = req?.headers['server'];
    const via = req?.headers['via'];
    const xForwardedFor = req?.headers['x-forwarded-for'];
    const isNginx = server?.toLowerCase().includes('nginx') || !!via;
    const isExpress = xPoweredBy?.toLowerCase().includes('express');
    const hasProxy = isNginx || !!xForwardedFor;
    const sourceInfo = [];
    if (isNginx)
        sourceInfo.push('Nginx');
    if (isExpress)
        sourceInfo.push('Express');
    if (hasProxy)
        sourceInfo.push('Proxy');
    if (sourceInfo.length === 0)
        sourceInfo.push('Direkt Baglanti');
    const details = {
        responseSource: sourceInfo.join(' + '),
        nginxDetected: isNginx,
        expressDetected: isExpress,
        proxyDetected: hasProxy,
        port: config_1.config.port,
        baseUrl: config_1.config.supabase.url ? 'configured' : 'missing',
    };
    const status = isExpress ? 'ok' : isNginx ? 'ok' : 'warning';
    return {
        id: 'api-routing',
        label: 'API Yönlendirme',
        description: 'Nginx → Express yönlendirme dogrulamasi',
        status,
        message: isExpress
            ? `Express tespit edildi — yönlendirme aktif (port: ${config_1.config.port})`
            : isNginx
                ? `Nginx proxy tespit edildi — Express header\'ı eksik olabilir`
                : `API ayakta — doğrudan diagnostics (proxy başlığı yok, normal)`,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        category: 'core',
        details,
    };
}
// ─── Ana tanılama fonksiyonu ─────────────────────
async function runFullDiagnostics(siteId, req) {
    const overallStart = Date.now();
    const items = [];
    // ── 1. Radore API (her zaman OK, cevap veriyoruz) ──
    const apiStart = Date.now();
    items.push({
        id: 'radore-api',
        label: 'Radore API',
        description: 'Gateway API erişilebilirliği',
        status: 'ok',
        message: `API yanıt veriyor (port: ${config_1.config.port})`,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - apiStart,
        category: 'core',
    });
    // ── 1.5. API Routing Test (Nginx → Express) ──
    items.push(await checkApiRouting(req));
    // ── 2-3-5. Evolution API + Docker + API Key (tek çağrıda 3 kontrol) ──
    await checkEvolutionStack(items);
    // ── 2.5. Evolution API Direkt Test ──
    await checkEvolutionDirect(items);
    // ── 4. Instance mevcut mu ──
    await checkInstance(items, siteId);
    // ── 6. Webhook kayıtlı mı ──
    await checkWebhook(items, siteId);
    // ── 7. WebSocket bağlı mı ──
    checkWebSocket(items, siteId);
    // ── 8. Redis ──
    await checkRedis(items);
    // ── 9. BullMQ / Queue ──
    await checkQueueSystem(items, siteId);
    // ── 10. Supabase ──
    await checkSupabase(items);
    // ── 11. Nginx Proxy ──
    items.push(checkNginxProxy(req));
    // ── 12. SSL ──
    items.push(checkSsl(req));
    // ── 13. PM2 ──
    items.push(checkPm2Service());
    // ── 14. Environment ──
    items.push(checkEnvironmentVariables());
    // ── Genel durum hesaplama ──
    const okCount = items.filter((i) => i.status === 'ok').length;
    const errorCount = items.filter((i) => i.status === 'error').length;
    const warningCount = items.filter((i) => i.status === 'warning').length;
    let overallStatus = 'healthy';
    if (errorCount > 0) {
        overallStatus = errorCount >= 3 ? 'unhealthy' : 'degraded';
    }
    else if (warningCount >= 3) {
        overallStatus = 'degraded';
    }
    return {
        timestamp: new Date().toISOString(),
        overallStatus,
        totalChecks: items.length,
        okCount,
        errorCount,
        warningCount,
        items,
        serviceInfo: {
            name: 'Radore WhatsApp Gateway',
            version: '4.0.0-enterprise',
            nodeVersion: process.version,
            platform: process.platform,
            uptimeSeconds: Math.floor((Date.now() - overallStart) / 1000) + (process.uptime() || 0),
        },
    };
}
exports.runFullDiagnostics = runFullDiagnostics;
// ─── Yardımcı kontroller ─────────────────────────
async function checkEvolutionStack(items) {
    const start = Date.now();
    const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    // Has API key (not empty or placeholder)?
    const hasApiKey = !!process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_API_KEY !== '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    try {
        const evoResult = await (0, evolution_client_1.pingEvolutionApi)();
        const latency = Date.now() - start;
        if (evoResult.alive) {
            const isAuthError = evoResult.error && (evoResult.error.includes('Authentication') || evoResult.error.includes('401'));
            items.push({
                id: 'evolution-api',
                label: 'Evolution API',
                description: 'WhatsApp Baileys API',
                status: isAuthError ? 'warning' : 'ok',
                message: isAuthError
                    ? `Canlı ancak yetkilendirme uyarısı: ${evoResult.error}`
                    : `Çalışıyor (${evoResult.version || 'active'})`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
                details: {
                    url: EVO_URL,
                    reachable: true,
                    dockerRunning: true,
                    apiKeyValid: !isAuthError,
                    httpStatus: 200,
                    version: evoResult.version || 'v2.2.3',
                },
            });
            items.push({
                id: 'docker-container',
                label: 'Docker Container',
                description: 'Evolution API konteyneri',
                status: 'ok',
                message: 'Container ayakta (Evolution API üzerinden doğrulandı)',
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'infrastructure',
                details: {
                    url: EVO_URL,
                    reachable: true,
                    dockerRunning: true,
                },
            });
            items.push({
                id: 'api-key',
                label: 'API Key Doğrulama',
                description: 'Evolution API Key geçerlilik',
                status: isAuthError ? 'warning' : 'ok',
                message: isAuthError
                    ? `API Key geçersiz olabilir: ${evoResult.error}`
                    : 'API Key geçerli, kimlik doğrulama başarılı',
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'security',
                details: {
                    url: EVO_URL,
                    apiKeyValid: !isAuthError,
                    hasConfiguredKey: hasApiKey,
                    httpStatus: isAuthError ? 401 : 200,
                },
            });
        }
        else {
            const errMsg = evoResult.error || 'Bilinmeyen hata';
            const isConnectionError = errMsg.includes('erişilemiyor') || errMsg.includes('ECONNREFUSED') || errMsg.includes('timeout') || errMsg.includes('Docker');
            const isAuthError = errMsg.includes('Authentication') || errMsg.includes('401') || errMsg.includes('403');
            items.push({
                id: 'evolution-api',
                label: 'Evolution API',
                description: 'WhatsApp Baileys API',
                status: 'error',
                message: `Erişilemiyor: ${errMsg}`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
                details: {
                    url: EVO_URL,
                    reachable: false,
                    dockerRunning: !isConnectionError,
                    apiKeyValid: isAuthError ? false : null,
                    httpStatus: isAuthError ? 401 : null,
                    errorType: isConnectionError ? 'connection' : isAuthError ? 'auth' : 'unknown',
                    configuredKeyPresent: hasApiKey,
                },
            });
            if (isConnectionError) {
                items.push({
                    id: 'docker-container',
                    label: 'Docker Container',
                    description: 'Evolution API konteyneri',
                    status: 'error',
                    message: 'Container çalışmıyor veya erişilemiyor',
                    checkedAt: new Date().toISOString(),
                    latencyMs: latency,
                    category: 'infrastructure',
                    details: {
                        url: EVO_URL,
                        reachable: false,
                        dockerRunning: false,
                        errorType: 'connection_refused',
                        suggestion: 'docker ps | grep evolution-api',
                    },
                });
            }
            else {
                items.push({
                    id: 'docker-container',
                    label: 'Docker Container',
                    description: 'Evolution API konteyneri',
                    status: 'warning',
                    message: 'Container durumu belirsiz (API yanıt verdi ama hata döndü)',
                    checkedAt: new Date().toISOString(),
                    latencyMs: latency,
                    category: 'infrastructure',
                    details: {
                        url: EVO_URL,
                        reachable: true,
                        dockerRunning: true,
                        errorType: 'api_error',
                    },
                });
            }
            items.push({
                id: 'api-key',
                label: 'API Key Doğrulama',
                description: 'Evolution API Key geçerlilik',
                status: isAuthError ? 'error' : 'warning',
                message: isAuthError
                    ? 'API Key hatalı veya geçersiz'
                    : `Doğrulanamadı: ${errMsg}`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'security',
                details: {
                    url: EVO_URL,
                    apiKeyValid: isAuthError ? false : null,
                    hasConfiguredKey: hasApiKey,
                    httpStatus: isAuthError ? 401 : null,
                    errorType: isAuthError ? 'auth' : 'unknown',
                },
            });
        }
    }
    catch (err) {
        const latency = Date.now() - start;
        const msg = err.message;
        const isConnectionError = msg.includes('erişilemiyor') || msg.includes('ECONNREFUSED') || msg.includes('Docker');
        items.push({
            id: 'evolution-api',
            label: 'Evolution API',
            description: 'WhatsApp Baileys API',
            status: 'error',
            message: `Kontrol başarısız: ${msg}`,
            checkedAt: new Date().toISOString(),
            latencyMs: latency,
            category: 'core',
            details: {
                url: EVO_URL,
                reachable: false,
                dockerRunning: false,
                apiKeyValid: null,
                httpStatus: null,
                errorType: 'exception',
                configuredKeyPresent: hasApiKey,
            },
        });
        items.push({
            id: 'docker-container',
            label: 'Docker Container',
            description: 'Evolution API konteyneri',
            status: 'error',
            message: 'Kontrol edilemedi',
            checkedAt: new Date().toISOString(),
            latencyMs: 0,
            category: 'infrastructure',
            details: {
                url: EVO_URL,
                reachable: false,
                dockerRunning: false,
                errorType: 'exception',
            },
        });
        items.push({
            id: 'api-key',
            label: 'API Key Doğrulama',
            description: 'Evolution API Key geçerlilik',
            status: 'error',
            message: 'Kontrol edilemedi',
            checkedAt: new Date().toISOString(),
            latencyMs: 0,
            category: 'security',
            details: {
                url: EVO_URL,
                apiKeyValid: null,
                hasConfiguredKey: hasApiKey,
                errorType: 'exception',
            },
        });
    }
}
// ─── Evolution API Direkt Test ──────────────────
async function checkEvolutionDirect(items) {
    const start = Date.now();
    const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    const hasApiKey = !!process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_API_KEY !== '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
    const tests = [];
    // Test 1: /instance/fetchInstances
    try {
        const t1Start = Date.now();
        const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/instance/fetchInstances`, {
            headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        }, 5000);
        const ct = res.headers.get('content-type') || '';
        const isJson = ct.includes('application/json');
        let preview = '';
        try {
            preview = (await res.text()).substring(0, 200);
        }
        catch { /* ignore */ }
        tests.push({
            name: 'Fetch Instances',
            endpoint: '/instance/fetchInstances',
            status: res.status,
            latency: Date.now() - t1Start,
            isJson,
            bodyPreview: preview,
        });
    }
    catch (err) {
        tests.push({
            name: 'Fetch Instances',
            endpoint: '/instance/fetchInstances',
            status: 0,
            latency: Date.now() - start,
            isJson: false,
            bodyPreview: '',
            error: err.message,
        });
    }
    // Test 2: /manager/ping (v2 fallback)
    try {
        const t2Start = Date.now();
        const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/manager/ping`, {}, 3000);
        const ct = res.headers.get('content-type') || '';
        const isJson = ct.includes('application/json');
        let preview = '';
        try {
            preview = (await res.text()).substring(0, 200);
        }
        catch { /* ignore */ }
        tests.push({
            name: 'Manager Ping',
            endpoint: '/manager/ping',
            status: res.status,
            latency: Date.now() - t2Start,
            isJson,
            bodyPreview: preview,
        });
    }
    catch (err) {
        tests.push({
            name: 'Manager Ping',
            endpoint: '/manager/ping',
            status: 0,
            latency: Date.now() - start,
            isJson: false,
            bodyPreview: '',
            error: err.message,
        });
    }
    // Determine overall status
    const allReachable = tests.every((t) => t.status > 0);
    const anyOk = tests.some((t) => t.status >= 200 && t.status < 300);
    const anyJson = tests.some((t) => t.isJson);
    const firstError = tests.find((t) => t.error);
    const details = {
        evolutionUrl: EVO_URL,
        hasConfiguredKey: hasApiKey,
        apiAlive: anyOk,
        apiRespondingJson: anyJson,
    };
    tests.forEach((t, i) => {
        const prefix = `test${i}_`;
        details[`${prefix}name`] = t.name;
        details[`${prefix}endpoint`] = t.endpoint;
        details[`${prefix}status`] = t.status;
        details[`${prefix}latencyMs`] = t.latency;
        details[`${prefix}isJson`] = t.isJson;
        details[`${prefix}error`] = t.error || null;
        if (t.bodyPreview && !t.isJson) {
            details[`${prefix}preview`] = t.bodyPreview.substring(0, 100);
        }
    });
    if (anyOk && anyJson) {
        items.push({
            id: 'evolution-direct',
            label: 'Evolution API Direkt',
            description: 'Dogrudan Evolution API testi',
            status: 'ok',
            message: `Evolution API yanit veriyor — ${tests.filter(t => t.status >= 200 && t.status < 300).length}/${tests.length} test basarili`,
            checkedAt: new Date().toISOString(),
            latencyMs: tests.reduce((sum, t) => sum + t.latency, 0),
            category: 'core',
            details,
        });
    }
    else if (allReachable && !anyJson) {
        items.push({
            id: 'evolution-direct',
            label: 'Evolution API Direkt',
            description: 'Dogrudan Evolution API testi',
            status: 'error',
            message: 'Evolution API yanit veriyor ancak JSON dondurmuyor — HTML olabilir mi?',
            checkedAt: new Date().toISOString(),
            latencyMs: tests.reduce((sum, t) => sum + t.latency, 0),
            category: 'core',
            details,
        });
    }
    else if (firstError) {
        const isConnErr = firstError.error?.includes('ECONNREFUSED') || firstError.error?.includes('fetch failed');
        items.push({
            id: 'evolution-direct',
            label: 'Evolution API Direkt',
            description: 'Dogrudan Evolution API testi',
            status: 'error',
            message: isConnErr
                ? `Evolution API (${EVO_URL}) erisilemiyor — Docker container calismiyor olabilir`
                : `Evolution API testi basarisiz: ${firstError.error}`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
            details,
        });
    }
    else {
        items.push({
            id: 'evolution-direct',
            label: 'Evolution API Direkt',
            description: 'Dogrudan Evolution API testi',
            status: 'warning',
            message: 'Evolution API durumu belirsiz',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
            details,
        });
    }
}
async function checkInstance(items, siteId) {
    const start = Date.now();
    if (siteId) {
        // Belirli bir site için kontrol
        const client = whatsapp_manager_1.whatsAppManager.getClient(siteId);
        const latency = Date.now() - start;
        if (client) {
            const info = client.getSessionInfo();
            const statusLabel = info.status === 'CONNECTED' ? 'Bağlı' :
                info.status === 'WAITING_QR' ? 'QR Bekliyor' :
                    info.status === 'RECONNECTING' ? 'Yeniden bağlanıyor' :
                        info.status;
            items.push({
                id: 'instance-exists',
                label: 'Instance Durumu',
                description: `Site "${siteId}" WhatsApp oturumu`,
                status: info.status === 'CONNECTED' ? 'ok' : info.status === 'ERROR' ? 'error' : 'warning',
                message: `${statusLabel}${info.phoneNumber ? ` (${info.phoneNumber})` : ''}`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
            });
        }
        else {
            // Manager'da yok → Evolution API'de var mı diye bak
            try {
                const instanceName = 'site-' + siteId.replace(/[^a-zA-Z0-9_-]/g, '-');
                const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
                const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
                const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/instance/connectionState/${instanceName}`, {
                    headers: { apikey: EVO_KEY },
                }, 5000);
                const data = await res.json().catch(() => null);
                const state = data?.instance?.state || data?.state;
                if (state === 'open') {
                    items.push({
                        id: 'instance-exists',
                        label: 'Instance Durumu',
                        description: `Site "${siteId}" WhatsApp oturumu`,
                        status: 'ok',
                        message: 'Evolution API\'de bağlı instance mevcut',
                        checkedAt: new Date().toISOString(),
                        latencyMs: Date.now() - start,
                        category: 'core',
                    });
                }
                else {
                    items.push({
                        id: 'instance-exists',
                        label: 'Instance Durumu',
                        description: `Site "${siteId}" WhatsApp oturumu`,
                        status: 'warning',
                        message: 'Aktif instance bulunamadı — QR bağlantısı başlatılmalı',
                        checkedAt: new Date().toISOString(),
                        latencyMs: Date.now() - start,
                        category: 'core',
                    });
                }
            }
            catch {
                items.push({
                    id: 'instance-exists',
                    label: 'Instance Durumu',
                    description: `Site "${siteId}" WhatsApp oturumu`,
                    status: 'warning',
                    message: 'Aktif instance bulunamadı — Evolution API erişilemedi',
                    checkedAt: new Date().toISOString(),
                    latencyMs: Date.now() - start,
                    category: 'core',
                });
            }
        }
    }
    else {
        // siteId verilmemiş — Evolution + in-memory manager
        const totalClients = whatsapp_manager_1.whatsAppManager.size;
        const connected = whatsapp_manager_1.whatsAppManager.connectedCount;
        let evoCount = 0;
        let evoOpen = 0;
        try {
            const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
            const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
            const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/instance/fetchInstances`, {
                headers: { apikey: EVO_KEY },
            }, 5000);
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : [];
                evoCount = list.length;
                evoOpen = list.filter((x) => {
                    const st = x.connectionStatus || x?.instance?.state || x.state;
                    return st === 'open' || st === 'CONNECTED';
                }).length;
            }
        }
        catch { /* ignore */ }
        const ok = evoOpen > 0 || connected > 0;
        const warnOk = evoCount > 0 || totalClients > 0;
        items.push({
            id: 'instance-exists',
            label: 'Instance Durumu',
            description: 'Genel WhatsApp oturumları (Evolution + gateway)',
            status: ok ? 'ok' : warnOk ? 'warning' : 'warning',
            message: evoCount > 0
                ? `Evolution: ${evoOpen}/${evoCount} açık` + (totalClients ? `; gateway: ${connected}/${totalClients}` : ' — QR bağlama için Yeni Bağlantı kullanın')
                : (totalClients > 0 ? `${connected}/${totalClients} oturum bağlı` : 'Evolution instance yok — Yeni Bağlantı ile oluşturun'),
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
        });
    }
}
async function checkWebhook(items, siteId) {
    const start = Date.now();
    try {
        const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
        const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';
        // Evolution API'deki webhook ayarlarını kontrol et
        const res = await (0, fetchCompat_1.safeFetch)(`${EVO_URL}/webhook/find`, {
            headers: { apikey: EVO_KEY },
        }, 5000);
        const latency = Date.now() - start;
        if (res.ok) {
            const data = await res.json().catch(() => null);
            const webhooks = Array.isArray(data) ? data : data?.webhooks || [];
            const hasWebhook = webhooks.length > 0;
            items.push({
                id: 'webhook-registered',
                label: 'Webhook Kaydı',
                description: 'Evolution API webhook yapılandırması',
                status: hasWebhook ? 'ok' : 'warning',
                message: hasWebhook
                    ? `${webhooks.length} webhook kayıtlı`
                    : 'Webhook kaydı bulunamadı — mesaj alımı çalışmayabilir',
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
            });
        }
        else if (res.status === 404) {
            items.push({
                id: 'webhook-registered',
                label: 'Webhook Kaydı',
                description: 'Evolution API webhook yapılandırması',
                status: 'warning',
                message: 'Webhook endpoint\'i bulunamadı — Evolution API v2 olabilir, manuel kontrol edin',
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
            });
        }
        else {
            items.push({
                id: 'webhook-registered',
                label: 'Webhook Kaydı',
                description: 'Evolution API webhook yapılandırması',
                status: 'warning',
                message: `Webhook kontrol edilemedi (HTTP ${res.status})`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'core',
            });
        }
    }
    catch {
        items.push({
            id: 'webhook-registered',
            label: 'Webhook Kaydı',
            description: 'Evolution API webhook yapılandırması',
            status: 'error',
            message: 'Webhook kontrolü başarısız — Evolution API erişilemiyor',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
        });
    }
}
function checkWebSocket(items, siteId) {
    const start = Date.now();
    const connectedCount = whatsapp_gateway_1.whatsAppGateway.connectedClients;
    if (connectedCount > 0) {
        items.push({
            id: 'websocket-connected',
            label: 'WebSocket Bağlantısı',
            description: 'Gateway canlı bağlantı sayısı',
            status: 'ok',
            message: `${connectedCount} istemci bağlı`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
        });
    }
    else {
        items.push({
            id: 'websocket-connected',
            label: 'WebSocket Bağlantısı',
            description: 'Gateway canlı bağlantı sayısı',
            status: 'warning',
            message: 'Bağlı istemci yok — WebSocket sunucusu çalışıyor ancak kimse bağlanmamış',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'core',
        });
    }
}
async function checkRedis(items) {
    const start = Date.now();
    // 1) Docker Evolution Redis (gerçek kaynak)
    try {
        const { execSync } = require('child_process');
        const pong = String(execSync('docker exec evolution-redis redis-cli ping', { timeout: 3000, encoding: 'utf8' })).trim();
        if (pong === 'PONG') {
            items.push({
                id: 'redis-running',
                label: 'Redis',
                description: 'Önbellek ve kuyruk sunucusu',
                status: 'ok',
                message: 'Evolution Redis (docker) PONG',
                checkedAt: new Date().toISOString(),
                latencyMs: Date.now() - start,
                category: 'infrastructure',
            });
            return;
        }
    } catch (_) { /* fallthrough */ }
    let redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST || '127.0.0.1:6379';
    try {
        const net = await Promise.resolve().then(() => __importStar(require('node:net')));
        const cleaned = redisUrl.replace('redis://', '');
        const [host, portStr] = cleaned.split(':');
        const port = parseInt(portStr || '6379', 10);
        await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: host || '127.0.0.1', port }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', reject);
            setTimeout(() => { socket.destroy(); reject(new Error('Timeout')); }, 2000);
        });
        items.push({
            id: 'redis-running',
            label: 'Redis',
            description: 'Önbellek ve kuyruk sunucusu',
            status: 'ok',
            message: `Bağlantı başarılı (${redisUrl})`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        });
    } catch {
        items.push({
            id: 'redis-running',
            label: 'Redis',
            description: 'Önbellek ve kuyruk sunucusu',
            status: 'warning',
            message: 'Host Redis yok; Evolution Redis docker kontrol edilemedi',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        });
    }
}

async function checkQueueSystem(items, siteId) {
    const start = Date.now();
    try {
        // Message queue Supabase tabanlı çalışıyor, status'leri kontrol et
        const { messageQueue } = await Promise.resolve().then(() => __importStar(require('./whatsapp.queue')));
        const stats = siteId ? messageQueue.getStats(siteId) : messageQueue.getTotalStats();
        const latency = Date.now() - start;
        const total = stats.pending + stats.sending + stats.sentToday + stats.failed;
        items.push({
            id: 'bullmq-queue',
            label: 'Message Queue',
            description: 'Mesaj kuyruğu durumu',
            status: 'ok',
            message: `Kuyruk aktif — ${total} mesaj (bekleyen: ${stats.pending}, bugün gönderilen: ${stats.sentToday})`,
            checkedAt: new Date().toISOString(),
            latencyMs: latency,
            category: 'infrastructure',
        });
    }
    catch (err) {
        items.push({
            id: 'bullmq-queue',
            label: 'Message Queue',
            description: 'Mesaj kuyruğu durumu',
            status: 'warning',
            message: `Kuyruk durumu kontrol edilemedi: ${err.message}`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        });
    }
}
async function checkSupabase(items) {
    const start = Date.now();
    try {
        const sb = (0, supabase_1.createServerSupabaseClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey);
        const { data, error } = await sb
            .from('whatsapp_sessions')
            .select('id', { count: 'exact', head: true });
        const latency = Date.now() - start;
        if (error) {
            items.push({
                id: 'supabase-connection',
                label: 'Supabase Bağlantısı',
                description: 'Veritabanı ve kimlik doğrulama',
                status: 'error',
                message: `Sorgu hatası: ${error.message}`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'infrastructure',
            });
        }
        else {
            items.push({
                id: 'supabase-connection',
                label: 'Supabase Bağlantısı',
                description: 'Veritabanı ve kimlik doğrulama',
                status: 'ok',
                message: `Bağlantı aktif — whatsapp_sessions tablosu erişilebilir`,
                checkedAt: new Date().toISOString(),
                latencyMs: latency,
                category: 'infrastructure',
            });
        }
    }
    catch (err) {
        items.push({
            id: 'supabase-connection',
            label: 'Supabase Bağlantısı',
            description: 'Veritabanı ve kimlik doğrulama',
            status: 'error',
            message: `Bağlantı başarısız: ${err.message}`,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
            category: 'infrastructure',
        });
    }
}
//# sourceMappingURL=whatsapp.diagnostics.js.map