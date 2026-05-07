# System Overview

## Business Purpose

ReturnHub is a warehouse returns management platform built for SKU Distribution's Foreign Trade Zone (FTZ) operations. It manages the complete lifecycle of e-commerce customer returns: receiving, scanning, condition assessment, SKU labeling, billing, reporting, and WMS integration.

## Who Uses It

- **Warehouse workers** — scan packages, assess condition, print labels, process returns
- **Warehouse supervisors** — monitor productivity, review discrepancies, manage stations
- **Operations/Admin** — billing reports, merchant management, printer configuration, integration setup
- **Integration partners** — MindCloud/Datex pull Good inventory data via API

## Warehouse Workflow

1. Returns arrive at the warehouse from e-commerce customers
2. Worker logs in with initials + 4-digit PIN, selects their station
3. Worker scans the return shipping label barcode
4. ReturnHub looks up the return in cached RMA data
5. Worker inspects each item: Good, Damaged, Partial, Not Returned, Wrong Product
6. Worker prints a SKU barcode label for each Good item
7. Return is saved with condition, billing rate, and worker attribution
8. Good returns are exported to WMS (Datex) via MindCloud integration
9. Weekly billing reports are generated per merchant

## Current Clients

| ID | Name | Platform | Status |
|----|------|----------|--------|
| 1 | Paragonfitwear | Return Rabbit | Active — pull sync |
| 2 | WillDrop | AfterShip Returns | Active — webhook push |

## Major Capabilities

- Real-time barcode scanning with cache + live Return Rabbit lookup
- Item-by-item condition assessment with flags for discrepancies
- Per-unit billing by condition (Good rate / Damaged rate) per merchant
- SKU label printing via QZ Tray (browser → local Zebra printer)
- Worker productivity tracking with leaderboard
- Multi-merchant data isolation with merchant switcher
- Platform adapters: Return Rabbit, Loop, AfterShip
- WMS export: Good returns → MindCloud → Datex (pull API with Bearer token)
- Weekly invoice generation with CSV export

## What ReturnHub Is Not

- Not an RMA platform (it receives data from Return Rabbit, Loop, AfterShip)
- Not a Shopify app (it connects to Shopify indirectly via RMA platforms)
- Not a shipping/logistics system
- Not a customer-facing returns portal

## Current Limitations

- PIN-based auth only (4-digit, stored as plain text in database)
- No role-based access control beyond Worker/Admin
- Single-server deployment (no horizontal scaling)
- Daily sync at fixed 6:00 AM UTC (not configurable per merchant yet)
- No built-in backup export (relies on Railway automatic backups)
- CORS defaults to allow all origins
