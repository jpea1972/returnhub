# Security and Secrets

## Authentication

### Worker Auth
4-digit PIN + initials. PIN stored as plain text in workers.pin_hash column. No hashing, no rate limiting on attempts.

### Integration Auth
Bearer token via `Authorization: Bearer {token}` header. Tokens stored in integration_tokens table with scopes (wms:read, wms:acknowledge). Token validated on every request. last_used_at updated automatically.

### AfterShip Webhook
HMAC-SHA256 signature verification against merchants.settings.webhook_secret.

## Secrets That Must Stay Server-Side

| Secret | Location | Never Expose To |
|--------|----------|----------------|
| RR_TOKEN | Railway env var | Frontend, logs, API responses |
| DATABASE_URL | Railway env var | Frontend, logs |
| QZ_PRIVATE_KEY_PEM | Railway env var | Frontend, API responses |
| merchants.api_key | Database | Frontend (GET /api/db/merchants does return it — should be masked) |
| integration_tokens.token | Database | Listed masked via GET /api/db/integration-tokens |
| merchants.settings.webhook_secret | Database | Frontend |

## CORS

ALLOWED_ORIGIN env var. Defaults to `*` (allow all) if not set. Should be restricted in production.

## PII Handling

- Customer names and tracking numbers are stored in rr_cache and returns tables
- WMS export endpoint intentionally excludes all PII — only sends export_id, idempotency_key, owner_project, sku, quantity
- No customer data sent to MindCloud/Datex

## Known Security Gaps

| Gap | Risk | Notes |
|-----|------|-------|
| PINs stored as plain text | Medium | Should hash with bcrypt for multi-tenant |
| No rate limiting on PIN attempts | Medium | Brute-force possible |
| CORS defaults to * | Low | Should set ALLOWED_ORIGIN |
| merchants.api_key returned in full via GET /api/db/merchants | Medium | Should mask in API response |
| No HTTPS enforcement in code | Low | Railway provides HTTPS at edge |
| No session expiry | Low | Sessions stay active until explicit logout |

## Rules for Future Development

- Never log actual secret values
- Never include secrets in git commits
- Never expose database credentials in API responses
- Never send customer PII to external integrations unless explicitly required
- Document variable names and purpose only — never actual values
