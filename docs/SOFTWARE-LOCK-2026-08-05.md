# Yazılım kilidi — 2026-08-05

Pro Yönetim **yazılım ürünü kilitlendi**. Bu tarihten itibaren uygulama / özellik koduna müdahale, kullanıcı açıkça kilidi açmadan veya ilgili epizot için izin vermeden **yapılmaz**.

## Ne kilitli?

| Alan | Durum |
|------|--------|
| Frontend özellik kodu (`src/`, canlı `landing/assets` chunk’ları) | Kilitli |
| API özellik / route kodu | Kilitli |
| Overview, finans, personel, portal, banka vb. ürün yüzeyleri | Kilitli |
| WhatsApp Merkezi + `/api/whatsapp/*` + send-relay | Zaten HARD LOCK (ayrı kural) |
| Canlı `landing` symlink / deneysel yayın | Yasak (açık publish yoksa) |
| `radore-deployment-agent` | Başlatma yasak |

## Ne serbest?

- Cursor kuralları / operasyon dokümanları (kullanıcı istediğinde)
- Sunucu yedeği / full-server kit / envanter / smoke **okuma**
- Kullanıcının açıkça “unlock / kilidi aç / şu özelliğe dokun” dediği **tek epizot**

## Agent kuralı

`.cursor/rules/software-lock-ask-permission.mdc` — `alwaysApply: true`

**Her yazılım işinden önce** kullanıcıya sor. Belirsiz komutlar izin sayılmaz.

## İlişkili korumalar

- `protect-working-software` / `protect-main-overview` / `protect-finished-structure`
- `protect-whatsapp-messaging-hard-lock` / `protect-whatsapp-communication-hard-lock`
- `protect-live-no-surgical-chaos` / `protect-working-release`

## Açma (epizot)

Kullanıcı net yazmalı, örn.:

> “Yazılım kilidini bu iş için aç: …”

Epizot bitince kilit yine geçerli kabul edilir; kalıcı açma ayrıca belgelenmeli.
