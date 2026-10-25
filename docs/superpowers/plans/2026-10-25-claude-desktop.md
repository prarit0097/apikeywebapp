# Claude Desktop gateway compatibility plan

**Goal:** Resolve the demonstrated missing-model error and make Desktop setup understandable without additional provider inputs.

**Design:** Keep super as an explicit pool with cross-model fallback. Also route exact discovered model IDs across eligible providers that report that same model. Explicit user aliases win. Never silently substitute a different model for an unknown Claude ID. Return Anthropic-compatible discovery metadata alongside OpenAI fields. Desktop settings use root URL and existing gateway key; show conservative capability defaults.

**Tasks**
- [ ] Backend agent: reproduce unknown model, test exact-model routing/discovery, implement catalogue and useful errors.
- [ ] UI agent: Desktop configuration guide, copyable values and discovery troubleshooting, preserve Code setup.
- [ ] Root: full tests/build, isolated browser checks, review, backup and deploy only the dedicated gateway service.
- [ ] Verify public health/auth and unaffected unrelated containers; document evidence.

**Constraints:** No real provider generation for tests. No fabricated quotas, model identity, context capacity, thinking or artifact support. Preserve encrypted credentials, owner data and provider two-field form. Existing user instruction authorizes autonomous implementation/deployment.
