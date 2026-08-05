# Radore UNIFIED Full Install Kit — 2026-08-04

## Tek paket

| Alan | Değer |
|------|--------|
| **Kit dizini** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/RADORE-FULL-INSTALL-KIT-20260804-075931-UNIFIED` |
| **Tar.gz** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/proyonetim-radore-full-20260804-075931-UNIFIED.tar.gz` |
| **sha256** | `ed57d1df2337d7fa40dfbc32d4e21bcb950f1c50a6f445dacaadf286b0e071d0` |
| **Boyut** | **36465252** B (~34.8M) |
| **Tip** | **UNIFIED_FULL** — tek başına yeni Radore kurulumu |

## Pointer’lar (artık tutarlı)

Hepsi UNIFIED’e bakar:

- `RADORE-FULL-INSTALL-KIT-LATEST` → symlink UNIFIED
- `RADORE-FULL-INSTALL-KIT-LATEST.txt` / `.path` → UNIFIED
- `proyonetim-radore-full-LATEST.tar.gz` → UNIFIED tar

## Post-UNIFIED canlı yamalar (2026-08-04 akşam — tar henüz yenilenmedi)

Bir sonraki kit overlay’ine alınmalı; pointer aynı UNIFIED’de kaldı:

- WhatsApp API: `KILLPATH_GUARD_D` / logout-delete blok, `STICK_OPEN_FIRST`, webhook CONNECTION_UPDATE (`docs/WHATSAPP-PHONE-SYSTEM-SYNC-2026-08-04.md`)
- Web: `/.well-known/assetlinks.json` (`com.proyonetim.mobile`)
- Kuyruk özeti: `docs/KALANLAR-DEVAM-2026-08-04.md`
- Son re-verify damgası: **UTC `20260804-181913`** — killpath hâlâ kapalı; ek API değişikliği yok → LATEST pointer güncellenmedi

## Nasıl üretildi

1. Taban: `RADORE-FULL-INSTALL-KIT-20260803-212028` (full ~35M)
2. Overlay: canlı WhatsApp API dist (QR status mint + connect rollback + diagnostics)
3. Web: canlı `overview-compact-restored-20260802` → `landing-release.tar.gz` (**660 assets**, canlı ile eş)
4. `package-lock.json` + `npm ci` notu
5. SSL kırık symlink’ler silindi → `ssl/RENEW-NOTES.txt` (certbot)
6. `RESTORE.md` tek path: API `/opt/proyonetim/radore-api`

## Dry-extract doğrulama

- RESTORE.md, landing tar, package-lock, evolution compose, pm2, nginx, evolution_db dump: **OK**
- Landing assets extract: **660 = canlı 660**
- Kırık SSL symlink: **0**
- connectfix chunk landing içinde: var

## Yeni sunucu için yeterlilik

**Evet — bu tek kit yeter.** Ek olarak (kit dışı, gerçekçi):

- DNS A/AAAA
- `certbot` (SSL PEM kitte yok)
- `npm ci` (registry)
- WhatsApp **telefon QR** tarama
- İsteğe bağlı Netgsm (credential yoksa SMS residual)

Eski delta’lar (`063602`, `073416`) artık LATEST değil; arşiv olarak kalabilir.

## Residuals

1. App PostgreSQL binary dump yok (`postgresql://` yok)
2. Netgsm/SMS credential + ürün API yok
3. Evolution device session volume’ları yok → QR yeniden

## Kurulum

Paketi aç → `RESTORE.md` adımlarını izle. Smoke checklist RESTORE içinde.

Aynı «Opsiyonel Temizlik (Silme) — Güvenli» bölümü kit içinde de var: `RESTORE.md` (son bölüm), `INSTALL-ANOTHER-SERVER.md` (kısa yönlendirme), `docs/SAFE-OPTIONAL-CLEANUP.md`.

## Opsiyonel Temizlik (Silme) — Güvenli.

Bu bolum opsiyoneldir. Amac, hedef sunucuda onceki Pro Yonetim kurulum kalintilarini guvenli sekilde temizlemek ve kit ile restore sonrasi hedefin bozulmamasini saglamak.

Uyari: Bu bolum yalnizca Pro Yonetim’e ait dizinleri/services’lari ve sadece var olduklarinda tasima/yedekleme icin kullanilmalidir. Bu bolumde rm -rf yoktur; her zaman mv ile tasinir.

Guvenli hedefleme kurallari

- Sadece Pro Yonetim’e ait yollar uzerinde islem yapin: /opt/proyonetim, /var/www/proyonetim/releases, /var/www/proyonetim/landing (ozellikle symlink).
- Asla /var/www/nginx* veya nginx ile ilgili bagimsiz konfig/varliklar uzerinde silme/tasima yapmayin.
- radore-deployment-agent baslatmayin (bu temizlik icin gerekli degildir).

Islem oncesi guvenlik adimlari

1. PM2 durdurma: once proyonetim-api prosesini durdurun. Ardindan PM2 listesinde adlari proyonetim- ile baslayan diger ilgili prosesleri de durdurun (varsa).
2. landing symlink’i: /var/www/proyonetim/landing bir symlink ise korlemesine silmeyin. Once symlink hedefini yedekleyin (hedefi bir dosyaya yazin). Sonra symlink’i mv ile yedekleyin (silme yok).
3. Yol/owner kontrolu: tasimadan once ls -ld ve (varsa) stat -c %U:%G ile path owner/grup bilgisini dogrulayin.

Restore ile uyumluluk notu

Restore akisi normalde /var/www/proyonetim/landing ve ilgili release yapilarini yeniden kurar. Bu nedenle bu bolum silme degil, yedekli tasima mantigiyla tasarlanmistir.

Ornek guvenli temizlik komutlari (Linux)

    # Timestampli yedek klasoru (ornek)
    mkdir -p /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS

    # 1) PM2
    pm2 stop proyonetim-api 2>/dev/null || true
    # 2) Iliskili proyonetim-* surecleri: pm2 list ile gorunen adlari tek tek stop edin (varsa)

    # 3) landing symlink’i silmeden once yedekle
    if [ -L /var/www/proyonetim/landing ]; then
      readlink /var/www/proyonetim/landing > /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS/landing.symlink.target 2>/dev/null || true
      mv -T /var/www/proyonetim/landing /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS/landing
    elif [ -e /var/www/proyonetim/landing ]; then
      mv /var/www/proyonetim/landing /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS/landing
    fi

    # 4) Pro Yonetim dizinlerini rm -rf olmadan mv ile sadece var ise tasiyin
    if [ -e /opt/proyonetim ]; then
      mv /opt/proyonetim /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS/opt-proyonetim
    fi

    if [ -e /var/www/proyonetim/releases ]; then
      mv /var/www/proyonetim/releases /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS/var-www-proyonetim-releases
    fi

    echo Temizlik tamam: /var/backups/proyonetim/feature-protection/SAFE-CLEANUP-YYYYMMDD-HHMMSS

Manuel dikkat notu

Bu bolumde yanlis path degerleri veri kaybi riskini dogurabilir. Islemi calistirmadan once path var mi, owner/grup nedir ve nginx disi yerlere dokunulmuyor mu dikkatlice kontrol edin.
