# Database Schema

PostgreSQL on Railway (project: gracious-charisma). 17 tables.

## Table: merchants

**Purpose:** Client accounts with credentials, platform, rates, sync config.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | VARCHAR NOT NULL | Display name |
| slug | VARCHAR NOT NULL UNIQUE | URL-safe identifier |
| platform | VARCHAR NOT NULL | `return_rabbit`, `loop`, `aftership` |
| api_key | TEXT | Platform API token for pull-based sync |
| api_url | VARCHAR | Platform API base URL |
| shopify_domain | VARCHAR | |
| contact_email | VARCHAR | |
| billing_email | VARCHAR | Invoice recipient |
| good_rate | NUMERIC DEFAULT 4.00 | Per-unit rate for Good condition |
| damaged_rate | NUMERIC DEFAULT 4.00 | Per-unit rate for Damaged condition |
| sync_enabled | BOOLEAN DEFAULT TRUE | Include in daily scheduler |
| sync_interval_hours | INTEGER DEFAULT 24 | Planned custom frequency |
| active | BOOLEAN DEFAULT TRUE | Soft disable |
| settings | JSONB DEFAULT '{}' | Platform-specific: webhook_secret, wms_owner_project |

**Current records:** Paragonfitwear (id=1), WillDrop (id=2)

## Table: workers

**Purpose:** Staff credentials, roles, login history.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| initials | VARCHAR UNIQUE | Login identifier |
| full_name | VARCHAR NOT NULL | |
| pin_hash | TEXT NOT NULL | Currently plain text 4-digit PIN |
| role | VARCHAR DEFAULT 'Worker' | Worker or Admin |
| active | BOOLEAN DEFAULT TRUE | |
| billing | BOOLEAN DEFAULT FALSE | |

## Table: sessions

**Purpose:** One record per worker login. Tracks station, timing, return count.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| worker_id | INTEGER FK → workers | |
| station | VARCHAR | Station name |
| login_at | TIMESTAMP | |
| logout_at | TIMESTAMP | |
| total_returns | INTEGER DEFAULT 0 | Incremented on each return save |

## Table: returns

**Purpose:** Every worker-processed return. **This is the billing source of truth.** Only contains returns that a worker has scanned and assessed.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| order_number | VARCHAR | |
| tracking_number | TEXT | |
| carrier | VARCHAR | USPS, UPS, FedEx |
| customer_name | VARCHAR | |
| customer_zip | VARCHAR | |
| sku_fingerprint | TEXT | Sorted SKUs joined by `\|` |
| condition | VARCHAR | Good, Damaged, Not Returned, Partial, Wrong Product |
| billing_rate | NUMERIC | Rate at time of processing |
| billed_amount | NUMERIC | billing_rate × units |
| worker_id | INTEGER FK → workers | |
| session_id | INTEGER FK → sessions | |
| station | VARCHAR | |
| received_at | TIMESTAMP DEFAULT NOW() | When worker processed it |
| merchant_id | INTEGER FK → merchants | |
| is_duplicate_override | BOOLEAN DEFAULT FALSE | |
| is_manual | BOOLEAN DEFAULT FALSE | |

**Unique index:** `idx_duplicate_check` on (tracking_number, order_number, customer_name, sku_fingerprint) WHERE is_duplicate_override = FALSE

## Table: return_line_items

**Purpose:** Individual SKU line items within a return.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| return_id | INTEGER FK → returns | |
| sku | VARCHAR | |
| product_name | TEXT | |
| quantity | INTEGER DEFAULT 1 | |

## Table: return_line_flags

**Purpose:** Discrepancy flags for items with issues.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| return_id | INTEGER FK → returns | |
| order_number | VARCHAR | |
| condition | VARCHAR | Damaged, Partial, Not Returned, Wrong Product, Good |
| expected_qty | INTEGER | |
| received_qty | INTEGER | |
| damage_checks | TEXT | |
| damage_notes | TEXT | |
| disposition | VARCHAR | Restock, Hold, Damage Out, Quarantine |
| worker_id | INTEGER FK → workers | |

## Table: rr_cache

**Purpose:** PERMANENT server-side store of RMA data from all platforms. This is the pending returns queue. Never deleted.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| order_number | VARCHAR UNIQUE | |
| tracking_number | TEXT | |
| customer_name | VARCHAR | |
| line_items | JSONB | Raw line items from platform |
| sku_fingerprint | TEXT | |
| carrier | VARCHAR | |
| rr_created_at | TIMESTAMP | When RMA was created on platform |
| synced_at | TIMESTAMP | When we pulled/received it |
| rr_name | VARCHAR | RMA reference name |
| rr_id | VARCHAR | Platform ID |
| merchant_id | INTEGER FK → merchants | |

