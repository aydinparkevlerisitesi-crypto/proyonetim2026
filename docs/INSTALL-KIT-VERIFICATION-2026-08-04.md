# Install Kit Doğrulama — 2026-08-04 (UNIFIED güncellemesi)

Önceki bulgu: `063602` / `073416` **delta (~540K)** idi; tam kurulum için `212028` + delta gerekiyordu; LATEST pointer’lar tutarsızdı.

## Düzeltme (bu tur)

**Tek UNIFIED full kit** üretildi ve tüm LATEST işaretçileri ona bağlandı.

| Alan | Değer |
|------|--------|
| Kit | `/mnt/olddisk/var/backups/proyonetim/feature-protection/RADORE-FULL-INSTALL-KIT-20260804-075931-UNIFIED` |
| Tar | `proyonetim-radore-full-20260804-075931-UNIFIED.tar.gz` |
| sha256 | `ed57d1df2337d7fa40dfbc32d4e21bcb950f1c50a6f445dacaadf286b0e071d0` |
| Boyut | 36465252 B (~34.8M) |
| Landing assets | **660 = canlı 660** |
| SSL kırık symlink | **0** (certbot notu) |

Pointer’lar (tutarlı):

- `RADORE-FULL-INSTALL-KIT-LATEST` → UNIFIED
- `RADORE-FULL-INSTALL-KIT-LATEST.txt` → UNIFIED
- `proyonetim-radore-full-LATEST.tar.gz` → UNIFIED tar

Ayrıntı: `docs/RADORE-UNIFIED-KIT-2026-08-04.md`

## Eski roller (arşiv)

| Kit | Rol |
|-----|-----|
| `…-212028` | Eski full taban (UNIFIED’in kaynağı) |
| `…-063602` / `…-073416` | Delta arşiv; **LATEST değil**; tek başına kurulum için yetersiz |

## Verdict (güncel)

**Başka bir Radore sunucusuna kurulum için tek paket yeter:** UNIFIED tar + `RESTORE.md`.  
Ek (kit dışı): DNS, certbot, npm registry, telefon QR, isteğe bağlı Netgsm.

Residuals: app `postgresql://` dump yok; Netgsm credential yok; Evolution session → QR.

## Smoke (RESTORE.md ile aynı)

- nginx -t; `/` `/firma-giris` `/api/health`
- assets ≈ 660; WA connectfix chunk
- PM2 api/worker/scheduler; agent başlatma
- QR üret → telefonda tara

*Agent başlatılmadı. Canlı landing bozulmadı (yalnızca backup disk yazımı).*
