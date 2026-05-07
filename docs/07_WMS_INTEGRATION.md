# WMS Integration (MindCloud → Datex)

## Purpose

Export Good-condition returns from ReturnHub to Datex WMS via MindCloud middleware. MindCloud pulls data from ReturnHub's API on their schedule, syncs to Datex, then acknowledges receipt.

## Key Business Rules

- **Only Good returns are exported.** Damaged, Partial, Not Returned, and Wrong Product returns do not create export records.
- **One export record per return line item.** Never aggregated by SKU.
- **Same SKU can appear many times.** If 10 returns contain the same SKU, MindCloud sees 10 separate export records.
- **Duplicate prevention is by export_id (return_line_item_id), not by SKU.**
- **No customer PII sent to MindCloud/Datex.** Payload is: export_id, idempotency_key, owner_project, sku, quantity.
- **owner_project is fixed server-side** from `merchants.settings.wms_owner_project` or merchant name.

## Data Flow

```
Worker processes Good return
    ↓ POST /api/db/returns saves to returns + return_line_items
    ↓ fire-and-forget hook: createWmsExports()
wms_return_exports (status: queued)
    ↓ MindCloud polls GET /api/integrations/wms/returns
MindCloud receives export records
    ↓ MindCloud syncs to Datex
    ↓ POST /api/integrations/wms/returns/acknowledge
wms_return_exports (status: acknowledged)
    ↓ acknowledged records never appear in queued pulls again
```

## One-to-One Traceability

```
ReturnHub return_line_item.id → wms_return_exports.id → MindCloud pull → Datex inventory update
```

Each export_id maps back to exactly one ReturnHub database record.

## API Endpoints

### Pull: GET /api/integrations/wms/returns

**Auth:** `Authorization: Bearer {token}` — token must have `wms:read` scope.

**Query params:** `?after_id=0&limit=100` (cursor-based, max 500)

**Response:**
```json
{
  "success": true,
  "next_after_id": 1052,
  "count": 4,
  "exports": [
    {"export_id": 1049, "idempotency_key": "returnhub:good-inventory-export:1049:v1", "owner_project": "Paragonfitwear", "sku": "NFR-DUALFITBRA-SUN-2XL", "quantity": 1},
    {"export_id": 1050, "idempotency_key": "returnhub:good-inventory-export:1050:v1", "owner_project": "Paragonfitwear", "sku": "NFR-DUALFITBRA-SUN-2XL", "quantity": 1},
    {"export_id": 1051, "idempotency_key": "returnhub:good-inventory-export:1051:v1", "owner_project": "Paragonfitwear", "sku": "NYS-CLSCFLAREBB34-LMND-M", "quantity": 1},
    {"export_id": 1052, "idempotency_key": "returnhub:good-inventory-export:1052:v1", "owner_project": "Paragonfitwear", "sku": "NFR-DUALFITBRA-SUN-2XL", "quantity": 1}
  ]
}
```

Note: SKU "NFR-DUALFITBRA-SUN-2XL" appears 3 times. This is correct — each is a separate Good inventory event.

### Acknowledge: POST /api/integrations/wms/returns/acknowledge

**Auth:** `Authorization: Bearer {token}` — token must have `wms:acknowledge` scope.

**Body:** `{"export_ids": [1049, 1050, 1051, 1052], "external_reference": "datex_batch_456"}`

**Response:** `{"success": true, "acknowledged": 4, "requested": 4}`

## Token Authentication

Tokens stored in `integration_tokens` table. Each token is scoped to a merchant and has specific permissions (wms:read, wms:acknowledge).

Generate via POST /api/db/integration-tokens or directly in the database.

## Export Record Lifecycle

1. **queued** — created when worker processes a Good return
2. **acknowledged** — MindCloud confirmed Datex received it
3. Once acknowledged, never returned in queued pulls

## Failed Export Handling

- Export creation is fire-and-forget — if it fails, the return still saves successfully
- Failed exports logged to console but do not block warehouse operations
- Idempotency key prevents duplicate exports if the same return is somehow processed twice

## What Data Is NOT Sent

- Customer name
- Customer email/address
- Order number
- Tracking number
- Return reason
- Worker information
- Billing amounts
