# KURTARMA AŞAMA 1 — DEĞİŞİKLİK ENVANTERİ

| Alan | Değer |
|------|--------|
| **Belge** | Cursor kurtarma promptu Aşama 1 (yalnızca analiz) |
| **Tarih** | 2026-08-03 |
| **Prompt** | `c:\Users\HP\Downloads\cursor-kurtarma-promptu (3).md` |
| **Kapsam** | Chat arşivi + `_patch` artefaktları + mevcut hasar dokümanları |
| **Kod uygulaması** | **YOK** — `"ONAYLIYORUM"` gelmeden Aşama 3 yok |
| **Canlı** | Dokunulmadı (landing symlink / publish yok) |
| **WhatsApp** | Envanterde kayıtlı; **HARD LOCK** — Aşama 3’te uygulama yok (açık komut yok) |

> **Bağlam düzeltmesi:** Sunucu ayakta (`landing` → `overview-compact-restored-20260802`, PM2 online). Bu envanter **canlıyı ezecek tam sunucu yeniden kurulum planı değildir**; chat’ten tespit edilen değişikliklerin listesidir.

---

## 0. Yedek / taban seçimi (placeholder doldurma)

MD’deki yollar boştu; Aşama 1 için şu adaylar belgelendi (**henüz çalışma kopyası oluşturulmadı** — envanter `docs/` altında):

