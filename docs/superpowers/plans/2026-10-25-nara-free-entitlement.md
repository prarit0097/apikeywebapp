# Nara free entitlement and Desktop model validation repair

Goal: restore real free routes using official same-origin public plan pricing intersected with authenticated model access, and stop recommending a Desktop model ID the installed client rejects.

- [x] Reproduce unknown pricing/free catalog mismatch; agent adds exact-host Nara public-plan enrichment and adversarial tests. No public plan cap becomes account balance.
- [x] Independent agent reviews pricing precedence and secret/host boundaries.
- [x] UI agent makes Desktop configuration require an actual Claude model ID; Code/OpenAI retain super pooling. Browser fixture asserts this distinction.
- [x] Root verifies full suite/build/browser, backs up, deploys only gateway, refreshes saved metadata without revealing keys or generating paid calls, checks public model discovery and unchanged unrelated apps.

Observed client constraint: installed Claude Desktop rejects manual super ID as non-Anthropic. Restored original unsaved field immediately; no config was saved or paid generation invoked. Never map a paid Claude name to a different free model.

Actual saved provider investigation: current provider is Oxion, not Nara. Its authenticated model catalog includes the requested Claude ID. Public plans cannot establish account remaining allowance; the already signed-in owner dashboard was read without changes. The active masked API-key prefix matched the saved credential. A fixed, dashboard-confirmed included-token budget was imported without assuming automatic renewal. Account-specific billing values are not recorded in this repository. No purchase/top-up/subscription change.

Authenticated gateway discovery now returns actual provider IDs. A minimal real requested-model call reached the provider and was rejected503. A second minimal direct model request independently returned error.code service_upgrading/type maintenance; no output/usage. The gateway cannot repair external provider maintenance; expose a sanitized503 and retain safe fallback instead of claiming success. No raw provider error body or secret is sent to clients.
