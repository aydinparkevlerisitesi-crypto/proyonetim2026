# GitHub private backup - 2026-08-05

## Status: BLOCKED - GitHub CLI auth not available in agent shell

Sanitized local package is prepared at:
`C:\Users\HP\Projects\proyonetim2026-sanitized-backup`

Push to `https://github.com/gayrimenkulmove-dotcom/proyonetim2026.git` could not complete because this agent environment has no GitHub auth session.

## Auth check (agent shell)

Both CLIs report not logged in:
- `C:\Program Files\GitHub CLI\gh.exe`
- `C:\Users\HP\Projects\proyonetim-radore-ops\_tools\gh\bin\gh.exe`

Evidence:
- No `hosts.yml` under AppData / `.config\gh`
- `GH_TOKEN` / `GITHUB_TOKEN` unset in this process
- `git ls-remote https://github.com/gayrimenkulmove-dotcom/proyonetim2026.git` → `Repository not found` (typical for private repos without credentials)

## Unblock (manual, once)

In a terminal where you already authenticated, verify:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth status
& "C:\Program Files\GitHub CLI\gh.exe" repo view gayrimenkulmove-dotcom/proyonetim2026 --json visibility,url,isPrivate
```

If still logged out:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login -h github.com -p https -w
```

Or set a PAT for this session only (do not commit):

```powershell
$env:GH_TOKEN = "<PAT with repo scope>"
```

Then re-run the sanitized push task.

## Pre-flight (completed earlier)

| Check | Result |
|-------|--------|
| Kit path | `C:\Users\HP\Downloads\PROYONETIM-PRIORITY-FULL-SERVER-20260805\` |
| Manifest SHA256 | `827c16ffd3254250f4a3057711c36c3f037972cb2394a79b05a0b505d2867993` |
| Tar SHA256 | MATCH |
| Tar size | ~45 MB |

## Local sanitized package (ready, not pushed)

Path: `C:\Users\HP\Projects\proyonetim2026-sanitized-backup`

Included:
- restore-docs (INSTALL/RESTORE/MANIFEST)
- offline-kit-pointers (SHA256 + DOWNLOAD-ONE-BY-ONE)
- brand, markers
- env-templates (values blanked)
- api-critical-src (login-info + *.bak* removed)
- docs / ops-rules (selected)
- strong `.gitignore`, README, TRANSFER-INVENTORY

Excluded (never staged for Git):
- full `*.tar.gz` / parts
- `.env` / `.env.REAL` / credential logs / DB dumps / supabase-logical JSON

Secret scan: 0 matches for common key/token/password/private-key patterns after sanitization.

## Target repo

- URL: https://github.com/gayrimenkulmove-dotcom/proyonetim2026.git
- Visibility: must verify PRIVATE before push (`gh repo view --json visibility`)
- Do not change visibility

## Explicitly not done (auth blocker)

- Confirm PRIVATE via authenticated `gh`
- Commit SHA on remote `main`
- Push

No live Radore / WhatsApp / landing / deployment-agent changes.

---
Updated: 2026-08-05 - local sanitized package ready; push blocked on agent-shell auth.
