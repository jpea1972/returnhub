# API Reference

All routes are in `server.js`. Base URL: `https://returnhub-production.up.railway.app`

## Authentication

Most routes have no auth (internal warehouse use behind network). Integration endpoints require Bearer token.

---

## Worker & Session Routes

### POST /api/db/sessions/start
Start a worker session. Body: `{worker_id, station, ip_address}`. Returns session ID.

### POST /api/db/sessions/end
End a session. Body: `{session_id}`.

### GET /api/db/workers
List all workers.

### POST /api/db/workers
Create worker. Body: `{initials, full_name, pin, role}`.

### POST /api/db/workers/verify
Verify PIN. Body: `{initials, pin}`. Returns worker record + starts session.

---

## Return Processing Routes

### POST /api/db/duplicate-check
Check if return already processed. Body: `{tracking_number, order_number, customer_name, sku_fingerprint, merchant_id}`. Returns `{duplicate: true/false, existing: {...}}`.

### POST /api/db/returns
Save a processed return. Body includes: order_number, tracking_number, condition, billing_rate, billed_amount, worker_id, session_id, merchant_id, line_items[]. Side effects: inserts return_line_items, updates session total_returns, creates WMS export records if condition=Good.

### GET /api/db/returns/search
Search processed returns. Query: `?q=&condition=&worker_id=&date_from=&date_to=&merchant_id=&limit=&offset=`.

### POST /api/db/manual-ref
Create a manual return reference. Body: `{tracking_number, customer_name, line_items, merchant_id}`.

---

## Cache & Sync Routes

### GET /api/db/cache
Get unprocessed returns from rr_cache. Query: `?merchant_id=X`. Excludes returns already in the returns table.

### POST /api/db/sync
Trigger incremental sync. Body: `{merchant_id}`. Loads merchant API key, calls platform adapter. Returns pages_fetched, records_added.

### POST /api/db/sync/:merchantId/trigger
Manual sync trigger for a specific merchant. Runs in background.

### GET /api/db/sync/:merchantId/trigger
Same as POST trigger (convenience for browser).

---

## Reporting Routes

### GET /api/db/reports/billing
Billing summary. Query: `?date_from=&date_to=&merchant_id=`. Returns totals for good/damaged/revenue.

### GET /api/db/reports/productivity
Worker hourly stats. Query: `?worker_id=&date_from=&date_to=&merchant_id=`.

### GET /api/db/reports/productivity-summary
Worker leaderboard. Query: `?date_from=&date_to=&merchant_id=`.

### GET /api/db/rr-stats
Dashboard stats (open RMAs, in transit, arrived today, completed). Query: `?merchant_id=`.

### GET /api/db/days-held
Pending returns aging report. Query: `?merchant_id=`.

---

## Rates Routes

### GET /api/db/rates
Get billing rates. Query: `?merchant_id=X` reads from merchants table; without it, reads from client_rates.

### PUT /api/db/rates
Update rates. Body: `{good_rate, damaged_rate, worker_id, merchant_id}`.

---

## Flags Routes

### GET /api/db/flags
Get return line flags. Query: `?condition=&date_from=&date_to=&merchant_id=&q=&limit=&offset=`. The `q` parameter does server-side search across order_number, rma_name, customer_name, sku, product_name, tracking_number.

### POST /api/db/flags
Create flags for a return. Body: `{return_id, flags: [...]}`.

### PUT /api/db/flags/:id
Update a flag. Body: `{condition, disposition, damage_notes, received_qty}`.

---

## Merchant Routes

### GET /api/db/merchants
List all merchants.

### POST /api/db/merchants
Create merchant. Body: `{name, slug, platform, api_key, ...}`.

### PUT /api/db/merchants/:id
Update merchant. Partial update via COALESCE.

### GET /api/db/merchants/:id/rates
Get merchant rates.

### PUT /api/db/merchants/:id/rates
Update merchant rates.

---

## Printer Routes

### GET /api/db/printers
List all active printers. Shared across all workstations.

### POST /api/db/printers
Add printer. Body: `{name, ip, port, brand, lang, size, dpi, location}`.

### PUT /api/db/printers/:id
Update printer.

### DELETE /api/db/printers/:id
Soft-delete (sets active=false).

### PUT /api/db/printers/:id/default
Set as default printer (clears previous default).

---

## Print Routes

### GET /api/print/config
Get print system configuration.

### POST /api/labels/print-job
Create print job + generate ZPL. Body: `{sku, description, stock, dpi, copies, ...}`. If stock/dpi not provided, reads from default printer in DB. Returns ZPL and job ID.

### PUT /api/db/print-jobs/:id/status
Update print job status. Body: `{status, printer_name, error_text}`.

### POST /api/labels/preview
Generate ZPL preview. Body: `{sku, description, stock, dpi}`.

---

## QZ Tray Security Routes

### GET /api/qz/certificate
Returns QZ public certificate PEM.

### POST /api/qz/sign
Signs data for QZ Tray auth. Body: `{toSign}`.

---

## AfterShip Webhook

### POST /api/webhooks/aftership/:merchantId
Receives AfterShip return events. Verifies HMAC signature against `merchants.settings.webhook_secret`. Saves to rr_cache. Returns 200 even on error to prevent retry storms.

---

## WMS Integration Routes (Bearer Token Required)

### GET /api/integrations/wms/returns
**Auth:** `Authorization: Bearer {token}` with `wms:read` scope.

Pull queued Good return exports. Query: `?after_id=0&limit=100`.

Response:
```json
{
  "success": true,
  "next_after_id": 1052,
  "count": 4,
  "exports": [
    {"export_id": 1049, "idempotency_key": "returnhub:good-inventory-export:1049:v1", "owner_project": "Paragonfitwear", "sku": "ABC", "quantity": 1}
  ]
}
```

### POST /api/integrations/wms/returns/acknowledge
**Auth:** `Authorization: Bearer {token}` with `wms:acknowledge` scope.

Body: `{"export_ids": [1049, 1050], "external_reference": "datex_batch_123"}`

Response: `{"success": true, "acknowledged": 2, "requested": 2}`

### POST /api/db/integration-tokens
Admin: generate new integration token. Body: `{name, partner, merchant_id, scopes}`.

### GET /api/db/integration-tokens
Admin: list tokens (masked).

### GET /api/db/wms-export-stats
Admin: export queue stats (queued/acknowledged/failed counts).

---

## Health

### GET /api/health
Returns `{status, rrConfigured, dbConfigured, timestamp}`.

### GET /api/db/health
Returns database health + last sync info.
