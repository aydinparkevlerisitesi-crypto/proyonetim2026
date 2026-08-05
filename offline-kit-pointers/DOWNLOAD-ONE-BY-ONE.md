# Pro Yönetim — Tek tek indirme (PC → fiziksel sunucu)

**Kaynak (Radore):** `/mnt/olddisk/var/backups/proyonetim/feature-protection/PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz`  
**SHA256 (tam arşiv):** `827c16ffd3254250f4a3057711c36c3f037972cb2394a79b05a0b505d2867993`  
**Tarih:** 2026-08-05

## Ne indirilir?

| Dosya | Açıklama |
|-------|----------|
| `PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz` | Tam kit (tek dosya, ~46MB) |
| `PROYONETIM-PRIORITY-FULL-SERVER-20260805.sha256` | Tam kit hash |
| `parts/*.part-00` … | Aynı tar’ın ~20MB parçaları (birleştir → tam kit) |
| `components/01-web.tar.gz` … `05-docs.tar.gz` | Bileşen bazlı yedekler |
| `DOWNLOAD-ONE-BY-ONE.md` | Bu dosya |

## PC’de doğrulama (PowerShell)

```powershell
cd "$env:USERPROFILE\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805"
Get-FileHash .\PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz -Algorithm SHA256
# Beklenen: 827C16FFD3254250F4A3057711C36C3F037972CB2394A79B05A0B505D2867993
```

## Parçalardan birleştirme (isteğe bağlı)

```powershell
# Sıra: part-00, part-01, …
cmd /c copy /b parts\PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz.part-00+parts\PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz.part-01+parts\PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz.part-02 REBUILT.tar.gz
Get-FileHash .\REBUILT.tar.gz -Algorithm SHA256
```

Linux:

```bash
cat parts/PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz.part-* > REBUILT.tar.gz
sha256sum REBUILT.tar.gz
```

## Fiziksel sunucuya yükleme sırası (önerilen)

1. **Tam kit** tercih: `PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz` → aç → `RESTORE.md` / `INSTALL-ANOTHER-SERVER.md`
2. Veya bileşen sırası:
   1. `05-docs.tar.gz` — okuma / restore rehberi
   2. `03-nginx-pm2.tar.gz` — nginx, pm2, systemd, ssl, env
   3. `02-api.tar.gz` — API + relays + kritik src
   4. `01-web.tar.gz` — web / landing varlıkları
   5. `04-evolution.tar.gz` — Evolution (WhatsApp altyapı yedeği; canlıya dokunmadan önce net karar)
3. Hash kontrolü: `COMPONENTS.sha256` / `PARTS.sha256` / ana `.sha256`

## Uyarı

- Canlı Radore `landing` / WhatsApp bu indirme ile değiştirilmez.
- `radore-deployment-agent` başlatmayın.
- Fiziksel sunucuda kurulum ayrı onay + `INSTALL-ANOTHER-SERVER.md` adımlarıyla yapılır.