## Table: scan_events

**Purpose:** Audit log of every barcode scan.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| session_id | INTEGER FK → sessions | |
| worker_id | INTEGER FK → workers | |
| scanned_value | TEXT | Raw barcode value |
| resolved_tracking | TEXT | Cleaned tracking number |
| lookup_result | VARCHAR | found_cache, found_live, not_found, duplicate |
| matched_order | VARCHAR | |

## Table: sync_checkpoints

**Purpose:** Tracks sync state per merchant.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| source | VARCHAR DEFAULT 'return_rabbit' | Platform name |
| last_synced_at | TIMESTAMP | Newest record timestamp |
| pages_fetched | INTEGER | |
| records_added | INTEGER | |
| status | VARCHAR | success, failed |
| error_message | TEXT | |
| merchant_id | INTEGER FK → merchants | |

## Table: client_rates

**Purpose:** Legacy billing rates. Superseded by merchants.good_rate/damaged_rate but kept for backward compatibility.

## Table: billing_periods

**Purpose:** Invoice periods with revenue totals. Ready for use, currently 0 records.

## Table: billing_line_items

**Purpose:** Links returns to billing periods. Ready for use, currently 0 records.

## Table: workstation_printer_preferences

**Purpose:** QZ Tray saved printer per workstation per station. Keyed by (workstation_key, station).

## Table: print_jobs

**Purpose:** Audit log of every print attempt. Status: queued, printing, success, failed, fallback.

## Table: printers

**Purpose:** Enterprise-wide printer registry. Shared across all workstations, database-backed.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | VARCHAR NOT NULL | Display name |
| ip | VARCHAR NOT NULL | Network IP |
| port | VARCHAR DEFAULT '9100' | Raw TCP port |
| brand | VARCHAR DEFAULT 'Zebra' | |
| lang | VARCHAR DEFAULT 'ZPL' | |
| size | VARCHAR DEFAULT '2x1' | Label stock size |
| dpi | INTEGER DEFAULT 300 | |
| location | VARCHAR | Station/area name |
| is_default | BOOLEAN DEFAULT FALSE | Only one should be true |
| active | BOOLEAN DEFAULT TRUE | |

## Table: integration_tokens

**Purpose:** API auth tokens for integration partners (MindCloud, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | VARCHAR NOT NULL | Human label |
| token | VARCHAR NOT NULL UNIQUE | Bearer token value |
| partner | VARCHAR NOT NULL | e.g. 'mindcloud' |
| merchant_id | INTEGER FK → merchants | Scopes token to merchant |
| scopes | VARCHAR DEFAULT 'wms:read' | Comma-separated: wms:read, wms:acknowledge |
| active | BOOLEAN DEFAULT TRUE | |
| last_used_at | TIMESTAMP | Updated on each use |

## Table: wms_return_exports

**Purpose:** One record per Good return line item. Never aggregated by SKU. MindCloud pulls these and acknowledges after syncing to Datex.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | This is the export_id |
| return_id | INTEGER FK → returns | |
| return_line_item_id | INTEGER FK → return_line_items | |
| sku | VARCHAR NOT NULL | |
| quantity | INTEGER DEFAULT 1 | Always per-line-item, never aggregated |
| owner_project | VARCHAR NOT NULL | Fixed value from merchant settings |
| condition | VARCHAR DEFAULT 'Good' | |
| status | VARCHAR DEFAULT 'queued' | queued → acknowledged |
| idempotency_key | VARCHAR UNIQUE | Format: `returnhub:good-inventory-export:{line_item_id}:v1` |
| source_created_at | TIMESTAMP | When the return was processed |
| acknowledged_at | TIMESTAMP | When MindCloud confirmed Datex sync |
| external_reference | VARCHAR | Optional Datex batch reference |
| merchant_id | INTEGER FK → merchants | |

**Critical rule:** Same SKU can appear many times. Deduplication is by return_line_item_id, not by SKU.

## Migration History

| Date | Migration | Tables Affected |
|------|-----------|----------------|
| Pre-2026 | Initial schema | workers, sessions, returns, return_line_items, return_line_flags, rr_cache, scan_events, sync_checkpoints, client_rates, billing_periods, billing_line_items |
| 2026-04-22 | QZ Tray print system | + workstation_printer_preferences, + print_jobs |
| 2026-04-22 | Multi-merchant foundation | + merchants, + merchant_id on 6 tables, backfill to id=1 |
| 2026-04-22 | Enterprise printers | + printers |
| 2026-05-06 | WMS export integration | + integration_tokens, + wms_return_exports |
