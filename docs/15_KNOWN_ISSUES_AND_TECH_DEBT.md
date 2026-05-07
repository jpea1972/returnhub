# Known Issues and Tech Debt

| Issue | Risk | Impact | Recommended Fix | Blocks Work? |
|-------|------|--------|----------------|-------------|
| PINs stored as plain text | Medium | Security risk in multi-tenant | Hash with bcrypt | No |
| CORS defaults to * | Low | Any origin can call API | Set ALLOWED_ORIGIN env var | No |
| merchants.api_key returned in full via GET /api/db/merchants | Medium | API key visible in frontend | Mask in API response | No |
| rr_cache unique constraint on order_number only | Medium | Same order from different merchants could collide | Add (order_number, merchant_id) unique index | No |
| No rate limiting on PIN attempts | Medium | Brute-force possible | Add rate limiter middleware | No |
| Daily sync hardcoded to 6 AM UTC | Low | Can't customize per merchant | Use sync_interval_hours field | No |
| Cache date cutoff hardcoded to 2026-01-01 | Low | Needs updating annually | Make configurable | No |
| BarTender fallback URL hardcoded | Low | 192.168.120.13:3001 in qz-print.js | Move to config | No |
| billing_periods/billing_line_items unused | Info | Tables exist with 0 records | Implement or remove | No |
| Firefox QZ websocket | Low | Rejects self-signed SSL for wss:// | User must accept cert | No |
| PUT /api/db/workers/:id ignores billing field | Medium | Billing flag not updatable | Add to UPDATE query | No |
| GET /api/db/workers omits active/billing fields | Low | Missing from SELECT | Add to query | No |
| Loop adapter field mapping | Low | Built from docs, not tested against real API | Test with real Loop client | No |
| No session expiry | Low | Sessions stay active indefinitely | Add timeout logic | No |
| server.js is a single 2,500-line file | Medium | Hard to navigate | Split into route files (future) | No |
