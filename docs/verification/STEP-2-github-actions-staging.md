# STEP-2 — GitHub Actions staging migration workflow

- **Tarih:** 2026-08-26 20:26 (Europe/Istanbul)
- **Repo:** `aydinparkevlerisitesi-crypto/proyonetim2026`
- **Branch:** `main`
- **HEAD (oluşturma anı):** `4d8922955b2f5377016bb3a1aaaa2095767b88e0`
- **Staging ref:** `qfpwcbsqmbggvycbdzvk`
- **Production ref:** `wwzjpsqhpvvnqofqpwur` — reddedilir
- **Workflow çalıştırıldı mı:** hayır
- **Push:** hayır (onay bekleniyor)
- **Komut 3:** **HAYIR**
- **Secret / DSN / key / parola:** bu dosyada yok

## İnceleme (içerik loglanmadı)

| Dosya | Var | sha256 ilk 8 |
|-------|-----|----------------|
| `supabase/staging/00_schema_bootstrap.sql` | evet | `63b90705` |
| `supabase/migrations/20260825_multitenant_rls.sql` | evet | `df4c82d0` |
| `supabase/seed/staging_rls_seed.sql` | evet | `adb3647d` |

SQL taraması: production ref, DSN, JWT, private key yok. Seed e-postaları `*@test.local`; isimler `Test *`. `.env*` / `*.local` workflow’a alınmadı.

## Workflow

- Dosya: `.github/workflows/staging-migration.yml`
- Tetik: yalnız `workflow_dispatch` (manuel)
- Environment: `staging`
- Environment secret adı: **`SUPABASE_DB_URL`** (tek secret; dosyaya yazılmadı)
- Job sırası: `preflight` → `apply` (needs preflight) → `smoke` (needs apply)
- Apply SQL sırası: bootstrap → `20260825_multitenant_rls.sql` → `staging_rls_seed.sql`
- Fail-fast: `ON_ERROR_STOP=1`, ayrı step’ler, `set +x`
- `psql` `PGSSLMODE=require`
- Production host/DSN/env fail-fast
- Smoke: `https://qfpwcbsqmbggvycbdzvk.supabase.co` public host; gerçek PII yok

## Operatör (henüz yapılmadı)

1. GitHub → Settings → Environments → `staging`
2. Environment secret: `SUPABASE_DB_URL` = Session Pooler DSN (`*.pooler.supabase.com`, user `postgres.qfpwcbsqmbggvycbdzvk`, port `5432`, gerçek parola; Direct/`YOUR-PASSWORD` yok)
3. Onay sonrası push; workflow otomatik çalışmaz
