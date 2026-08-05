import type { SessionStatus, ClientConfig, SessionInfo, WsEventPayload, WsEventType } from './whatsapp.types';
import { whatsAppRepository } from './whatsapp.repository';
import { safeFetch, SafeResponse } from '../../lib/fetchCompat';

const EVO_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8083';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '68b9a2abca0d8c4adb3bc5d0d1c5b4082b7417381f76dfb4';

console.log(`[Evo] EvolutionClient modul yuklendi. EVO_URL=${EVO_URL}, EVO_KEY=${EVO_KEY.substring(0, 8)}... (length=${EVO_KEY.length})`);

const POLL_MS = 3000;
const TO = 8000;

export type WsBroadcastFn = (event: WsEventPayload) => void;

async function ffetch(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<SafeResponse> {
  const { timeout = TO, ...rest } = opts;
  return safeFetch(url, rest, timeout);
}

async function g(p: string): Promise<any> {
  const url = EVO_URL + p;
  console.log(`[Evo] GET ${url}`);
  const r = await ffetch(url, { headers: { apikey: EVO_KEY } });
  if (!r.ok) {
    let body = '';
    try { body = await r.text(); } catch {}
    console.error(`[Evo] GET ${p} -> ${r.status}, body(first500)=${body.slice(0, 500)}`);
    throw new Error(`Evo ${p} -> ${r.status}`);
  }
  const text = await r.text();
  console.log(`[Evo] GET ${p} -> ${r.status}, body(first500)=${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function post(p: string, body: Record<string, unknown>): Promise<any> {
  const url = EVO_URL + p;
  console.log(`[Evo] POST ${url}, body=`, JSON.stringify(body));
  const r = await ffetch(url, {
    method: 'POST',
    headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log(`[Evo] POST ${p} -> ${r.status}, body(first500)=${text.slice(0, 500)}`);
  if (!r.ok) throw new Error(`Evo POST ${p} -> ${r.status} body=${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function d(p: string): Promise<void> {
  console.log(`[Evo] DELETE ${EVO_URL + p}`);
  await ffetch(EVO_URL + p, { method: 'DELETE', headers: { apikey: EVO_KEY } });
}

const w = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Mesaj ID çıkar — Evolution v2 TÜM response formatları (RECURSIVE DEEP SCAN) ───
function extractMsgId(data: unknown, depth: number = 0): string | null {
  if (!data || typeof data !== 'object' || depth > 20) return null;
  const d = data as Record<string, unknown>;

  const known = ((d.key as Record<string, unknown>)?.id as string)
    || (((d.message as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string)
    || ((Array.isArray(d.messages) && d.messages.length > 0) ? ((d.messages[0] as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string : null)
    || ((d.data as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string
    || ((d.result as Record<string, unknown>)?.key as Record<string, unknown>)?.id as string
    || (d.id as string)
    || (d.messageId as string)
    || ((d.key as Record<string, unknown>)?.remoteJid as string)
    || null;
  if (known) return known;

  if (Array.isArray(data)) {
    for (let i = 0; i < Math.min((data as unknown[]).length, 50); i++) {
      const found = extractMsgId((data as unknown[])[i], depth + 1);
      if (found) return found;
    }
  } else {
    const keys = Object.keys(d);
    for (const k of keys) {
      const v = d[k];
      if ((k === 'id' || k === 'messageId' || k === 'msgId' || k === 'msg_id') && typeof v === 'string' && v.length > 5) {
        return v;
      }
    }
    for (const k of keys) {
      const v = d[k];
      if (v && typeof v === 'object' && k !== '__proto__' && k !== 'constructor') {
        const found = extractMsgId(v, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

// ═══ FETCH INSTANCES: /instance/fetchInstances → 404/405 ise /instance/list fallback ═══
export async function fetchEvolutionInstances(): Promise<{ instanceName: string; status: string; number?: string; profileName?: string }[]> {
  try {
    const data = await g('/instance/fetchInstances');
    return (Array.isArray(data) ? data : data?.instances || []).map((i: any) => ({
      instanceName: i.instanceName || i.name || 'unknown', status: i.status || i.state || 'unknown',
      number: i.number || i.owner || undefined, profileName: i.profileName || i.pushName || undefined,
    }));
  } catch (err: any) {
    const msg = String(err.message);
    if (msg.includes('404') || msg.includes('405')) {
      console.log(`[Evo] fetchEvolutionInstances: /instance/fetchInstances ${msg.includes('404') ? '404' : '405'} → /instance/list deneniyor...`);
      try {
        const data = await g('/instance/list');
        return (Array.isArray(data) ? data : data?.instances || []).map((i: any) => ({
          instanceName: i.instanceName || i.name || 'unknown', status: i.status || i.state || 'unknown',
          number: i.number || i.owner || undefined, profileName: i.profileName || i.pushName || undefined,
        }));
      } catch (err2: any) {
        console.error(`[Evo] fetchEvolutionInstances: /instance/list de başarısız: ${err2.message}`);
        throw err;
      }
    }
    throw err;
  }
}

export async function pingEvolutionApi(): Promise<{ alive: boolean; error?: string; version?: string; instances?: any[] }> {
  try {
    const r = await safeFetch(EVO_URL + '/instance/fetchInstances', { headers: { apikey: EVO_KEY } as Record<string, string> }, 5000);
    if (!r.ok) {
      // /instance/list fallback
      try {
        const r2 = await safeFetch(EVO_URL + '/instance/list', { headers: { apikey: EVO_KEY } as Record<string, string> }, 5000);
        if (r2.ok) {
          const data2 = await r2.json();
          return { alive: true, version: 'v2.x', instances: Array.isArray(data2) ? data2 : [] };
        }
      } catch {}
      
      // ═══ Evolution API v2.3.7 uyumluluk: /instance/fetchInstances ve /instance/list
      // endpoint'leri bu sürümde yok. 404 almak API'nin OFFLINE olduğu anlamına GELMEZ.
      // Root URL'e ping atarak canlı olduğunu teyit edelim. ═══
      try {
        const r3 = await safeFetch(EVO_URL, {}, 3000);
        if (r3.ok) {
          console.log('[Evo] pingEvolutionApi: fetchInstances/list yok ama root canlı — Evolution API v2.3.7 alive (limited API)');
          return { alive: true, version: 'v2.3.7-limited', instances: [] };
        }
      } catch {}
      
      // Root da yanıt vermiyor, ama belki de 404 döndüğü halde API canlı.
      // HTTP 404 = API AYAKTA, endpoint yok. HTTP bağlantı hatası DEĞİL.
      if (r.status === 404 || r.status === 405) {
        console.log(`[Evo] pingEvolutionApi: fetchInstances ${r.status} — API canlı ancak endpoint yok (v2.3.7)`);
        return { alive: true, version: 'v2.3.7-limited', instances: [] };
      }
      
      return { alive: false, error: `HTTP ${r.status}`, instances: [] };
    }
    const data = await r.json();
    const list: any[] = Array.isArray(data) ? data : data?.instances || [];
    return { alive: true, version: 'v2.x', instances: list.map((i: any) => ({
      instanceName: i.instanceName || i.name || 'unknown', status: i.status || i.state || 'unknown',
      number: i.number || i.owner || undefined, profileName: i.profileName || i.pushName || undefined,
    })) };
  } catch (err: any) {
    // Connection refused / timeout / DNS hatası — gerçekten offline olabilir
    try { 
      const r2 = await safeFetch(EVO_URL, {}, 3000); 
      if (r2.ok) {
        console.log('[Evo] pingEvolutionApi: root canlı (catch sonrası) — Evolution API v2.3.7 alive');
        return { alive: true, version: 'v2.3.7-limited', instances: [] }; 
      }
    } catch {}
    return { alive: false, error: err.message || 'unreachable' };
  }
}

export class EvolutionClient {
  readonly siteId: string; readonly companyId: string | undefined; readonly instanceName: string;
  private st: SessionStatus = 'DISCONNECTED'; private ph: string | null = null; private pf: string | null = null;
  private qr: string | null = null; private er: string | null = null; private ca: string | null = null;
  private _ca = Date.now(); private la = Date.now(); private bc: WsBroadcastFn | null = null;
  private ti: ReturnType<typeof setInterval> | null = null; private de = false;

  constructor(cfg: ClientConfig) {
    this.siteId = cfg.siteId; this.companyId = cfg.companyId;
    const rawName = cfg.instanceName || cfg.companyId || cfg.siteId;
    this.instanceName = this.sanitizeInstanceName(rawName);
    console.log(`[Evo] EvolutionClient oluşturuldu: siteId=${this.siteId}, companyId=${this.companyId}, instanceName=${this.instanceName}, EVO_URL=${EVO_URL}`);
  }

  private sanitizeInstanceName(input: string): string {
    return String(input || '')
      .toLowerCase()
      .trim()
      .replace(/-/g, '_')          // UUID tirelerini alt çizgiye çevir
      .replace(/[^a-z0-9_]/g, ''); // Evolution API uyumlu: sadece alfanumerik + alt çizgi
  }

  // ═══ Evolution v2.3.7: instance ismine _timestamp eklenir, prefix eşleşmesi ile bul ═══
  private async ensureInstance(): Promise<void> {
    console.log(`[Evo] ensureInstance başladı: instanceName=${this.instanceName}, EVO_URL=${EVO_URL}`);

    let instances: { instanceName: string; status: string }[];
    try {
      instances = await fetchEvolutionInstances();
    } catch (err: any) {
      console.error(`[Evo] fetchInstances BAŞARISIZ: ${err.message}`);
      throw err;
    }
    console.log(`[Evo] fetchInstances sonucu: ${instances.length} instance bulundu, liste=`, JSON.stringify(instances.map(i => i.instanceName)));

    const exactMatch = instances.find(i => i.instanceName === this.instanceName);
    if (exactMatch) {
      console.log(`[Evo] Instance tam eşleşme bulundu: ${this.instanceName}`);
      return;
    }
    
    const prefixMatch = instances.find(i => i.instanceName.startsWith(this.instanceName + '_'));
    if (prefixMatch) {
      console.log(`[Evo] Instance prefix eşleşme bulundu: ${prefixMatch.instanceName} (aranan: ${this.instanceName}) — instanceName güncelleniyor`);
      this.instanceName = prefixMatch.instanceName;
      return;
    }

    console.log(`[Evo] Instance bulunamadı, oluşturuluyor: ${this.instanceName}`);
    let createResult: any;
    try {
      createResult = await post('/instance/create', {
        instanceName: this.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      console.log(`[Evo] createInstance sonucu (ilk 500):`, JSON.stringify(createResult).slice(0, 500));

      if (createResult?.error === true || createResult?.status === 'error') {
        const errMsg = createResult?.message || createResult?.response?.message || 'Instance oluşturma başarısız (Evolution API hata raporladı)';
        console.error(`[Evo] createInstance Evolution API hata raporladı: ${errMsg}, body=`, JSON.stringify(createResult).slice(0, 500));
        throw new Error(errMsg);
      }

      if (!createResult || (typeof createResult === 'object' && Object.keys(createResult).length === 0)) {
        console.warn(`[Evo] createInstance boş yanıt döndü — instance oluşturulmuş olabilir, devam ediliyor`);
      }
    } catch (err: any) {
      if (String(err.message).includes('409') || String(err.message).includes('403') || String(err.message).includes('already exists') || String(err.message).includes('already in use')) {
        console.log(`[Evo] Instance zaten mevcut (409): ${this.instanceName}`);
        return;
      }
      if (String(err.message).includes('400') || String(err.message).includes('Bad Request')) {
        console.error(`[Evo] createInstance 400 Bad Request — instance adı geçersiz olabilir: ${this.instanceName}`);
        throw new Error(`Evolution API instance oluşturma reddedildi (400). Instance adı "${this.instanceName}" geçersiz olabilir.`);
      }
      console.error(`[Evo] createInstance BAŞARISIZ: ${err.message}`);
      throw err;
    }
    console.log(`[Evo] Instance başarıyla oluşturuldu: ${this.instanceName}`);

    // ═══ Evolution v2.3.7 FIX: Oluşturduktan sonra gerçek ismi bul ═══
    await w(1000);
    
    try {
      const updatedInstances = await fetchEvolutionInstances();
      const updatedExact = updatedInstances.find(i => i.instanceName === this.instanceName);
      if (updatedExact) {
        console.log(`[Evo] Oluşturulan instance tam eşleşme bulundu: ${this.instanceName}`);
        return;
      }
      const updatedPrefix = updatedInstances.find(i => i.instanceName.startsWith(this.instanceName + '_'));
      if (updatedPrefix) {
        console.log(`[Evo] Evolution timestamp ekledi! Gerçek isim: ${updatedPrefix.instanceName} (aranan: ${this.instanceName}) — instanceName güncelleniyor`);
        this.instanceName = updatedPrefix.instanceName;
        return;
      }
      console.warn(`[Evo] Oluşturulan instance fetchInstances'da bulunamadı! Aranan: ${this.instanceName}, mevcut: ${updatedInstances.map(i => i.instanceName).join(', ')}`);
    } catch (refetchErr: any) {
      console.warn(`[Evo] Oluşturma sonrası refetch başarısız: ${refetchErr.message} — orijinal isimle devam ediliyor`);
    }
  }

  // ═══ FETCH INSTANCES'A BAĞIMLI OLMAYAN INSTANCE GARANTILEME ═══
  // Direkt create dener, 409 (zaten var) alırsa geçer.
  private async ensureInstanceDirect(): Promise<void> {
    console.log(`[Evo] ensureInstanceDirect: ${this.instanceName}`);
    try {
      await post('/instance/create', {
        instanceName: this.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      console.log(`[Evo] ensureInstanceDirect: instance oluşturuldu (veya zaten vardı)`);
    } catch (err: any) {
      const msg = String(err.message);
      if (msg.includes('409') || msg.includes('403') || msg.includes('already exists') || msg.includes('already in use') || msg.includes('name already in use')) {
        console.log(`[Evo] ensureInstanceDirect: instance zaten mevcut (409) — devam`);
        return;
      }
      // 400 genelde instance adı formatı sorunu, ama denemeye devam
      console.warn(`[Evo] ensureInstanceDirect create hatası: ${msg} — yine de deneniyor`);
    }
  }

  // ═══ SADECE INSTANCE OLUŞTUR — başka hiçbir şey yapma ═══
  private async createInstanceOnly(): Promise<void> {
    console.log(`[Evo] createInstanceOnly: ${this.instanceName}`);
    try {
      await post('/instance/create', {
        instanceName: this.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      console.log(`[Evo] createInstanceOnly: başarılı`);
      await w(1000);
    } catch (err: any) {
      const msg = String(err.message);
      if (msg.includes('409') || msg.includes('403') || msg.includes('already exists') || msg.includes('already in use') || msg.includes('name already in use')) {
        console.log(`[Evo] createInstanceOnly: zaten mevcut (409)`);
        return;
      }
      console.error(`[Evo] createInstanceOnly BAŞARISIZ: ${msg}`);
    }
  }

  setBroadcast(fn: WsBroadcastFn): void { this.bc = fn; }

  // ═══ BAĞLAN: POST /instance/create (qrcode:true) ile QR al, yoksa /instance/qr dene ═══
  async connect(): Promise<{ success: boolean; qrCode?: string; error?: string; errorType?: string; userMessage?: string }> {
    if (this.de) return { success: false, error: 'destroyed', errorType: 'instance_destroyed', userMessage: 'WhatsApp oturumu kapatılmış.' };
    if (this.st === 'CONNECTED') return { success: true };
    this.stopPolling(); this._s('LOADING'); this.qr = null; this.er = null;

    const MAX_RETRIES = 3;
    const enc = encodeURIComponent(this.instanceName);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Evo] connect() — Deneme ${attempt + 1}/${MAX_RETRIES + 1}: instance=${this.instanceName}, EVO_URL=${EVO_URL.replace(/\/\/.*@/, '//***@')}`);

        // ═══ 1. Instance oluştur / garantile (POST /instance/create, qrcode: true) ═══
        let createData: any;
        try {
          createData = await post('/instance/create', {
            instanceName: this.instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          });
          const createKeys = createData && typeof createData === 'object' ? Object.keys(createData).join(',') : 'none';
          const hasQr = !!(createData?.base64 || createData?.code || createData?.qr || createData?.qr_code || createData?.qrcode);
          console.log(`[Evo] connect() — POST /instance/create yanıt: keys=[${createKeys}], hasQr=${hasQr}, status=${createData?.status || 'N/A'}, instance=${createData?.instance?.instanceName || this.instanceName}`);
        } catch (createErr: any) {
          const createMsg = String(createErr.message);
          // 409 = zaten var, devam et
          if (createMsg.includes('409') || createMsg.includes('403') || createMsg.includes('already exists') || createMsg.includes('already in use') || createMsg.includes('name already in use')) {
            console.log(`[Evo] connect() — Instance zaten mevcut (409), devam`);
            createData = null;
          } else if (createMsg.includes('400')) {
            console.error(`[Evo] connect() — POST /instance/create 400 Bad Request: instanceName="${this.instanceName}" geçersiz olabilir`);
            throw new Error(`Evolution API instance oluşturma reddedildi (400). Instance adı "${this.instanceName}" geçersiz olabilir.`);
          } else {
            console.warn(`[Evo] connect() — POST /instance/create hata: ${createMsg}`);
            throw createErr;
          }
        }

        // ═══ 2. QR kodu response'dan çıkar (/instance/create zaten QR döndürebilir) ═══
        const rawQr = createData?.base64 || createData?.code || createData?.qr || createData?.qr_code || createData?.qrcode?.base64 || createData?.qrcode?.qr_code || (typeof createData?.qrcode === 'string' ? createData.qrcode : null) || null;
        if (rawQr && typeof rawQr === 'string') {
          this.qr = rawQr.startsWith('data:') ? rawQr : 'data:image/png;base64,' + rawQr;
          this._s('WAITING_QR'); this._e('qr', { qrCode: this.qr });
          this._db({ status: 'WAITING_QR', qr_code: this.qr }); this.startPolling();
          console.log(`[Evo] connect() — ✅ QR kodu /instance/create yanıtından alındı (uzunluk: ${this.qr.length})`);
          return { success: true, qrCode: this.qr };
        }

        // ═══ 3. QR yoksa /instance/qr dene (Evolution API v2 standart) ═══
        try {
          const qrData = await g('/instance/qr/' + enc);
          const qrKeys = qrData && typeof qrData === 'object' ? Object.keys(qrData).join(',') : 'none';
          console.log(`[Evo] connect() — GET /instance/qr yanıt: keys=[${qrKeys}], hasBase64=${!!qrData?.base64}, hasCode=${!!qrData?.code}, hasQr=${!!qrData?.qr}`);
          const raw = qrData?.base64 || qrData?.code || qrData?.qr || qrData?.qr_code || qrData?.qrcode?.base64 || qrData?.qrcode?.qr_code || (typeof qrData?.qrcode === 'string' ? qrData.qrcode : null) || null;
          if (raw && typeof raw === 'string') {
            this.qr = raw.startsWith('data:') ? raw : 'data:image/png;base64,' + raw;
            this._s('WAITING_QR'); this._e('qr', { qrCode: this.qr });
            this._db({ status: 'WAITING_QR', qr_code: this.qr }); this.startPolling();
            console.log(`[Evo] connect() — ✅ QR kodu /instance/qr'dan alındı (uzunluk: ${this.qr.length})`);
            return { success: true, qrCode: this.qr };
          }
          console.warn(`[Evo] connect() — /instance/qr yanıt verdi ama QR alanı boş! keys=[${qrKeys}]`);
        } catch (qrErr: any) {
          console.warn(`[Evo] connect() — /instance/qr hata: ${qrErr.message}`);
        }

        // ═══ 4. QR hâlâ yoksa connectionState kontrol et (zaten bağlı olabilir) ═══
        try {
          const stateData = await g('/instance/connectionState/' + enc);
          const rawState = stateData?.instance?.state || stateData?.state || 'close';
          console.log(`[Evo] connect() — GET /instance/connectionState: state=${rawState}`);
          if (rawState === 'open') {
            await this._onC();
            console.log(`[Evo] connect() — ✅ Instance zaten bağlı (open), bağlantı hazır`);
            return { success: true };
          }
        } catch (stateErr: any) {
          console.warn(`[Evo] connect() — /instance/connectionState hata: ${stateErr.message}`);
        }

        // ═══ 5. InstanceName timestamp güncellemesi (Evolution v2.3.7) ═══
        try {
          const instances = await fetchEvolutionInstances();
          const prefixMatch = instances.find(i => i.instanceName.startsWith(this.instanceName + '_'));
          if (prefixMatch) {
            console.log(`[Evo] connect() — InstanceName timestamp güncellemesi: ${this.instanceName} → ${prefixMatch.instanceName}`);
            this.instanceName = prefixMatch.instanceName;
            continue; // Yeni isimle loop'a geri dön
          }
        } catch {}

        // ═══ 6. TÜM QR GİRİŞİMLERİ BAŞARISIZ ═══
        // Polling'i yine başlat — QR daha sonra gelebilir (Evolution async QR üretimi)
        // Ama bu request'e QR olmadan success dönme!
        this.startPolling();
        const errMsg = `QR üretilemedi. Evolution API instance oluşturuldu ancak QR kodu henüz hazır değil. Instance: ${this.instanceName}`;
        console.error(`[Evo] connect() — ❌ QR alınamadı! Instance oluşturuldu (veya zaten vardı) ama /instance/create ve /instance/qr endpointleri QR döndürmedi. Polling başlatıldı, QR daha sonra alınabilir.`);
        this._s('ERROR');
        this.er = 'qr_generation_failed';
        this._e('connection_error', { reason: 'qr_generation_failed', instanceName: this.instanceName });
        this._db({ status: 'ERROR', error: 'qr_generation_failed', instanceName: this.instanceName });
        return { 
          success: false, 
          error: 'qr_generation_failed', 
          errorType: 'qr_generation_failed', 
          userMessage: errMsg,
        };
      } catch (err: any) {
        const m = String(err.message);
        console.error(`[Evo] connect() Deneme ${attempt + 1} HATA: ${m}`);

        if (m.includes('404') && attempt < MAX_RETRIES) {
          console.log(`[Evo] 404 alındı — instance silinmiş olabilir. Instance silinip tekrar denenecek...`);
          try {
            await d('/instance/delete/' + encodeURIComponent(this.instanceName));
            console.log(`[Evo] Eski instance silindi: ${this.instanceName}`);
          } catch (delErr) {
            console.log(`[Evo] Eski instance silme hatası (muhtemelen zaten yok):`, delErr);
          }
          await w(2000 + attempt * 1000);
          continue;
        }

        if (m.includes('409') && attempt < MAX_RETRIES) {
          console.log(`[Evo] 409 Conflict alındı — 2 saniye bekleyip tekrar denenecek...`);
          await w(2000);
          continue;
        }

        let errorType = 'evolution_api_error';
        let userMessage = `Evolution API hatası: ${m}`;

        if (m.includes('404')) {
          errorType = 'evolution_instance_not_found';
          userMessage = 'WhatsApp instance bulunamadı ve yeniden oluşturulamadı. Evolution API container çalışıyor olabilir ancak instance oluşturma başarısız. Lütfen sistem yöneticinize başvurun.';
        } else if (m.includes('aborted') || m.includes('timeout') || m.includes('AbortError')) {
          errorType = 'evolution_timeout';
          userMessage = 'Evolution API yanıt vermiyor — zaman aşımı. Lütfen daha sonra tekrar deneyin.';
        } else if (m.includes('ECONNREFUSED') || m.includes('ENOTFOUND') || m.includes('fetch failed')) {
          errorType = 'evolution_unreachable';
          userMessage = `Evolution API'ye erişilemiyor (${EVO_URL}). Lütfen sistem yöneticinize başvurun.`;
        }

        this._s('ERROR'); this.er = m;
        this._e('connection_error', { reason: m }); this._db({ status: 'ERROR', error: m });
        return { success: false, error: m, errorType, userMessage };
      }
    }

    return { success: false, error: 'max_retries_exceeded', errorType: 'evolution_api_error', userMessage: 'Maksimum deneme sayısına ulaşıldı.' };
  }

  async disconnect(): Promise<void> {
    this.stopPolling(); this._s('DISCONNECTED');
    try { await d('/instance/logout/' + encodeURIComponent(this.instanceName)); } catch {}
    this.qr = null; this.ph = null; this.pf = null; this.ca = null;
    this._e('disconnected', { reason: 'kullanici', willReconnect: false });
    this._db({ status: 'DISCONNECTED', qr_code: null, phone_number: null, connected_at: null, error: null });
  }

  async reconnect(): Promise<{ success: boolean; qrCode?: string; error?: string; errorType?: string; userMessage?: string }> {
    await this.disconnect(); await w(2000); return this.connect();
  }

  async destroy(): Promise<void> {
    this.de = true; this.stopPolling(); this.bc = null;
    try { await d('/instance/delete/' + encodeURIComponent(this.instanceName)); } catch {}
  }

  startPolling(): void {
    if (this.de) return;
    this.ti = setInterval(() => {
      if (this.de) return;
      this.checkConnectionState().then(s => {
        if (s === 'open' && this.st !== 'CONNECTED') this._onC();
        else if ((s === 'close' || s === 'refused') && this.st === 'CONNECTED') this._onD('baglanti_koptu', true);
      }).catch(() => {});
    }, POLL_MS);
  }

  stopPolling(): void { if (this.ti) { clearInterval(this.ti); this.ti = null; } }

  async fetchQr(): Promise<string | null> { return this.qr || this.fetchQrViaConnect(); }

  // ═══ QR AL: GET /instance/qr önce, yoksa POST /instance/create dene ═══
  async fetchQrViaConnect(): Promise<string | null> {
    try {
      const enc = encodeURIComponent(this.instanceName);

      let data: any;
      // Önce /instance/qr dene (Evolution API v2 standart)
      try {
        data = await g('/instance/qr/' + enc);
        console.log(`[Evo] fetchQrViaConnect() GET /instance/qr başarılı`);
      } catch (getErr: any) {
        const getMsg = String(getErr.message);
        console.warn(`[Evo] fetchQrViaConnect() GET /instance/qr başarısız: ${getMsg}, POST /instance/create deneniyor...`);
        try {
          data = await post('/instance/create', { instanceName: this.instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
          console.log(`[Evo] fetchQrViaConnect() POST /instance/create başarılı`);
        } catch (postErr: any) {
          const postMsg = String(postErr.message);
          console.warn(`[Evo] fetchQrViaConnect() POST da başarısız: ${postMsg}`);
          if (postMsg.includes('404')) {
            await this.createInstanceOnly();
            await w(2000);
            try {
              data = await g('/instance/qr/' + enc);
            } catch {
              data = await post('/instance/create', { instanceName: this.instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
            }
          } else if (postMsg.includes('409') || postMsg.includes('403') || postMsg.includes('already exists') || postMsg.includes('already in use') || postMsg.includes('name already in use')) {
            // Zaten var, tekrar /instance/qr dene
            data = await g('/instance/qr/' + enc);
          } else {
            throw postErr;
          }
        }
      }

      const raw = data?.base64 || data?.code || data?.qr || data?.qr_code || data?.qrcode?.base64 || data?.qrcode?.qr_code || (typeof data?.qrcode === 'string' ? data.qrcode : null) || null;
      return raw ? (raw.startsWith('data:') ? raw : 'data:image/png;base64,' + raw) : null;
    } catch { return null; }
  }

  async checkConnectionState(): Promise<string> {
    try {
      await this.ensureInstanceDirect();

      const data = await g('/instance/connectionState/' + encodeURIComponent(this.instanceName));
      const rawState = data?.instance?.state || data?.state || 'close';
      if (rawState === 'open' && this.st !== 'CONNECTED') {
        console.log(`[Evo] checkConnectionState: canlı durum=open, bellek=${this.st} → _onC() çağrılıyor`);
        await this._onC();
      }
      return rawState;
    } catch {
      return 'close';
    }
  }

  async sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string; response?: any; msgId?: string | null }> {
    if (this.st !== 'CONNECTED') {
      console.log(`[EvoClient] sendMessage: bellek state=${this.st}, canlı kontrol ediliyor...`);
      try {
        const liveState = await this.checkConnectionState();
        console.log(`[EvoClient] sendMessage: canlı state=${liveState}`);
        if (liveState === 'open') {
          await this._onC();
          console.log(`[EvoClient] sendMessage: canlı state open → bellek state CONNECTED yapıldı`);
        } else {
          console.warn(`[EvoClient] sendMessage: canlı state=${liveState}, oturum gerçekten kapalı`);
          return { success: false, error: `oturum yok (canlı state: ${liveState})` };
        }
      } catch (err: any) {
        console.error(`[EvoClient] sendMessage: canlı state kontrol hatası: ${err.message}`);
        return { success: false, error: `oturum yok (state kontrol hatası: ${err.message})` };
      }
    }

    if (!this.instanceName || this.instanceName.trim() === '') {
      console.error(`[EvoClient] sendMessage: instanceName boş! siteId=${this.siteId}`);
      return { success: false, error: 'instance_name_bos: Evolution instance adı tanımlı değil' };
    }

    try {
      const n = phone.replace(/[\s\-\(\)+]/g, '').replace(/^0/, '90');
      const url = EVO_URL + '/message/sendText/' + encodeURIComponent(this.instanceName);
      console.log(`[EvoClient] sendMessage: POST ${url}, to=${n}, instance=${this.instanceName}`);

      const res = await ffetch(url, {
        method: 'POST', headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: n, text: message, delay: 1200, linkPreview: false }),
      });

      let body: any = {};
      try {
        const text = await res.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: 'parse_failed' };
      }

      if (!res.ok) {
        const errMsg = body?.error || body?.message || `HTTP ${res.status}`;
        console.error(`[EvoClient] sendMessage HTTP hatası: ${res.status}, body=`, JSON.stringify(body).slice(0, 300));
        return { success: false, error: errMsg, response: body };
      }

      if (body?.error === true || body?.status === 'error' || body?.state === 'ERROR') {
        const errMsg = body?.message || body?.errorMessage || body?.text || 'Evolution API hatası';
        console.error(`[EvoClient] sendMessage Evolution hatası: ${errMsg}, body=`, JSON.stringify(body).slice(0, 300));
        return { success: false, error: errMsg, response: body };
      }

      const msgId = extractMsgId(body);

      if (!msgId) {
        const responseKeys = Object.keys(body || {});
        const bodyPreview = JSON.stringify(body).slice(0, 2000);
        console.error(`[EvoClient] sendMessage BAŞARISIZ — msgId YOK: to=${n}, status=${res.status}, keys=[${responseKeys.join(',')}], body=${bodyPreview}`);
        return {
          success: false,
          error: `WhatsApp mesaj ID'si alınamadı. Sunucu yanıtı beklenenden farklı olabilir.`,
          response: body,
          msgId: null,
        };
      }

      console.log(`[EvoClient] sendMessage BAŞARILI: to=${n}, msgId=${msgId}`);
      this.la = Date.now();
      return { success: true, response: body, msgId };
    } catch (err: any) {
      console.error(`[EvoClient] sendMessage exception: ${err.message}`);
      return { success: false, error: String(err.message) };
    }
  }

  getStatus(): SessionStatus { return this.st; }
  isConnected(): boolean { return this.st === 'CONNECTED'; }
  getQrCode(): string | null { return this.qr; }
  getPhoneNumber(): string | null { return this.ph; }
  getInfo(): SessionInfo { return this.getSessionInfo(); }

  getSessionInfo(): SessionInfo {
    return { siteId: this.siteId, companyId: this.companyId, status: this.st, phoneNumber: this.ph,
      profileName: this.pf, battery: null, lastSeen: null, connectedAt: this.ca,
      sessionAge: Math.floor((Date.now() - this._ca) / 1000), qrCode: this.qr, error: this.er,
      createdAt: this._ca, lastActivity: this.la };
  }

  async syncToDb(): Promise<void> {
    try { await whatsAppRepository.upsertSession({ siteId: this.siteId, companyId: this.companyId,
      status: this.st, phoneNumber: this.ph, qrCode: this.qr, connectedAt: this.ca, error: this.er, profileName: this.pf,
      instanceName: this.instanceName }); }
    catch (err: any) { console.warn('[Evo] syncToDb:', err.message); }
  }

  private _s(s: SessionStatus): void { const p = this.st; this.st = s; if (p !== s) this._e('state_change', { status: s, prev: p }); }

  private _e(ev: WsEventType, data: unknown): void { if (this.bc) this.bc({ siteId: this.siteId, companyId: this.companyId, event: ev, data, timestamp: new Date().toISOString() }); }

  private async _db(o: Record<string, unknown>): Promise<void> {
    try { await whatsAppRepository.upsertSession({ siteId: this.siteId, companyId: this.companyId,
      status: String(o.status ?? this.st), phoneNumber: o.phone_number !== undefined ? (o.phone_number as string | null) : this.ph,
      qrCode: o.qr_code !== undefined ? (o.qr_code as string | null) : this.qr,
      connectedAt: o.connected_at !== undefined ? (o.connected_at as string | null) : this.ca,
      error: o.error !== undefined ? (o.error as string | null) : this.er, profileName: this.pf,
      instanceName: o.instanceName !== undefined ? (o.instanceName as string | null) : this.instanceName }); }
    catch (err: any) { console.warn('[Evo] _db:', err.message); }
  }

  private async _onC(): Promise<void> {
    this.ca = new Date().toISOString(); this.er = null; this.qr = null; this.la = Date.now(); this._s('CONNECTED');
    try { const info = await g('/instance/fetchInstances?instanceName=' + encodeURIComponent(this.instanceName));
      if (info?.instance?.owner) this.ph = info.instance.owner.replace(/\D/g, '');
      if (info?.instance?.profileName) this.pf = info.instance.profileName; } catch {}
    this._e('ready', { phoneNumber: this.ph || '?', profileName: this.pf || undefined });
    this._e('authenticated', { phoneNumber: this.ph || '?', profileName: this.pf || undefined });
    this._db({ status: 'CONNECTED', connected_at: this.ca, error: null, phone_number: this.ph, qr_code: null, instanceName: this.instanceName });
  }

  private _onD(reason: string, rec: boolean): void { this._s('RECONNECTING'); this.er = reason;
    this._e('disconnected', { reason, willReconnect: rec }); this._db({ status: 'RECONNECTING', error: reason, instanceName: this.instanceName }); }
}