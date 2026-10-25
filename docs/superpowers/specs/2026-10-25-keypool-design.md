# KeyPool hosted API gateway design

Date: 2026-10-25
Status: Proposed for user review; implementation has not started.

## Intent and authorized destination

Build a personal web dashboard that stores the owner's LLM provider credentials and issues gateway credentials. The owner uses a gateway key and base URL in clients including Claude Code. Capacity remains with upstream providers: no tokens are transferred into a new provider account.

- Repository: https://github.com/prarit0097/apikeywebapp (public, currently empty).
- Production origin and gateway base URL: https://api.praritsidana.com.
- Host: user's Hostinger Ubuntu VPS at 187.127.132.106.
- User selected hosted deployment following discussion of local, hosted, and existing-gateway options.
- Verified read-only: SSH works using an existing local identity, DNS A record points at this VPS, Nginx and Docker are installed, and multiple other applications use the server.

## Goals

1. Add, test, enable, disable and delete upstream LLM credentials through a private dashboard.
2. Issue, list and revoke gateway keys without exposing upstream credentials to clients.
3. Route compatible requests through independent available quota pools with configurable priority and bounded fallback.
4. Expose Anthropic Messages and OpenAI Chat Completions client formats for explicitly supported upstream adapters.
5. Show recorded usage, routing failures and honest quota estimates with their source and reset period.
6. Provide copyable Claude Code setup instructions and a gateway connection test.
7. Deploy with HTTPS, persistent data, automatic restart, documented backups and rollback.

## Non-goals and anti-goals

- No promise that arbitrary free APIs work, or that a non-Claude model behaves like Claude.
- No transfer of tokens, combination of context windows, quota restriction bypass, account creation, or splitting a single generation across providers.
- No public signup, multi-tenant billing, subscriptions or paid-provider auto-discovery in version one.
- No fake remaining balance, fabricated live telemetry, or unsupported claim of Claude Code compatibility.
- No API credentials, private SSH keys, production databases or generated deployment secrets in GitHub.

## Approaches considered

1. Local-only app: avoids hosting but depends on the owner's PC; user selected hosted deployment instead.
2. Dedicated hosted gateway with custom dashboard: fits the requested public domain and gives explicit control over quota groups and compatibility. Selected deployment direction; implementation details below are builder proposals.
3. Dashboard over an existing gateway: can accelerate provider support but adds a separately operated service and still requires exact protocol and quota verification. Not proposed for version one.

## Proposed implementation choices

These are builder recommendations, not choices the user has individually confirmed.

- React, TypeScript and Vite for the dashboard; Node.js TypeScript for the HTTP service.
- A single production service serves the built dashboard and API; SQLite stores application data on a persistent volume.
- A pinned supported Node LTS container, with dependencies locked in the repository.
- Dedicated Docker Compose project and a loopback-only host port selected after checking availability. Existing Nginx terminates TLS and proxies only this domain.
- Dedicated application folder /opt/apikeywebapp; domain-specific Nginx configuration. Do not alter unrelated sites, ports, databases or services.
- User explicitly requires folder isolation because multiple apps run on the server: keep this app's source, Compose files, secrets, persistent database and backups under /opt/apikeywebapp with appropriately restricted subdirectories. Use a unique Compose project name and dedicated network; do not share another app's database or Redis. Only the domain-specific proxy/certificate integration lives in the existing system Nginx/Let's Encrypt locations. Validate Nginx and use a graceful reload, never a server-wide service stop or Docker cleanup.
- Single owner account, no public registration. First setup uses a random server-side bootstrap token that is never committed or placed in public URLs. Owner chooses their password through HTTPS. Setup closes atomically after the account is created.

## Pages and UX

Use UI/UX Pro Max guidance already searched for SaaS monitoring dashboards. Direction: dark slate surfaces, green primary actions, Fira Sans body and Fira Code technical values. Keep panels mostly solid for legibility; subtle borders, clear hierarchy, accessible contrast and reduced-motion support.