| Rol | Seçilen / aday yol | Not |
|-----|-------------------|-----|
| **Önerilen frontend tabanı** | `C:\Users\HP\Downloads\src\` | Tam `pages/dashboard/*` ağacı var (overview, residents, communication-center…) |
| **API / relay yedek** | `C:\Users\HP\Downloads\ProYonetim-Yedekler\PROYONETIM-LIVE-SOURCE-EXTRACTED\` | Ağırlık API + WhatsApp modülleri (2026-07-12) |
| **Tam canlı arşiv** | `...\ProYonetim-Yedekler\PROYONETIM-CANLI-TAM-YEDEK-20260712-*.tar.gz` | ~685 MB; açılmadı (Aşama 1 gerekmedi) |
| **Readdy overview ZIP** | `C:\Users\HP\Desktop\project-12230676.zip` + `_patch\readdy-12230676\` | Chat #0037–#0041; ana sayfa kaynağı |
| **Eksik “orijinal Readdy”** | `Downloads\project-11603480 (1)\` | Tam proje değil (2 dosya) — **taban olarak uygun değil** |
| **Çalışma kopyası (öneri, henüz yok)** | `C:\Users\HP\Projects\proyonetim-kurtarma-work` | Aşama 3 + `"ONAYLIYORUM"` sonrası; canlı overwrite yok |

**Seçim gerekçesi:** Aşama 1 envanter için en kullanılabilir kaynak kod `Downloads\src` + chat/`_patch`. Canlı sunucu zaten ayakta; yedekten sıfırdan publish **koruma kurallarına aykırı** olur.

---

## 1. Tarama kapsamı

| Kaynak | Sonuç |
|--------|--------|
| Cursor sohbetler (`proyonetim-radore-ops`, `Downloads-src`, `empty-window`) | **16** benzersiz ana sohbet (dedupe) |
| Ham kullanıcı sorguları | `docs/_kurtarma_user_queries_raw.txt` → **548** satır |
| `_patch` artefaktları | ~**283** dosya/klasör (`deploy_*` 43, `fix_*` 28, …) |
| Önceki hasar belgeleri | `docs/PROYONETIM-HASAR-ENVANTERI-2026-08-03.md`, `docs/SISTEM-DURUM-RAPORU-2026-08-03.md` |
| Ham tarama JSON | `_patch/kurtarma_scan_raw.json` |

**Sınır:** Temmuz 2026 öncesi / Readdy içi tüm geçmiş bu Cursor arşivinde olmayabilir. “Tahmin yok” kuralı gereği yalnızca somut kanıtlı maddeler numaralandı.

---

## DEĞİŞİKLİK ENVANTERİ

### [#001] WhatsApp / İletişim Merkezi restore ve gönderim omurgası
- **Kategori:** Hata Düzeltme / Yeni Özellik
- **Etkilenen dosyalar:** `page-C37hUW5w2.js` / `page-CKFOdH2C2-*`, `/api/whatsapp/*`, `api/radore-api/src/modules/whatsapp/*`, send-relay, credentials-relay
- **Ne yapıldı:** Temmuz ortası WhatsApp UI restore, landing/bağlantı, health, gönderim ve cihaz bağlama akışları üzerinde yoğun çalışma.
- **Kaynak:** empty-window `3e3723b0` / `9c6cbe50` (18 Tem); ops `78f50806`/`ca0143d3` (18 Tem); `f963ad1a` / `ddbaaff6` (18–20 Tem)
- **Kod kaydı:** 🟡 Kısmi (`_patch` scriptleri + yedek API; canlı minified tam kaynak chat’te yok)
- **Bağımlılık:** —
- **Aşama 3 notu:** ⛔ **HARD LOCK** — kullanıcı WhatsApp’ı isimle komutlamadı; uygulamaya alınmaz

### [#002] Landing 403 / dosya izni / symlink restore
- **Kategori:** Hata Düzeltme
- **Etkilenen dosyalar:** `/var/www/proyonetim/landing`, `index.html`, assets mode bits
- **Ne yapıldı:** WhatsApp restore sonrası 403 (mode 600) ve landing hedef düzeltmeleri.
- **Kaynak:** `ca0143d3` (18 Tem 20:00)
- **Kod kaydı:** 🟡 Kısmi (shell komutları chat’te; kalıcı kaynak patch sınırlı)
- **Bağımlılık:** #001 ile ilişkili (aynı restore zinciri)
- **Aşama 3 notu:** Canlı symlink değişimi **publish onayı** ister; şu an sunucu ayakta — kör restore yasak

### [#003] Admin kontrol paneli — şirket / birim görünümü
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `src/pages/admin/control-panel/page.tsx`, `CompaniesOverviewSection.tsx`, `src/router/config.tsx`, staging `admin-companies-20260718-1800`
- **Ne yapıldı:** Admin companies/units panel staging + dikkatli canlı publish talebi.
- **Kaynak:** `e617ef60` (18 Tem); kontrol paneli sorguları 19–23 Tem
- **Kod kaydı:** 🟡 Kısmi (`Downloads/src` + staging yolları; birebir son hali belirsiz)
- **Bağımlılık:** Router (# config) ile bağlı

### [#004] Tek blokta daire kaydı / sıralama
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** units chunk (`page-BB-walua2-singleblock-*`), `_patch/patch_units_singleblock_sort.py`, Cursor kuralı `single-block-unit-order`
- **Ne yapıldı:** Tek bloklu sitelerde blok seçimi zorunlu değil; daire no sıralaması `1-10` localeCompare hatası giderildi; ürün kuralı: görünen no = `daire_no`.
- **Kaynak:** `dc536d18` 20 Tem 23:25; 2 Ağu 20:15
- **Kod kaydı:** 🟡 Kısmi (patch script + kural; tam TS kaynak her zaman yok)
- **Bağımlılık:** —

### [#005] İcra / avukata sevk — kırmızı uyarı
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/IcraFollowWarning.tsx`, `icraReferral.ts`, `loadUnitIcraStatus.ts`, `deploy_icra_*.sh`, şema probe scriptleri
- **Ne yapıldı:** İcra/avukat sürecindeki sakinlerde kırmızı uyarı; ödeme sonrası temizleme; şema düzeltmeleri.
- **Kaynak:** `dc536d18` 20–21 Tem; patch ailesi
- **Kod kaydı:** ✅ Tam kod mevcut (`_patch` TS + deploy script)
- **Bağımlılık:** Sakin/kişi kartı UI ile birlikte

### [#006] Eski kiracı arşiv / birim yaşam döngüsü
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/occupantLifecycle.ts`, `UnitOccupantLifecycle.tsx`, `resident-panel-page.tsx`, staging `occupant-lifecycle-*`
- **Ne yapıldı:** Kiracı çıkışı / satış / taşınma için “eski kiracı” arşiv bölümü ve anahtar/kaldırma akışı.
- **Kaynak:** `dc536d18` 21 Tem 00:01; 20 Tem 21:37
- **Kod kaydı:** ✅ Tam kod mevcut (`_patch`)
- **Bağımlılık:** Sakin paneli

### [#007] ProY sesli asistan / otonom borç-kasa
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/voice-assistant-page.tsx`, `voiceUnitQuery.ts`, `deploy_voice_unit.sh`, canlı `page-DPutH6LT2.js`, `Downloads/src/pages/dashboard/voice-assistant/`
- **Ne yapıldı:** Otonom dinleme, birim borç sorgusu (“bir 14’ün aylık borcu”), kasa/banka bağlamı; sesli sayfa yamaları.
- **Kaynak:** `dc536d18` yoğun (20–21 Tem); ~44 ilgili sorgu
- **Kod kaydı:** 🟡 Kısmi (patch + Downloads/src; canlı minified ayrı)
- **Bağımlılık:** Birim/borç SSOT; WhatsApp’a dokunmadan patch disiplini

### [#008] Sakin paneli borç → WhatsApp bilgilendirme
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/deploy_sakin_debt_wa*.sh`, `src/lib/resident-assistant/*`, `src/lib/whatsappApi.ts`
- **Ne yapıldı:** Sakin panelinden borç bilgisi otomatik WhatsApp mesajı; filtreleme.
- **Kaynak:** `dc536d18` 21 Tem 00:27; `8b3e0caa` keşif
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** #001, #007
- **Aşama 3 notu:** ⛔ WhatsApp yüzeyi — HARD LOCK

### [#009] “Borcu yoktur” yazısı — sıfır borç şartı
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/debt-clearance-page.tsx`, `debtClearanceGuard.ts`, `deploy_borcu_yoktur.sh`
- **Ne yapıldı:** Borç bir kuruş bile varsa borcu yoktur yazısı yasak; sıfırsa WhatsApp ile gönderim kuralı.
- **Kaynak:** `dc536d18` 21 Tem 01:11
- **Kod kaydı:** ✅ Tam kod mevcut (`_patch`)
- **Bağımlılık:** #008 (gönderim kanalı WA ise kilitli)

### [#010] Demo talep → otomatik demo hesap / ücretsiz satış
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/demoProvision.ts`, `DemoRequestSection.tsx`, `contact-page.tsx`, `deploy_demo_*.sh`, `forms` / demo API
- **Ne yapıldı:** Form talebi yerine otomatik demo hesap; “doğrudan publish / canlıya al” talepleri; marketing linkleri.
- **Kaynak:** `dc536d18` 21 Tem 11:51–16:11; `de88ecd2` keşif
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** Pazarlama sayfası (#014/#015)

### [#011] Readdy overview → ana sayfa (KpiGrid / FinCard / şehir hero)
- **Kategori:** Tasarım-UI
- **Etkilenen dosyalar:** `src/pages/dashboard/overview/page.tsx`, `KpiGrid.tsx`, `_patch/readdy-12230676/*`, `deploy_overview_*.py/sh`, `ReaddyMainOverview*.tsx`
- **Ne yapıldı:** Readdy `project-12230676` ile site yönetimi ana sayfası; sonra kompakt hero + 4 büyük FinCard + Detaylı Hareket; sahte veri yasak; **korunan** yapı (`overview-compact-20260722-*`).
- **Kaynak:** `dc536d18` 21 Tem 13:20–22 Tem (çok tur); Cursor `protect-main-overview`
- **Kod kaydı:** 🟡 Kısmi (Readdy zip + patch + kurallar; canlı `page.tsx` sunucuda/korumalı release’te)
- **Bağımlılık:** #012, #013; **çelişki:** ReaddyMainOverview geri getirme yasak (koruma)

### [#012] Site seçici tekilleştirme / TR metin
- **Kategori:** Hata Düzeltme
- **Etkilenen dosyalar:** `DashboardLayout.tsx` (SiteSwitcher), `_patch/dedupe_site_switcher.py`, `deploy_site_switcher_*.sh`, `clean_site_switcher_tr.sh`
- **Ne yapıldı:** Çift site gösterimi, debug marker (`SITE_SWITCHER_LIVE_MARKER`), İngilizce kırık metin temizliği; overview’da tek üst şerit seçici.
- **Kaynak:** `dc536d18` 22 Tem 00:28–01:15
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** #011

### [#013] Sahte finans kaldırma / SSOT / tahakkuk kartları
- **Kategori:** Veritabanı / Ürün kuralı
- **Etkilenen dosyalar:** `useFinancialSnapshot`, `_patch/deploy_kpigrid_ssot_real.py`, bank/cash RLS scriptleri, tahakkuk chunk `page-CdT4wcIx-*`
- **Ne yapıldı:** Sahte banka/trend kaldırıldı; boş site = ₺0; tahakkuk → debit_records + bakiye write-through + kartlara yansıma kuralları.
- **Kaynak:** `dc536d18` 22 Tem 11:04; Cursor `tahakkuk-*` / `aidat-equal` kuralları
- **Kod kaydı:** 🟡 Kısmi (script + kurallar; hook kaynak yolu doğrulanmalı)
- **Bağımlılık:** #011

### [#014] Logo / marka / pazarlama görselleri
- **Kategori:** Tasarım-UI
- **Etkilenen dosyalar:** `/logo.png`, brand assets, `_patch/logo/*`, `deploy_brand_*.py`, ticker/navbar scriptleri, canlı `index-Baa-Fpzt.js` string-replace geçmişi
- **Ne yapıldı:** Blur logo büyütme, chrome P markası, ticker scrub, CSS’siz sınıf → devasa logo regressiyonları; şeffaf master yeniden üretim.
- **Kaynak:** `dc536d18` 22 Tem 19:43+; hasar envanteri M1–M7 / G1–G4
- **Kod kaydı:** 🟡 Kısmi (scriptler var; canlı index yamaları kırılgan)
- **Bağımlılık:** Pazarlama index (#016 ile çelişki riski)

### [#015] Pazarlama portalında kimlik bilgisi göstermeme
- **Kategori:** Yapılandırma
- **Etkilenen dosyalar:** marketing home, `_patch/deploy_portal_no_forms.py`, `deploy_portal_brand_secure.py`, kural `no-public-emails-or-credentials`
- **Ne yapıldı:** Firma/sakin portal kartlarında e-posta/şifre ön-dolu alanların kaldırılması; yalnızca link.
- **Kaynak:** `dc536d18` 23 Tem 10:56–11:30
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** #014

### [#016] ErrorBoundary / removeChild / null-site listeler
- **Kategori:** Hata Düzeltme
- **Etkilenen dosyalar:** `index-Baa-Fpzt.js`, `page-DOpDhq7V.js` (bloklar), `page-BB-walua2-*` (daireler), `page-x8LpDIyr.js` (sakinler), `_patch/nav/*`
- **Ne yapıldı:** `NotFoundError`/`removeChild` ignore; `currentSite?.id` sertleştirme; listeler hâlâ kullanıcıda kırılgan.
- **Kaynak:** `dc536d18` 28 Tem / 2 Ağu; `docs/PROYONETIM-HASAR-ENVANTERI-*`
- **Kod kaydı:** 🟡 Kısmi (canlı minified; kaynak TS tam değil)
- **Bağımlılık:** #017

### [#017] Çift index / mapDeps / cache-bust disiplini
- **Kategori:** Hata Düzeltme / Yapılandırma
- **Etkilenen dosyalar:** `index.html`, `sw.js`, `index-*.js`, `bump_index_cachebust.py`, audit scriptleri
- **Ne yapıldı:** Dual React / yanlış chunk geçmişi; peş peşe canlı yama yasağı kuralı (`protect-live-no-surgical-chaos`).
- **Kaynak:** Hasar envanteri S3–S7, R1–R5; 30 Tem dersi
- **Kod kaydı:** ⚠️ Sadece açıklama + scriptler (kalıcı mimari fix yok)
- **Bağımlılık:** Tüm canlı UI maddeleri

### [#018] TEB / Konsiyon banka entegrasyonu
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `_patch/deploy_teb_konsiyon*.sh`, `check_teb_*.js/py`, `check_erses_teb_*.py`, bank webhook/transaction kontrolleri
- **Ne yapıldı:** TEB adım adım test; Konsiyon kullanıcı/şifre farkı teşhisi; entegrasyon merkezinde banka listesi/0 sayısı hataları.
- **Kaynak:** `dc536d18` 21 Tem 21:55–23 Tem 21:58 (~36 ilgili)
- **Kod kaydı:** 🟡 Kısmi (çok probe/deploy; tek “son doğru” kaynak belirsiz)
- **Bağımlılık:** Banka şeması / site bağlamı (AK-RE vb.)

### [#019] Aidat eşit dağıtım (birim sayısına bölünmez)
- **Kategori:** Veritabanı / Ürün kuralı
- **Etkilenen dosyalar:** dues-management / borçlandırma hesaplayıcıları; kural `aidat-equal-not-divided`
- **Ne yapıldı:** Girilen tutar her birime aynı; site toplamı = birim başı × adet.
- **Kaynak:** Cursor kuralı + tahakkuk sohbetleri
- **Kod kaydı:** ⚠️ Sadece kural/açıklama ağırlıklı (tam hesaplayıcı diff chat’te eksik olabilir)
- **Bağımlılık:** #013

### [#020] Personel takip / vardiya-devriye
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** `Downloads/src/hooks/useVardiyaData.ts`, vardiya sayfaları, release adları `whatsapp-vardiya-devriye-*` (isim yanıltıcı olabilir)
- **Ne yapıldı:** Vardiya/devriye varyasyonları, otomatik doldurma talepleri.
- **Kaynak:** `f963ad1a` / `ddbaaff6` 19 Tem
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** —

### [#021] SMS / Netgsm
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** (chat’te az dosya yolu)
- **Ne yapıldı:** SMS / push / şifreleme talepleri geçti; uygulama kanıtı sınırlı.
- **Kaynak:** 19 Tem / 24 Tem az sayıda sorgu
- **Kod kaydı:** ⚠️ Eksik kayıt
- **Bağımlılık:** —

### [#022] Billing / paket / ev güvenlik fiyatlandırma
- **Kategori:** Yeni Özellik
- **Etkilenen dosyalar:** billing release’ler `billing-v3-company-pricing-*`, kontrol paneli fiyat ayarları
- **Ne yapıldı:** Şirket fiyatlandırma, ev güvenlik paket ödemeleri yazılım içi takip.
- **Kaynak:** 18–19 Tem empty-window; 19 Tem / 26 Tem sorgular
- **Kod kaydı:** 🟡 Kısmi
- **Bağımlılık:** #003

### [#023] AK-RE isimlendirme (Akrapark değil)
- **Kategori:** Diğer
- **Etkilenen dosyalar:** arama/yama scriptleri (`_probe_akre_*`), kullanıcı kuralı
- **Ne yapıldı:** “AKRE AKRAPARK DEĞİL” düzeltmesi; tüm yazılımda AK-RE.
- **Kaynak:** `dc536d18` 21 Tem 01:32
- **Kod kaydı:** ✅ Kural + probe’lar
- **Bağımlılık:** —

### [#024] “Çalışanı koru” / bitmiş yapı / staging disiplini
- **Kategori:** Yapılandırma
- **Etkilenen dosyalar:** `.cursor/rules/protect-*.mdc`, overview/WhatsApp freeze yolları
- **Ne yapıldı:** Korunan overview, WhatsApp hard-lock, canlı cerrahi kaos yasağı, publish disiplini yazılı kurallara bağlandı.
- **Kaynak:** `dc536d18` 22 Tem 10:14–12:28; sürekli tekrar
- **Kod kaydı:** ✅ Tam (kurallar dosyada)
- **Bağımlılık:** Tüm uygulama planını kısıtlar

### [#025] Ops repo kurtarma / durum / hasar belgeleri (bu oturum ailesi)
- **Kategori:** Diğer
- **Etkilenen dosyalar:** `docs/SISTEM-DURUM-RAPORU-*`, `docs/PROYONETIM-HASAR-ENVANTERI-*`, `_patch/audit_live_stability*.py`
- **Ne yapıldı:** Sistem bozukluğu kaydı, hasar envanteri, smoke/audit; kurtarma promptu Aşama 1.
- **Kaynak:** `8416b0c9`, `dc536d18` 3 Ağu
- **Kod kaydı:** ✅ Tam (docs)
- **Bağımlılık:** —

---

## Özet tablo

| Durum | Adet |
|---|---|
| ✅ Tam kod kayıtlı | 6 (#005, #006, #009, #023, #024, #025) |
| 🟡 Kısmi kayıtlı | 16 |
| ⚠️ Eksik kayıt | 3 (#017 mimari, #019, #021) |
| **TOPLAM maddeler** | **25** (tema kümesi; 548 ham sorgu bunlara indirildi) |
| ⛔ HARD LOCK (WA) | #001, #008 (+ #009 WA kanalı) |

---

## Çelişen değişiklikler

1. **Overview:** Readdy “birebir ana sayfa” (#011) vs sonradan **korunan KpiGrid + kompakt hero + SSOT** — **son hali korunan overview’dur**; `ReaddyMainOverview` router’a geri dönüş yasak.
2. **Logo/pazarlama (#014)** canlı ortak `index` üzerinde yapıldı → panel ErrorBoundary (#016) ile **çelişen yan etkiler**; hasar belgesi bunu CRITICAL sayıyor.
3. **WhatsApp restore (#001)** tarihsel olarak landing’i değiştirdi; bugünkü kural: WA isimsiz müdahale yok + publish’siz symlink yok.
4. **“Canlıya al / publish”** chat’te sık geçiyor; mevcut kullanıcı bağlamı: sunucu ayakta, **otomatik publish yok**.

## Kurtarılamayacak / yüksek riskli olanlar

- Canlıya peş peşe basılmış **minified string-replace** zincirinin her adımının birebir yeniden üretimi (chat’te tam diff yok).
- Temmuz 12 tar.gz ile Temmuz 18–Ağu 3 arası **sunucu-only** değişikliklerin tamamı (yerel arşiv eksik olabilir).
- WhatsApp Evolution instance / secret / `.env` içerikleri (bilerek envanterde yok; gizli).
- “Beyazalı tamamen çökmüş” teşhisinin tam kök neden fix’i (hasar kaydı var, kod çözümü yok).

## Bağımlılık / paket / şema (kod dışı)

| Tür | Kanıt |
|-----|--------|
| `package.json` | `PROYONETIM-LIVE-SOURCE-EXTRACTED/package.json` (pnpm workspace); `Downloads/src` ayrı frontend |
| `.env` | Chat’te `/var/www/proyonetim/api/radore-api/.env` yolları — **içerik envantere alınmadı** |
| DB şema | İcra (`_probe_icra_schema`), cash RLS, bank columns, tahakkuk/`debit_records` kuralları |
| PM2 | `proyonetim-api`, `whatsapp-worker`, `scheduler` (agent başlatılmadı) |
| Korunan release’ler | `overview-compact-*`, `whatsapp-baglanti-final-*`, `PROTECTED-*` yedekler |

---

## Aşama 2’de ne gerekir?

1. Bu envanteri incelemeniz: madde çıkar / düzelt / ekle.
2. Özellikle netleştirin: **yeniden uygulama mı**, yoksa **hasar onarım planı mı** (sunucu ayakta)?
3. WhatsApp maddeleri (#001/#008) için ayrıca açık komut gerekir.
4. Açıkça **`ONAYLIYORUM`** yazmadan Aşama 3’e (kod uygulama / git commit serisi) **geçilmez**.

**`ONAYLIYORUM` hâlâ zorunlu mu?** Evet — MD Aşama 2/3 bunu şart koşuyor. “Prompt emrine devam et” yalnızca Aşama 1’i açtı.

---

## Kalan engeller

| # | Engel | Neden |
|---|--------|--------|
| B1 | Aşama 3 kod uygulaması | `"ONAYLIYORUM"` yok |
| B2 | WhatsApp uygulama | HARD LOCK + kullanıcı isimle komutlamadı |
| B3 | Canlı landing / publish | Açık “publish/canlıya al” yok; sunucu zaten UP |
| B4 | Tek “orijinal Readdy” klasörü | `project-11603480 (1)` yetersiz; çoklu yedek adayı seçim onayı |
| B5 | Çalışma kopyası henüz yok | Aşama 1 için gerekmedi; Aşama 3 öncesi kopya+`git init` gerekir |
| B6 | ⚠️ / 🟡 maddeler | Sessizce doldurulamaz — Aşama 3’te tek tek danışılacak |
| B7 | Chat arşivi ~Tem 18+ | Daha eski Readdy içi işler eksik olabilir |

---

## Bu turda yapılmayanlar (bilinçli)

- Kod yaması / commit yok
- `proyonetim-kurtarma-work` kopyası oluşturulmadı
- Canlı symlink / WhatsApp / `radore-deployment-agent` yok
- Aşama 3 uygulama planı yürütülmedi

---

**Envanter hazır. İncelemenizi bekliyorum.**
