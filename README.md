# KeyPool

A private, self-hosted API gateway and dashboard. Connect your own LLM provider credentials, configure model aliases and independent quota pools, then use a gateway key and base URL in your tools.

Production: **https://api.praritsidana.com**

## What pooling means

Tokens stay with each upstream provider. KeyPool routes requests across eligible, independently available capacity; it does not transfer credits, increase a model's context window, or bypass provider limits. Multiple API keys in one account/project may share the same quota and must use the same quota group.

An allowance entered in the dashboard is a **manual estimate**, not a verified provider balance. Usage from outside this gateway is not automatically known. Unknown usage remains unknown. Daily, monthly and fixed allowances are separate, with configurable IANA reset timezones. Shared RPM/TPM guards use conservative reservation sizes and do not replace upstream enforcement.

## Features

- Private owner setup, password login and expiring cookie sessions; no public signup.
- AES-256-GCM encrypted provider credentials and hashed, reveal-once gateway keys.
- Anthropic Messages upstreams and OpenAI-compatible Chat Completions upstreams. Gemini uses its official OpenAI-compatible endpoint.
- Model alias routing, priority, independent-pool fallback, shared cooldown and atomic quota reservations.
- Text/tool-call streaming with cancellation, liveness pings and explicit incomplete-response failures.
- Recorded usage and sanitized request logs, without prompt/response bodies.
- Public HTTPS only for upstreams, validated DNS pinned to public addresses, redirects not followed.
- Responsive dashboard and copyable Claude Code configuration.

## First use

1. Open the production website. Use the bootstrap token from your private deployment access file to create the owner account. This closes setup permanently after the first owner.
2. Add a provider. Enter the **exact model IDs** from that provider. Choose the real account/project quota group, not a separate group for every key.
3. Optionally configure the group's allowance, timezone and RPM/TPM. Leave unknown limits blank. If you enter a remaining budget for a partly used account, account for usage already recorded by this gateway when choosing its total allowance.
4. Create a model alias, such as `coding`. Add targets in the desired order; priority also influences scheduling. Different-model fallback requires explicit opt-in.
5. Generate a gateway key and save it immediately. It cannot be recovered later; revoke and create a replacement if lost.
6. Open **Connect Claude Code**, select your alias, and copy the configuration. The connection check only lists gateway models and does not generate tokens.

Provider credential tests use the provider's model-list endpoint. A provider can support generation without supporting this endpoint, so a failed list check is not conclusive evidence that generation is impossible. A successful check does not prove tool or Claude Code compatibility.

## Client endpoints

| Client | Base URL | Endpoints |
|---|---|---|
| Anthropic / Claude Code | `https://api.praritsidana.com` | `POST /v1/messages` |
| OpenAI SDK | `https://api.praritsidana.com/v1` | `POST /chat/completions`, `GET /models` |

Authenticate with `Authorization: Bearer <gateway-key>` or `x-api-key: <gateway-key>`. Use a configured alias for `model`. Unknown aliases return an error instead of silently selecting a different model. `/v1/messages/count_tokens` is intentionally omitted; supported clients can estimate locally.

### Claude Code on Windows

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.praritsidana.com"
$env:ANTHROPIC_AUTH_TOKEN = "<your-gateway-key>"
$env:ANTHROPIC_MODEL = "coding"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "coding"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "coding"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = "coding"
# For translated, non-Claude upstream models:
$env:MAX_THINKING_TOKENS = "0"
$env:DISABLE_PROMPT_CACHING = "1"
$env:ENABLE_TOOL_SEARCH = "false"
$env:CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = "1"
$env:CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1"
claude
```

Non-Claude models in Claude Code are **experimental** and not officially supported by Anthropic. Model behavior and future client releases can differ. This adapter supports ordinary text and function tool calls. Unsupported reasoning, image, prompt caching and advanced request fields produce explicit errors rather than silently dropping their semantics. Native Anthropic requests forward their supported fields. Test your selected model on a disposable project before depending on a full coding workflow.

## Local development

Requires Node.js 24 LTS.

```powershell
npm ci
Copy-Item .env.example .env
# Fill ENCRYPTION_KEY with 32 random bytes encoded as 64 hex characters.
# Fill BOOTSTRAP_TOKEN with a separate random secret of at least 24 characters.
npm run build
node --env-file=.env dist/server/index.js
```

Open `http://localhost:4000`. For development, use `node --env-file=.env --import tsx --watch server/index.ts` and, separately, `npm run dev:ui`. Set `APP_ORIGIN` to the browser's actual origin (for Vite: `http://localhost:5173`) so exact-origin CSRF checks work.

```powershell
npm test
npm run build
```

See [operations](docs/OPERATIONS.md) for deployment, backup, recovery and rollback. Production secrets, SQLite files and local browser artifacts are excluded from Git.

## Limits and safeguards

At most eight concurrent generations and three upstream attempts per incoming request. Retry/fallback is restricted to explicit credential rejection, rate-limit or service-unavailable responses before client output begins. Ambiguous connection failures and partial streams are never automatically replayed. Gateway credentials have a 120-request/minute guard; failed authentication and owner login are rate-limited.

Requests reserve a conservative input byte estimate plus requested maximum output. Actual reported input/output usage reconciles the reservation. Interrupted or unreported usage retains the reservation until the pool resets, so an incomplete request can temporarily reduce estimated available capacity. Manual token budgets are not guaranteed billing caps. Paid credentials require explicit opt-in; configure provider-side billing limits as well.

Logs retain 90 days and prune when requests are recorded. Operations on a credential do not require exposing its saved key. Keep a secure backup of the encryption key: losing it makes encrypted provider credentials unrecoverable.

## Reference protocols

- [Claude Code gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini project-level rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