- Overview: active providers, recorded token usage, recent success/error counts, capacity grouped by compatible allowance period. Empty state leads to adding a provider.
- Providers: named credentials, adapter, base URL where applicable, actual model IDs, quota group, priority, optional manual allowance and reset schedule. Mask saved secrets and support replacing them. A key test may consume upstream quota and is labelled accordingly.
- Gateway keys: create, reveal once, show prefix, revoke, last-used timestamp. No later retrieval of plaintext key.
- Routing/models: named aliases map to compatible upstream models and ordered credentials; cross-model fallback requires explicit owner opt-in. Show capability and compatibility status.
- Usage: timestamp, request ID, alias, selected upstream, outcome, latency and input/output token usage when reported. No prompt or response bodies by default.
- Claude Code setup: production URL, PowerShell configuration, actual alias mapping and a test status. Distinguish gateway connectivity from a verified Claude Code coding session.

All forms have visible labels, pending/error states, keyboard operation and visible focus. Mobile navigation collapses; tables adapt without making the whole page horizontally scroll. Status uses words/icons as well as color. Show telemetry timestamps and stale states.

## Credential and owner security

- Passwords use a password-specific salted hash; sessions use random opaque tokens stored hashed server-side with Secure, HttpOnly and SameSite cookies, bounded expiry and logout invalidation.
- Rate-limit login, bootstrap and gateway authentication. Protect cookie-authenticated mutations against CSRF with exact-origin enforcement and a CSRF token.
- Upstream keys use authenticated encryption at rest with a random production encryption key outside the repository and database. Gateway keys store only a hash and prefix.
- All provider-management endpoints require owner authentication. Gateway endpoints accept gateway credentials, not owner session cookies as their authorization mechanism.
- Never put secrets in request logs, errors, analytics, localStorage, screenshots or the public repository. Redact authorization headers.
- Custom upstream URLs must use HTTPS and reject embedded credentials, local/private/link-local/metadata IP ranges, including IPv6 and DNS results. Disable redirects and pin validated resolution for connections to mitigate DNS rebinding. Do not expose an arbitrary unauthenticated proxy.
- Apply request size, timeout and concurrency limits. Disable broad CORS. Return sanitized upstream failures and request IDs.

## Providers and compatibility contract

Initial adapters: Anthropic Messages, OpenAI-compatible Chat Completions, and Google Gemini generateContent, subject to version-one protocol tests. Gemini can use its OpenAI-compatible surface only for the subset verified by adapter tests; provider differences must remain explicit.

Each credential has explicit model records with capabilities: tools, streaming, maximum accepted context if known, and adapter feature support. Discovery is best effort; manual model entry is allowed. An invalid/unknown API cannot become supported merely by entering a URL.

Expose:

- POST /v1/messages (including query strings used by clients).
- POST /v1/chat/completions.
- GET /v1/models, gateway-authenticated.
- GET /healthz with minimal public health information.
- Owner management routes under /api/admin/.

Anthropic request/response translation must preserve system messages, text blocks, tool declarations, tool_use/tool_result IDs, stop reasons and usage. SSE translation must emit correctly ordered content blocks and terminal message events, stream without whole-response buffering, propagate cancellation, and maintain liveness. Unsupported reasoning, images, caching or other fields must return an actionable compatibility error rather than silently discard semantics. Native Anthropic pass-through forwards required version/beta headers and supported feature fields.

Token counting is optional initially. Omit the endpoint rather than present a fabricated exact count. Claude Code can estimate when it is absent.

Claude Code documentation supports gateway configuration but does not officially support routing to non-Claude models. Mark those models Experimental until a real installed-client coding/tool-loop test succeeds, and disclose unsupported features even after that test. No provider credentials have been supplied yet, so live upstream and coding verification remain dependent on owner configuration.

## Routing and quota accounting

