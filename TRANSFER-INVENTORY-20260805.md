# ProYonetim PRIVATE backup transfer inventory (sanitized)

Date: 2026-08-05

## Included (pushed) content (sanitized)
- Operational/restore documentation (RESTORE/MANIFEST + install verification docs)
- Brand assets and canonical logo files (safe)
- Offline kit pointer documents + SHA256 (no full tar committed)
- Selected source/ops recovery snippets (sanitized; credential-bearing backups removed)

## Explicit exclusions (never pushed)
- The full offline server tar: PROYONETIM-PRIORITY-FULL-SERVER-20260805.tar.gz (contains .env / .env.REAL / credential backups)
- Any .env* that are REAL/secret-bearing (e.g., .env, .env.REAL, .env.*save*, etc.)
- DB dumps and server-only dumps
- Node modules / build caches
- WhatsApp login-info credential files removed from this sanitized package
- All backup-suffixed files (*.bak*, *.backup*) removed from this sanitized package as defense-in-depth

## Where the offline full kit is stored (user provided path)
- C:\Users\HP\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805\
- SHA256: see offline-kit-pointers/PROYONETIM-PRIORITY-FULL-SERVER-20260805.sha256

## Secret scan status (this working folder)
- Secret-pattern scan for common keys/tokens/passwords/private keys: 0 matches after removing login-info files and blanking env templates.
