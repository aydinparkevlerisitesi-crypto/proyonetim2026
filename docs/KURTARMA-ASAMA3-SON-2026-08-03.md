# KURTARMA AŞAMA 3 — SON DURUM (2026-08-03)

| Alan | Değer |
|------|--------|
| **Yetki** | `onaylıyorum` + `until the end` / full authority (cerrahi non-WA publish) |
| **Work copy** | `C:\Users\HP\Projects\proyonetim-kurtarma-work` |
| **Git** | MinGit portable → `git init` + commit `253e70c` (local only, no push) |
| **Staging** | `/var/www/proyonetim-staging/work/kurtarma-20260803-214332` |
| **Prelive backup** | `/var/backups/proyonetim/feature-protection/BACKUP-kurtarma-prelive-20260803-214332` |
| **Canlı asset overwrite** | **Yok** (verify-only — güvenli rebuild yok) |

---

## DONE

### Yerel work-copy (kaynak)

| Madde | Durum |
|--------|--------|
| #003 Admin companies / AK-RE | ✅ |
| #004 Tek blok daire sırası | ✅ |
| #005 İcra uyarı | ✅ |
| #006 Eski kiracı lifecycle | ✅ |
| #007 ProY voice wiring | ✅ |
| #009 Borcu yoktur (WA gönderimsiz) | ✅ |
| #010 Demo anında | ✅ |
| #012 SiteSwitcher dedupe | ✅ |
| #013 SSOT boş=0 / `is_active` | ✅ |
| #014 Logo public kopyaları | ✅ |
| #015 Portal link-only | ✅ |
| #016 SoftListErrorBoundary | ✅ |
| #018 TEB kaynak kopyası | ✅ |
| #019 Aidat eşit + tahakkuk write-through | ✅ |
| #020 Personel/vardiya | ✅ doğrulandı |
| #022 Billing / ev güvenlik | ✅ doğrulandı |
| #023 AK-RE siteNaming | ✅ |
| #024/#025 Docs/kurallar | ✅ |

### Canlı doğrulama (mutasyon yok)

| Kontrol | Sonuç |
|---------|--------|
| Homepage | HTTP **200** |
| `radore-deployment-agent` | **inactive** |
| Landing | `overview-compact-restored-20260802` |
| Canonical index | **yalnızca** `index-Baa-Fpzt.js` (`index.html` → 1 ref; CPMsq=0) |
| Dual-index #017 | ✅ **yok** (eski `index-Baa-Fpzt-*.js` yedek dosya; HTML yüklemez) |
| Overview #011 | ✅ `page-CdT4wcIx.js`: Bankalar + `dashboard-city-hero-v1`; **LOC yok** |
| WhatsApp #001/#008 | ✅ VERIFY — chunk **dokunulmadı** |
| Logo | Canlıda zaten mevcut (3 path) |

### WhatsApp hash kanıtı

```
page-CKFOdH2C2.js
sha256: 944917e86522fc7ffe5b6384600df664125ac4a88923c8aa8cf02c4386fb55d7
(prelive backup ile aynı — WA_HASH_UNCHANGED)
```

Index:

```
index-Baa-Fpzt.js
sha256: 6fc9fc8de09b32e08eba0af58a19abfb2e0ccaf9212872a973efcc4bf6dbaa1b
```

### Staging

- Slot: `kurtarma-20260803-214332`
- `src-sync/`: patched TS kaynakları (aidat, SSOT, SiteSwitcher, SoftEB, portal, dues, units, debt-clearance, icra, …)
- Build: **yapılmadı** (canlı chunk riski / WA koruması)

### Git

- Repo: `proyonetim-kurtarma-work` (MinGit 2.47.1 portable under `_tools/`)
- Commit: `253e70c` — *kurtarma: base work copy with Aşama3 safe non-WA patches*
- Force push yok; remote push yok

---

## SKIPPED / IMPOSSIBLE (kanıtlı)

| Madde | Neden |
|--------|--------|
| #001 / #008 WhatsApp rewrite | HARD LOCK — yalnızca verify |
| #002 Landing wholesale restore | Gerek yok; canlı sağlıklı |
| #011 Overview wholesale KpiGrid/Readdy swap | Koruma — dokunulmadı |
| #021 SMS/Netgsm ürün yolu | **BLOCKER:** work-copy `BulkSmsModal` / `handleSendSms` yalnızca toast (API yok); `api-extract` SMS/Netgsm dosyası **0**; canlı `radore-api` `netgsm`/`/api/sms` **0 dosya**. Netgsm örneği yalnızca ops `_patch/readdy-…/supabase/functions/sms-send` (ürün API değil). WA Merkezi SMS sekmesine dokunulmadı. |
| Canlı frontend asset publish | Work-copy TS → güvenli Vite build + cerrahi chunk map **yok**; wholesale rsync WhatsApp/overview’u ezer → **bilinçli verify-only** |
| Sistem Git.Git winget | Kullanıcı/UAC iptal; portable MinGit ile çözüldü |

---

## Canlıya ne gitti?

**Hiçbir canlı `landing/assets/*.js` değiştirilmedi.**  
Yapılan uzak iş: prelive **backup** + **staging** kaynak senkronu + smoke/hash doğrulama.

Yerelde kalan: tüm Aşama3 kaynak yamaları + git commit `253e70c`.

---

## Sonraki gerçek publish (ayrı komut gerekir)

1. Staging’de full frontend build  
2. Diff → yalnızca non-WA chunk’lar  
3. WA `page-CKFOdH2C2.js` sha sabit kalmalı  
4. Kullanıcı açık “publish şu chunk’lar” derse cerrahi kopya