1. Authenticate the gateway key and resolve an explicit model alias. Do not silently map an unknown Claude model to an unrelated model.
2. Filter candidates by adapter features, required context, enabled state, user policy and available quota group.
3. Use configured priority, with rotation among equally prioritized eligible independent candidates. Persist cooldowns and atomically reserve estimated capacity before dispatch so parallel requests cannot independently spend the same known allowance.
4. Reconcile reservations with upstream usage on completion. Missing usage stays Unknown; interrupted/ambiguous requests keep a conservative reservation until reconciled or the allowance resets. Estimates never become verified values.
5. A quota group represents the actual shared account/project/model limit scope; keys in the same group share counters and cooldowns. Google project keys must not be counted independently. Owner supplies group IDs when discovery cannot establish them; unverified independence is clearly labelled.
6. Track RPM/TPM and daily/monthly/lifetime allowances as different measures. Input/output/cached tokens can be separate; tokenizers and prices differ. Aggregate only comparable independent allowances for the selected compatible pool and same period, as a labelled estimate. If some limits are unknown, the total is incomplete, not an exact balance.
7. On 401/403, flag the credential for review without applying the same assumption to unrelated credentials. On 429, honor Retry-After and cool down its shared quota scope. On eligible transient failures, bounded retry/fallback before any response bytes reach the client: maximum three upstream attempts total per incoming request with an overall deadline.
8. No automatic retries after stream output begins or when a dispatch outcome is ambiguous in a way that could duplicate an upstream operation. Do not rotate shared credentials to evade a provider restriction.
9. Cross-model/cross-provider fallback is owner-configurable and off by default for semantically different models; same-model independent credentials may fail over. Paid credentials require an explicit owner opt-in and local budget guard. A local budget estimate cannot guarantee the provider will never bill; show that limitation.
10. Exhausted pools return a clear structured error and known retry time, never a claim that a new allowance was created.

## Data boundaries

Logical records: owner, sessions, credentials, quota_groups, models, aliases, alias_targets, gateway_keys, usage_events, quota_reservations and settings. Separate encrypted credentials from sanitized response objects. Track created/updated/reset timestamps in UTC, display local time in the dashboard. Configure SQLite durability and backup consistently; use an online backup or stop service for copies rather than copying an active DB file without its WAL state.

## Delivery sequence and verification gates

1. Authentication/storage foundation: verify setup locking, password login, session protection, encrypted credential persistence, redaction and gateway key revocation.
2. Provider and gateway adapters: deterministic local mock upstream tests for text, tools, streaming, error translation, cancellation and unsupported capabilities.
3. Routing and accounting: tests for shared groups, concurrent reservations, period reset, Retry-After, bounded fallback, unknown usage and partial streams.
4. Dashboard: all management paths, empty/error states, masked secrets and accurate quota labels; desktop and narrow-screen review.
5. Packaging and publication: production build, pinned lockfile, automated tests, container health, secret exclusion and repository upload.
6. Deployment: isolated app deployment, Nginx config validation before reload, domain-specific TLS issuance, external HTTPS and unauthorized-route tests, restart/persistence check and documented rollback.
7. After owner adds actual keys: opt-in live provider test and an end-to-end Claude Code tool loop on a disposable directory. Until then report deployment and mocked compatibility separately from live model compatibility.

## Operations and rollback

- Keep production secrets and data outside Git and container images. Set restrictive filesystem permissions.
- Before changing this app's deployment, retain its previous image/version and database backup. No global server upgrades or unrelated service restarts are part of this task.
- Nginx must disable buffering for streamed responses and support suitable stream timeouts.
- Renew certificates through the server's existing certificate tooling after inspecting its setup.
- Document deployment, restart, backup, restore, key rotation and rollback in the repository.

## Remaining approval

User has specified hosting, domain and repository. This document records proposed product and implementation defaults for approval before product code is built. No further access details are currently needed. Live provider verification requires credentials added privately to the completed dashboard, never committed or requested in public chat.
