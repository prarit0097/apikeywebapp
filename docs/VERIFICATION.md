# Release verification — 2026-10-25

Production: https://api.praritsidana.com
Source: https://github.com/prarit0097/apikeywebapp
App directory: `/opt/apikeywebapp`
Initial application code revision: `4a5d63c`. Latest super-key upgrade code: `74b8533` (subsequent documentation/test-selector commits do not change the deployed application).

## Claude Desktop compatibility and two-field onboarding

- Application code `3cec3e7` adds automatic exact discovered model routes, same-model failover, explicit alias precedence, Anthropic/OpenAI model discovery metadata, pagination and model detail lookup. Unknown Claude IDs are never silently mapped to unrelated models.
- 67 automated tests passed; production typecheck/build passed. The admin fixture now mounts gateway routes in the same order as production. Browser acceptance covers Desktop instructions, root URL, x-api-key, model discovery, conservative 1M settings, preserved Code setup, two-field create/edit, masked keys and 375px layout with no console errors.
- Connect apps now documents all screenshot settings. OpenAI translation still supports only the implemented text/function tool subset; thinking, caching, images and server/deferred tools remain unsupported. No full Desktop/Cowork or real external-model execution claim is made.
- Two-field onboarding from `57932ba` detects name, format, models and supported metadata using same-origin read-only probes. Unknown balances stay unknown. Conservative account grouping, paid-price precedence, external-usage offsets and concurrent owner edits are tested.
- Public authenticated metadata and quota checks passed after deployment using a temporary credential removed immediately afterward. No real provider generation was invoked. Live discovery returned zero eligible models: the saved provider has 33 detected models but unverified billing and remains paused. The connection page explicitly explains this blocker; it does not fabricate free eligibility.
- Dedicated container healthy; all 17 unrelated container IDs unchanged. Online pre-upgrade SQLite backup: `/opt/apikeywebapp/backups/pre-desktop-20261025.sqlite`. Public HTTPS/auth/CSP/mobile checks passed. Historical release observations below describe their original test times, not current owner configuration.

## Super-key upgrade verification

- User's three requirements implemented: automatic multi-platform `super` route, safe exhaustion fallback, and live total/used/reserved/balance plus cumulative per-key usage. Provider onboarding accepts a new pool's allowance and period; shared groups never duplicate it.
- **48 automated tests passed** and production build/typecheck passed. A fresh review found daily-reset cooldown and quota-related 403 recovery issues; both were reproduced RED, fixed, and included in the green suite. No deferred minor findings.
- Browser acceptance used four fake credentials across three independent fixture pools: 10M + 3M + 3B = **3,013,000,000**. The fourth credential shared pool A and did not inflate the total. An explicit exhausted response on A automatically fell back to B.
- Requests using both Anthropic and OpenAI client formats consumed 30 reported fixture tokens through the same key; the dashboard's five-second refresh showed **3,012,999,970** balance and 30 key usage without clicking Refresh. Desktop and mobile had no runtime errors or page overflow.
- Authenticated live-production `GET /v1/quota` returned 200 and model discovery included `super`. The temporary verification credential was removed after checking. No real upstream generation was invoked. Production still has no owner/provider credentials configured, so live capacity correctly shows zero until onboarding.
- External HTTPS, authentication boundaries, strict CSP and mobile owner-setup checks passed after deployment. All 17 unrelated containers retained their IDs. A pre-upgrade online SQLite backup was verified at `/opt/apikeywebapp/backups/pre-superkey-20261025.sqlite`; migrations are additive and retain existing provider/key records.
- Installed Claude Code's controlled tool-loop probe still passed. Real-provider entitlement and actual model capability remain unverified until the owner adds real keys.
- Implementation decisions: automatic pooling uses the first configured model per eligible provider and may change models on failover, as requested. Existing explicitly configured custom `super` aliases preserve their scope. Unknown or incompatible reset schedules yield separate estimated subtotals, not a fabricated exact grand total. Per-key counters are cumulative, while each shared pool's usage follows its own reset window. Direct-to-provider usage cannot be measured by this gateway.

## Initial release evidence

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
