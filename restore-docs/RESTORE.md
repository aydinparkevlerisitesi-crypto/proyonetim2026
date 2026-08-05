# Pro Yönetim — PRIORITY Full Server Restore (TR)

Bu kit **canlı Radore durumunun** tam yedeğidir: web landing (tüm assets), API, WhatsApp send-relay (3016/3017/3018), nginx, Evolution, env (sunucuda 600), PM2.

**Yapmayın:** `radore-deployment-agent` başlatmak; canlıda deneysel `landing` symlink çevirmek; WhatsApp özellik kodunu “iyileştirme” adı altında değiştirmek.

---

## A) Başka Radore sunucusuna kurulum

1. **Paketler**
   ```bash
   apt update && apt install -y nginx docker.io docker-compose-v2 postgresql postgresql-client \
     certbot python3-certbot-nginx rsync python3 curl
   # Node 20 (nodesource veya nvm) — canlı: v20.x
   npm i -g pm2
   ```

2. **Web**
   ```bash
   mkdir -p /opt/proyonetim/web /var/www/proyonetim
   tar -xzf web/landing-release.tar.gz -C /opt/proyonetim/web/
   # LANDING-RELEASE-NAME.txt içindeki adı kullanın (ör. overview-compact-restored-20260802)
   ln -sfn /opt/proyonetim/web/$(cat web/LANDING-RELEASE-NAME.txt) /var/www/proyonetim/landing
   # Asset sayısı: web/LANDING-ASSET-COUNT.txt ile ls landing/assets | wc -l eşleşmeli
   ```

3. **API**
   ```bash
   rsync -a api/radore-api/ /opt/proyonetim/radore-api/
   cp env/radore-api.env.REAL /opt/proyonetim/radore-api/.env
   chmod 600 /opt/proyonetim/radore-api/.env
   cd /opt/proyonetim/radore-api && (npm ci --omit=dev || npm install --omit=dev)
   ```

4. **Relays (WhatsApp send / credentials / person-resolve)**
   ```bash
   mkdir -p /var/www/proyonetim/api
   rsync -a api-relays/whatsapp-send-relay/ /var/www/proyonetim/api/whatsapp-send-relay/
   rsync -a api-relays/whatsapp-credentials-relay/ /var/www/proyonetim/api/whatsapp-credentials-relay/
   rsync -a api-relays/person-resolve-relay/ /var/www/proyonetim/api/person-resolve-relay/
   cp pm2/pm2-whatsapp-relays.config.js /opt/proyonetim/
   ```

5. **PM2**
   ```bash
   cd /opt/proyonetim/radore-api
   pm2 start ecosystem.config.cjs   # veya pm2/dump.pm2 ile resurrect
   pm2 start /opt/proyonetim/pm2-whatsapp-relays.config.js
   pm2 save
   # Beklenen: proyonetim-api, scheduler, whatsapp-worker, whatsapp-send-relay,
   #           whatsapp-credentials-relay, person-resolve-relay
   # BAŞLATMAYIN: radore-deployment-agent
   ```

6. **Nginx + SSL**
   ```bash
   cp -a nginx/sites-available/* /etc/nginx/sites-available/
   # sites-enabled linklerini hedefe göre ayarla
   nginx -t && systemctl reload nginx
   certbot --nginx -d proyonetim.com.tr -d www.proyonetim.com.tr   # veya ssl/RENEW-NOTES.txt
   ```

7. **Evolution**
   ```bash
   mkdir -p /opt/evolution
   cp evolution/docker-compose.yml /opt/evolution/
   cp evolution/env.REAL /opt/evolution/.env && chmod 600 /opt/evolution/.env
   cd /opt/evolution && docker compose up -d
   # DB: createdb evolution_db; pg_restore -d evolution_db db/evolution_db.dump
   ```

8. **Uygulama verisi**
   - En hızlı: aynı Supabase projesine `env.REAL` ile bağlan
   - Offline: `db/supabase-logical-live/` JSON’lar / Dashboard dump
   - SoftList / Pure Management / logo: landing tarball içinde (ayrıca `brand/`, `web/SOFTLIST-PURE-MANAGEMENT-ASSETS.txt`)

9. **DNS** → yeni sunucu IP; smoke: `/`, `/firma-giris`, `/api/health`, relays 3016–3018

10. **WhatsApp** → Evolution ayakta iken UI’dan **QR yeniden tara** (oturum volume’ları taşınmadıysa)

---

## B) Local PC (geliştirme / inceleme)

1. Tarball’ı indir (`DOWNLOAD.md`)
2. `tar -xzf …` — Node 20 + `npm ci` API için
3. Web için `npx serve` veya nginx local; API `.env.REAL` **dikkat**: production sırları
4. Relays Python3 ile lokal portlarda denenebilir
5. Evolution + Postgres heavy — isteğe bağlı

---

## C) Güvenli isteğe bağlı temizlik (rm değil — mv)

Eski kit/tar’ları silmeyin; taşıyın:

```bash
ARCHIVE=/mnt/olddisk/var/backups/proyonetim/feature-protection/_archive-$(date -u +%Y%m%d)
mkdir -p "$ARCHIVE"
# Örnek: UNIFIED tarball’ı arşive al (LATEST artık PRIORITY)
# mv /mnt/olddisk/.../proyonetim-radore-full-20260804-075931-UNIFIED.tar.gz "$ARCHIVE/"
# mv /mnt/olddisk/.../RADORE-FULL-INSTALL-KIT-20260804-073416 "$ARCHIVE/"   # isteğe bağlı
```

**Saklayın:** PRIORITY kit + en az bir UNIFIED + `PROTECTED-*` yedekler.

---

## D) Doğrulama checklist

- [ ] `ls /var/www/proyonetim/landing/assets | wc -l` == `LANDING-ASSET-COUNT.txt`
- [ ] `logo.png` + `brand/` mevcut
- [ ] SoftList / `pure-management-section.*` assets var
- [ ] `pm2 ls`: 6 process online; agent yok
- [ ] `curl -s http://127.0.0.1:3001/api/health` → healthy
- [ ] sha256 tarball = `checksums/tarball.sha256`
