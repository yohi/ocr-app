# Antigravity Capacity Fallback Design

## Goal

Keep `gemini-3.8-flash-medium` as the normal review model while preventing provider capacity errors and stalled turns from multiplying GitHub Actions minutes.

## Context

Recent runs returned `503 UNAVAILABLE` and `No capacity available for model gemini-3.8-flash-medium`. The host currently retries transient errors up to three times. The workflow also passes the 600-second host timeout to `agy --print-timeout`, although earlier runs were cut off by `agy` after five minutes.

## Design

`antigravity-host.mjs` will evaluate a primary model and an optional fallback model. Capacity, unavailable-service, provider-rate-limit, print-timeout, and host-timeout errors will not retry the same model. If a fallback is configured, the host starts it once; if it also fails, the host returns the sanitized failure result. Existing retry behavior remains available for other transient errors such as context cancellation and permission-denial recovery.

The fallback model will default in the workflow to the previously working `claude-opus-4-6-thinking` and can be overridden by `ANTIGRAVITY_FALLBACK_MODEL`. The primary model remains controlled by `OCR_LLM_MODEL`.

The host and `agy` print timeout are separated. `ANTIGRAVITY_PRINT_TIMEOUT_MS` defaults to 300000 ms, so the CLI does not inherit the 600000 ms host timeout. The repository variable `ANTIGRAVITY_TIMEOUT_MS` will be changed to 300000 ms as the operational configuration, keeping each model attempt bounded to five minutes.

Production review steps will set `ANTIGRAVITY_MAX_RETRIES=1`, `ANTIGRAVITY_FALLBACK_MODEL`, and `ANTIGRAVITY_PRINT_TIMEOUT_MS`. Capacity failures therefore take at most one primary attempt followed by one fallback attempt, rather than three repeated primary attempts.

## Error Contract

- Capacity and unavailable errors switch models without retrying the current model.
- Print-timeout and host-timeout errors switch models without retrying the current model.
- Other transient errors may retry according to `ANTIGRAVITY_MAX_RETRIES`.
- A successful fallback returns the same validated review schema as a primary success.
- If all candidates fail, the final error is sanitized and returned as the existing failure schema.
- A configured fallback equal to the primary model is ignored to avoid duplicate work.

## Testing

Add unit tests for fallback success, capacity errors without same-model retry, timeout fallback, both-candidates failure, duplicate-model suppression, print-timeout default, and preservation of existing non-capacity retry behavior. Run the complete workflow script test suite and `actionlint` after implementation.
