# Pro Yönetim — PRIORITY Full Server Kit (2026-08-05)

Canlı Radore durumunun **eksiksiz** yedek / taşıma kiti. Yazılım kilidi açık değilken yalnızca bu tür envanter/yedek işleri yapılır (`docs/SOFTWARE-LOCK-2026-08-05.md`).

## Özet

| Alan | Değer |
|------|--------|
| **Kit adı** | `PROYONETIM-PRIORITY-FULL-SERVER-20260805` |
| **Klasör** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805` |
| **Tarball** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz` |
| **Boyut (tar.gz)** | **47 424 284** bayt (~45 MB) |
| **sha256** | `827c16ffd3254250f4a3057711c36c3f037972cb2394a79b05a0b505d2867993` |
| **Landing release** | `overview-compact-restored-20260802` |
| **Canlı assets** | **680** (tar içi doğrulama: 680) |
| **LATEST** | `…/PROYONETIM-PRIORITY-FULL-SERVER-LATEST` → bu kit |
| **Generic LATEST** | `RADORE-FULL-INSTALL-KIT-LATEST` da bu PRIORITY kiti gösteriyor |
| **Önceki UNIFIED** | `RADORE-FULL-INSTALL-KIT-20260804-075931-UNIFIED` (saklı; LATEST değil) |
| **PC (indirildi)** | `C:\Users\HP\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805\` |
| **Sunucu DOWNLOAD paketi** | `…/PROYONETIM-PRIORITY-FULL-SERVER-20260805-DOWNLOAD/` (tam tar + parts + components) |

## Yerel PC klasörü (2026-08-05 indirildi)

**Tam yol:** `C:\Users\HP\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805\`

İçerik:

| Dosya / klasör | Açıklama |
|----------------|----------|
| `PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz` | Tam kit (~46 MB) |
| `PROYONETIM-PRIORITY-FULL-SERVER-20260805.sha256` | Hash dosyası |
| `DOWNLOAD-ONE-BY-ONE.md` | Tek tek indirme + fiziksel sunucu yükleme sırası |
| `parts/*.part-00` … `part-02` | ~20 MB parçalar (birleştir = tam kit) |
| `parts/PARTS.sha256` | Parça hash’leri |
| `components/01-web.tar.gz` | Web + brand + markers |
| `components/02-api.tar.gz` | API + relays + kritik src |
| `components/03-nginx-pm2.tar.gz` | nginx, pm2, systemd, ssl, env |
| `components/04-evolution.tar.gz` | Evolution yedek |
| `components/05-docs.tar.gz` | Docs + db + checksums + RESTORE |
| `components/COMPONENTS.sha256` | Bileşen hash’leri |

Yerel doğrulama (PowerShell):

```powershell
cd "$env:USERPROFILE\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805"
Get-FileHash .\PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz -Algorithm SHA256
# beklenen: 827C16FFD3254250F4A3057711C36C3F037972CB2394A79B05A0B505D2867993
```

## İndirme (Windows PowerShell) — yeniden

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519_radore"
$remote = "root@185.184.208.191:/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805-DOWNLOAD"
$dest = "$env:USERPROFILE\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
scp -i $key -r $remote/* $dest
```

Doğrulama (Git Bash / WSL):

```bash
sha256sum PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz
# beklenen: 827c16ffd3254250f4a3057711c36c3f037972cb2394a79b05a0b505d2867993
```

## Linux / rsync

```bash
scp -i ~/.ssh/id_ed25519_radore \
  root@185.184.208.191:/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz \
  ./PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz

# veya
rsync -avP -e "ssh -i ~/.ssh/id_ed25519_radore" \
  root@185.184.208.191:/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz \
  ./
```

## Kit içeriği

- `web/landing-release.tar.gz` — canlı landing tam assets (680) + SoftList / Pure Management / logo
- `api/radore-api/` — API (node_modules hariç) + dist
- `api-critical-src/` — bilinen iyi WA + forms
- `api-relays/` — send `:3016`, credentials `:3017`, person-resolve `:3018`
- `pm2/` — dump + ecosystem + `pm2-whatsapp-relays.config.js`
- `nginx/` — site config + `nginx -T`
- `evolution/` — compose + inspect + `env.REAL` (600)
- `db/` — `evolution_db.dump` + logical JSON
- `env/` — TEMPLATE + `radore-api.env.REAL` (600; git’e koyma)
- `brand/` — logo / icon kopyaları
- `RESTORE.md` / `DOWNLOAD.md` — Türkçe kurulum & indirme
- `checksums/tarball.sha256`

## Canlıya dokunulmadı

- `landing` symlink değiştirilmedi
- WhatsApp özellik kodu düzenlenmedi
- `radore-deployment-agent` **inactive** bırakıldı
- Smoke: home 200, `/api/health` healthy, 6 PM2 process online

## Güvenli temizlik (isteğe bağlı)

Eski kitleri `rm` etme — `_archive-YYYYMMDD/` altına `mv`. PRIORITY + en az bir UNIFIED + `PROTECTED-*` sakla. Ayrıntı: kit içi `RESTORE.md` bölüm C.

## Builder

Sunucu script (repo kopyası): `_patch/build_priority_full_server_20260805.sh`
