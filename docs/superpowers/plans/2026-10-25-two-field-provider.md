# Two-field provider connection

User explicitly requests only API key and base URL; derive everything else automatically. Continue implementation/deployment under existing continuous-work authorization.

## Design

- New/edit provider form has exactly two inputs: Base URL and API key (optional on edit to retain the same-origin credential). No model, provider name, protocol, project ID, budget or billing questions.
- Owner-only connection API validates public HTTPS and reads metadata using server-side credentials. Never send a saved key to a new origin without re-entry. All probes stay on the supplied origin, use pinned-public DNS and do not follow redirects. No text generation, charges or arbitrary cross-origin discovery.
- Discover model lists, model pricing/capabilities and known provider account/token-quota metadata. Normalize pasted generation endpoint suffixes and version paths. Detect Anthropic/Gemini on their exact official hosts; OpenAI-compatible is the default for other platforms including NaraRouter.
- Auto-name from known host or sanitized hostname. Conservatively group automatic connections by upstream origin, even when account metadata appears inconsistently, so unidentified keys cannot multiply capacity. Reuse existing origin groups and preserve explicit group configuration on same-origin edits; this can undercount truly separate accounts but cannot invent independence.
- Select supported text/tool models, prefer provider-declared free models; never infer free entitlement from a key prefix, model name or missing price. Unknown/paid billing remains blocked by the existing opt-in guard. Unsupported/missing model discovery saves a paused pending credential with a clear reason and retry option, not a fabricated model ID.
- Token allowance may be populated only from explicit token-denominated metadata. Dollar credits, RPM, context size and subscription text are not token balances. Unknown stays Unknown. Existing quota groups/counters must not be reset or duplicated by re-detection.
- Persist auto-detection summary/source/date without secret/account-response bodies; show read-only detection results and useful pending/error states. Metadata checks never reveal upstream credentials.

## Implementation

1. Write and observe failing tests for two-field connection, model/protocol/default-name inference, conservative shared grouping, malformed metadata, unknown-vs-zero prices, unsupported models, edit key protection, secrets and billing guards.
2. Build bounded read-only discovery service and owner connection/re-discovery endpoints. Preserve legacy management API for existing advanced configurations.
3. Replace provider form with two fields and loading/detection feedback using existing UI/UX Pro design. Keep all inferred fields out of the onboarding flow.
4. Run tests, build and browser acceptance (exactly two inputs; inferred model gets into super route only when eligible). Fresh review, fix substantive findings.
5. Back up production, push and deploy only this app in /opt/apikeywebapp; check HTTPS, owner boundaries and unchanged unrelated containers. Do not use screenshot-masked credentials or run real model generation.
