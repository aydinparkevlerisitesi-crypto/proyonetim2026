# Live Deficiencies Closed + Backup — 2026-08-03

| Alan | Değer |
|------|--------|
| **Yetki** | Full authority — deficiencies + installable Radore kit |
| **Landing** | `/var/www/proyonetim/landing` → `/opt/proyonetim/web/overview-compact-restored-20260802` |
| **Agent** | `radore-deployment-agent` **inactive** (başlatılmadı) |

---

## 1. What was fixed (this session)

| # | Eksiklik | Aksiyon | Kanıt |
|---|----------|---------|--------|
| F1 | SoftListErrorBoundary canlıda yoktu | Blocks / Units / Residents chunk’larına cerrahi SoftList inject | `SoftListErrorBoundary` 3 softlist chunk’ta; yedek `BACKUP-softlist-inject-20260803-205228` |
| F2 | SoftList cache | Chunk rename + index mapDeps retarget + `index.html?v=20260803-212012` | mapDeps missing **0**; softlist refs **6** |
| F3 | Install kit yoktu | Full rebuild kit + tarball + sha256 + LATEST pointer | bkz. §4 |
| F4 | App DB yedeği | Binary pg_dump imkânsız → REST logical JSON (18 tablo) | `db/supabase-logical/` |

**Önceki oturumda zaten kapanmış (doğrulandı, dokunulmadı):** layout-no-hscroll.css 200; ErrorBoundary `removeChild` ignore; Evolution :8083 + QR base64; logos; dual-index yok; overview hero + LOC yok; WA chunk hash sabit.

**Bilinçli dokunulmayanlar:** WA UI chunk içeriği; overview KpiGrid wholesale; landing symlink; sakin WhatsApp/SMS gönderimi.

---

## 2. Smoke results

| Kontrol | Sonuç |
|---------|--------|
| `/` `/firma-giris` overview blocks units residents wa admin-panel | **HTTP 200** |
| `/api/health` | healthy `4.0.0-enterprise` |
| `/api/whatsapp/health` | evolution **online**, qr **available** |
| Evolution connect QR | base64 ~13KB (önceki doğrulama) |
| PM2 | `proyonetim-api`, `whatsapp-worker`, `scheduler` **online** |
| `radore-deployment-agent` | **inactive** |
| mapDeps missing | **0** |
| layout-no-hscroll.css | **200** |
| SoftList chunks | **3** |
| WA `page-CKFOdH2C2.js` sha256 | `944917e86522fc7ffe5b6384600df664125ac4a88923c8aa8cf02c4386fb55d7` (**değişmedi**) |
| index cache-bust | `index-Baa-Fpzt.js?v=20260803-212012` |

---

## 3. Residual impossibles / human actions

| Madde | Durum | Blocker / eylem |
|-------|--------|-----------------|
| **#021 SMS/Netgsm ürün yolu** | Residual | Canlı API’de netgsm/`/api/sms` yok; work-copy BulkSms toast-only. Ürün kodu olmadan restore edilemez. |
| **WA cihaz oturumları** | Human | Evolution up + QR hazır; gateway session ERROR/UNKNOWN → **telefonda QR tarama** gerekir (mesaj testi yapılmadı). |
| **App binary pg_dump** | Residual | `.env` içinde `postgresql://` yok (`SUPABASE_DATABASE_URL` = HTTPS). Kit: `env.REAL` + logical JSON. Tam offline dump için Supabase Dashboard. |
| **Aşama3 full Vite republish** | Kısmen | SoftList canlıya alındı (cerrahi inject — Vite wholesale yok). Aidat/SSOT/tek-blok vb. büyük ölçüde önceki cerrahi rename’lerde zaten canlıdaydı; tam work-copy rebuild yapılmadı (WA/overview riski). Explore plan ([SoftList publish plan](4646f93a-6fc1-4dc0-bf13-d51235bcae6e)) “residual SoftList / no inject recipe” demişti; bu oturumda inject + rename yapıldı ve smoke OK — o residual hükmü **geçersiz**. |
| **DNS yeni sunucu** | Human (migrate) | Yeni Radore IP’ye A/AAAA |
| **Garanti BBVA string** | Bilgi | Overview FinCard değil — banka entegrasyon kataloğu (meşru). |

---

## 4. Backup / kit

| Öğe | Değer |
|-----|--------|
| Kit | `/mnt/olddisk/var/backups/proyonetim/feature-protection/RADORE-FULL-INSTALL-KIT-20260803-212028` |
| Tar.gz | `.../proyonetim-radore-full-20260803-212028.tar.gz` |
| sha256 | `09f4a21fcc0dd151df468810623055c34b1650fb197bcf4554b698353b781a1a` |
| Size | ~41M kit / ~35M tar |
| Docs | `docs/RADORE-FULL-INSTALL-KIT-2026-08-03.md` |
| SoftList backup | `BACKUP-softlist-inject-20260803-205228`, `BACKUP-softlist-rename-20260803-212012` |

**Confirmation:** Sistem canlı ve kontrol altında. Kit, başka bir Radore-sınıfı sunucuda web+API+nginx+Evolution+env ile yeniden kurulum için yeterli; app veri için aynı Supabase’e bağlanma veya Dashboard dump + logical JSON ile desteklenir. Radore dışı zorunlu runtime bağımlılığı: mevcut mimaride Supabase (env ile taşınır); tam DB binary offline için ek Dashboard adımı residual.

---

## 5. Turkish executive summary

**Eksiklikler:** SoftList listelere alındı; smoke yeşil; WA hash sabit; Evolution/QR hazır. SMS ürün yolu ve tam binary DB dump residual.

**Yedek:**  
`/mnt/olddisk/var/backups/proyonetim/feature-protection/RADORE-FULL-INSTALL-KIT-20260803-212028`  
tar sha256 `09f4a21f…781a1a`

**İnsanın yapması gerekenler:** WhatsApp Merkezi’nden cihaz QR tara; yeni sunucuya göçte DNS; isteğe bağlı Supabase Dashboard full backup; SMS için ayrı ürün geliştirme.

*Agent başlatılmadı. Sakin mesajı gönderilmedi.*
