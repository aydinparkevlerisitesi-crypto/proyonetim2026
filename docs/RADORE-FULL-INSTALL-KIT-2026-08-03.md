# Radore Full Install Kit — 2026-08-03 (+ 2026-08-04 LATEST)

> **LATEST (2026-08-04 07:34 UTC):**  
> `/mnt/olddisk/.../RADORE-FULL-INSTALL-KIT-20260804-073416`  
> tar sha256 `ea373b90d742ad74a2c76c8541f788f4f72ec814d8c5f394d0042c0367bacfd7`  
> (WA status QR mint + throttle + diagnostics). Ayrıntı: `docs/DEVAM-EKSIKSIZ-2026-08-04.md`.

> **Önceki (2026-08-04 06:36 UTC):**  
> `RADORE-FULL-INSTALL-KIT-20260804-063602` / sha256 `cef333fe…`  
> Ayrıntı: `docs/EKSIKLER-TAMAMLANDI-2026-08-04.md`.

## İlk kit kaydı (2026-08-03)

| Alan | Değer |
|------|--------|
| **Kit (sunucu)** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/RADORE-FULL-INSTALL-KIT-20260803-212028` |
| **Tarball** | `/mnt/olddisk/var/backups/proyonetim/feature-protection/proyonetim-radore-full-20260803-212028.tar.gz` |
| **sha256** | `09f4a21fcc0dd151df468810623055c34b1650fb197bcf4554b698353b781a1a` |
| **Boyut** | kit ~41M / tar.gz ~35M |
| **Pointer** | `RADORE-FULL-INSTALL-KIT-LATEST.txt` → artık **20260804** kiti |
| **Freeze notu** | `PROTECTED-radore-full-kit-20260803-212028.txt` |

> Gizli değerler (`.env.REAL`, SSL privkey, logical JSON) **yalnızca sunucuda** `chmod 600` ile tutulur. Bu git belgesine **şifre/anahtar yazılmaz**.

## İçerik

| Klasör | Ne var |
|--------|--------|
| `web/` | Canlı landing release tarball + symlink notu (`overview-compact-restored-20260802`) |
| `api/radore-api/` | API kaynak/dist (node_modules hariç) + `RESTORE-NODE-MODULES.txt` |
| `pm2/` | `ecosystem.config.cjs` + `dump.pm2` |
| `nginx/` | `nginx.conf`, `nginx -T`, sites-enabled/available |
| `evolution/` | `docker-compose.yml` + container inspect JSON |
| `db/evolution_db.dump` | Yerel Evolution Postgres dump |
| `db/supabase-logical/` | Kritik tabloların REST JSON yedeği (sites, units, debit_records, bank_accounts, …) |
| `env/` | `radore-api.env.TEMPLATE` (anahtar adları) + `radore-api.env.REAL` (sunucuda 600) |
| `ssl/` | Let’s Encrypt yolları / yenileme notu (+ pem varsa) |
| `RESTORE.md` / `INSTALL-ANOTHER-SERVER.md` | TR+EN kurulum adımları |

## Başka Radore’a kurulum (özet)

1. Tarball’ı yeni sunucuya `scp` / `rsync`
2. `RESTORE.md` adımları: nginx, Node 20, PM2, web symlink, API+`.env`, Evolution compose, DNS
3. App verisi: en hızlı yol aynı Supabase projesine `env.REAL` ile bağlanmak; tam offline için Supabase Dashboard’dan `pg_dump` ayrıca alınmalı (bu VPS `.env` içinde `postgresql://` yok)
4. WhatsApp: Evolution ayağa kalkınca UI’dan **QR yeniden tara**
5. `radore-deployment-agent` **başlatma**

## Bilinen sınırlar

- Binary `app_supabase.dump` üretilemedi: `SUPABASE_DATABASE_URL` HTTPS proje URL’si; Postgres URI yok
- Logical JSON 18 tablo OK; sakinler birim (`units`) alanlarında — ayrı `residents` tablosu yok
- Evolution Docker volume’ları (oturum dosyaları) kit’e tam gömülü değil → QR yeniden tarama zorunlu
- `node_modules` dahil değil → `npm ci` gerekir (veya registry erişimi)

## Transfer

```bash
# Örnek (Windows → yeni sunucu için önce local’e çek)
scp -i %USERPROFILE%\.ssh\id_ed25519_radore root@185.184.208.191:/mnt/olddisk/var/backups/proyonetim/feature-protection/proyonetim-radore-full-20260803-212028.tar.gz .
sha256sum proyonetim-radore-full-20260803-212028.tar.gz
# beklenen: 09f4a21fcc0dd151df468810623055c34b1650fb197bcf4554b698353b781a1a
```
