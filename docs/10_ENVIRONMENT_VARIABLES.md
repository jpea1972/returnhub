# Environment Variables

All set in Railway dashboard for the gracious-charisma project.

| Variable | Required | Secret | Purpose |
|----------|----------|--------|---------|
| DATABASE_URL | Yes | Yes | PostgreSQL connection string. Auto-provisioned by Railway. |
| RR_TOKEN | Yes | Yes | Return Rabbit API auth token. Fallback for merchants without api_key. |
| RR_BASE_URL | No | No | Return Rabbit API base URL. Default: `https://api.returnrabbit.app` |
| PORT | No | No | Server port. Set by Railway. Default: 3000 |
| ALLOWED_ORIGIN | No | No | CORS allowed origin. Default: `*` |
| PRINT_MODE | No | No | `hybrid`, `qz`, or `bartender`. Default: `hybrid` |
| QZ_ENABLED | No | No | `true`/`false`. Default: `true` |
| BARTENDER_FALLBACK_ENABLED | No | No | `true`/`false`. Default: `false` |
| DEFAULT_LABEL_STOCK | No | No | Default label size: `2x1`, `3x2`, `4x2`, `4x3`, `4x6`. Default: `3x2` |
| DEFAULT_LABEL_DPI | No | No | `300` or `203`. Default: `300` |
| DEFAULT_PRINT_METHOD | No | No | `direct_thermal` or `thermal_transfer`. Default: `direct_thermal` |
| QZ_PUBLIC_CERT_PEM | No | No | QZ Tray public certificate PEM text |
| QZ_PRIVATE_KEY_PEM | No | Yes | QZ Tray private key PEM text |

## Per-Merchant Configuration (Database, Not Env Vars)

These are stored in the merchants table, not environment variables:
- api_key — platform API token
- api_url — platform API base URL
- settings.webhook_secret — AfterShip HMAC secret
- settings.wms_owner_project — Datex owner/project value
- good_rate / damaged_rate — billing rates

## Integration Tokens (Database, Not Env Vars)

WMS integration tokens are stored in the integration_tokens table, not environment variables.

## Placeholder Examples

```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
RR_TOKEN=<Return Rabbit API token>
QZ_PRIVATE_KEY_PEM=<PEM private key text>
```

Never commit real values to git.
