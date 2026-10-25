# Release verification — 2026-10-25

Production: https://api.praritsidana.com
Source: https://github.com/prarit0097/apikeywebapp
App directory: `/opt/apikeywebapp`
Application code revision: `4a5d63c` (subsequent documentation commits do not change the deployed application).

## Evidence

- 35 automated tests passed, including owner setup race, sessions/CSRF, provider secret encryption, key revocation, IP/URL restrictions, Docker proxy client-IP separation, shared quota reservations, period/timezone reset, RPM/TPM, persistent uncertain reservations, paid budget guards, key rotation races, text/tools, native headers/thinking, incomplete streams and cancellation.
- TypeScript checks and Vite/server production builds passed on local Node 24 and in the production Docker build. Production dependency audit reported zero known vulnerabilities.
- Browser workflow passed: setup, login, provider creation, model alias, reveal-once gateway key, gateway model-list connection test, navigation, modal dismissal and desktop/mobile layouts including 375px reduced motion. These used fake credentials in a separate local database.
- Installed Claude Code **2.1.302** completed two turns through the gateway, including the real Read tool on a disposable local fixture, ending with KEYPOOL_OK. Its upstream was deterministic test data, not a real LLM. This verifies client protocol/tool-loop plumbing only, not any external model's behavior or entitlement.
- Public HTTPS checks: `/` 200; `/healthz` 200; `/api/session` 200; owner providers without login 401; gateway model-list without a key 401; HTTP redirects 301 to HTTPS; untrusted Origin rejected 403. `.env` did not expose secrets.
- Public browser rendered the owner setup screen on desktop and 375px mobile with zero browser console/runtime errors and no page overflow. Self-hosted fonts comply with strict CSP.
- Valid Let's Encrypt certificate issued for this domain, expiry 2027-01-23. Existing certbot timer active; domain-specific Nginx reload renewal hook installed. `nginx -t` passed after final configuration.
- Docker service is loopback-published on port 4186 with a dedicated Compose network, non-root process, read-only image filesystem, dropped capabilities, memory/CPU limits, persistent app-owned data and restart policy.
- Persisted a temporary SQLite marker, restarted only this app, confirmed the marker survived, then removed it. Public requests with forged XFF values mapped to one real-client authentication bucket behind Nginx, confirming forwarded-header overwrite/proxy handling.
- SQLite online backup completed and its nonempty result is stored privately at `/opt/apikeywebapp/backups/verified-initial.sqlite`. Production secrets remain separate from Git/images. Backup, environment, data and ACME paths are excluded from the build context.
- All **17 pre-existing Docker containers retained the same IDs** before and after deployment. Only this application's container was created/recreated. Shared Nginx was gracefully reloaded; no unrelated app was restarted.
- Production owner count remains zero intentionally, so the user can privately choose their own owner email/password. The one-time setup token is in a private local delivery file and `/opt/apikeywebapp/.bootstrap-access.txt`, never committed.

## Review and decisions

A fresh read-only reviewer found four Important issues: mixed tool-result ordering, a missing finite budget requirement for paid routes, stale async credential writes, and Docker proxy IP trust. Each was reproduced with a failing test, fixed, and verified in the green suite. No minor findings were deferred.

Execution decisions retained from the implementation ledger:

1. Work was executed inline in the user's otherwise-empty project workspace on a feature branch; the branch is integrated into local main and the authorized repository's main. No additional worktree or per-task agents were needed.
2. Gemini initially uses its official OpenAI-compatible endpoint, not a second native adapter. The cost is a narrower supported feature set; unsupported semantics return explicit errors.
3. Provider balances and tokenization remain manual/unknown estimates. They are not monetary billing caps. Paid routing requires explicit opt-in and a finite pool allowance; a credential is potentially paid unless the owner explicitly classifies it as free-only. Provider-side billing controls remain necessary.
4. Live provider entitlement, LLM behavior and a genuine external-model coding session await keys added privately by the owner. No real upstream success claim is made from mocked tests.
5. Claude Code's effort setting is mapped explicitly to the OpenAI reasoning-effort field; supported values and model compatibility remain upstream-specific. Reasoning content blocks in translated streams, caching and unsupported advanced fields remain explicit compatibility errors.
6. Deployment-specific conditions were settled from actual server inspection and external checks: available app port, folder permissions for the ACME webroot, matching existing HTTP/2 listener options, strict-CSP font bundling, TLS, persistence and unchanged unrelated containers.

## Start using the app

Open the website and use the private setup token to create the owner account. Add actual provider credentials and exact model IDs, identify shared quota groups, configure aliases, generate a gateway key, then open Connect Claude Code. The deployment is complete; external-model validation can begin after the owner supplies the corresponding private provider keys.
