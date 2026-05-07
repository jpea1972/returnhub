# Handoff Notes

Last updated: 2026-05-06

## What Was Built

ReturnHub is a production multi-merchant returns management platform running on Railway. It handles the complete return lifecycle: RMA sync from multiple platforms, barcode scanning, condition assessment, SKU labeling, billing, and WMS export.

## Current State

- **2 active merchants:** Paragonfitwear (Return Rabbit), WillDrop (AfterShip)
- **3 platform adapters:** Return Rabbit (pull), Loop (pull, no active client), AfterShip (webhook push)
- **~1,500 processed returns** in the returns table for Paragonfitwear
- **~9,000 cached returns** in rr_cache
- **WMS integration live:** MindCloud can pull Good returns via Bearer token API
- **Enterprise printers:** 3 printers in database, shared across workstations
- **Label engine v2:** Three 2x1 sub-profiles, Code 128 mode A, no hardcoded darkness

## Where the Code Lives

- **Repo:** github.com/jpea1972/returnhub
- **Local:** /Users/jamespeacock/Desktop/returnhub
- **Backend:** server.js (~2,500 lines)
- **Frontend:** public/index.html + public/js/*.js (20+ modules)
- **Schema:** schema.sql (17 tables)
- **Docs:** /docs/ folder in repo

## Database

Railway PostgreSQL (gracious-charisma). 17 tables. All return data tables have merchant_id.

## How to Test

See [13_TESTING_CHECKLIST.md](13_TESTING_CHECKLIST.md).

Quick smoke test:
```bash
curl https://returnhub-production.up.railway.app/api/health
curl https://returnhub-production.up.railway.app/api/db/merchants
```

## How to Troubleshoot

See [12_OPERATIONS_RUNBOOK.md](12_OPERATIONS_RUNBOOK.md).

## What Still Needs Attention

1. **MindCloud integration testing** — endpoint is live but needs real-world validation with MindCloud team
2. **Loop adapter** — built but untested against real Loop API data
3. **AfterShip field mapping** — may need tuning when real (non-test) returns arrive
4. **PIN security** — plain text, should be hashed before adding more merchants
5. **CORS** — still defaults to * 
6. **Printer darkness tuning** — may need per-printer calibration on warehouse floor

## For the Next Developer/AI

Upload these files at the start of your session:
- `ReturnHub_Technical_Reference_v5.1.docx`
- `schema.sql`
- `sku-pack-v2.md` (label build pack)

Or reference the /docs/ folder in the repo — it contains everything.

## Key Design Decisions

- All platforms save to rr_cache ONLY — workers process into returns table
- returns table is the ONLY billing source of truth
- WMS exports are one-to-one per return line item, never aggregated by SKU
- Printers are database-backed and shared enterprise-wide
- Label profiles are fixed per stock size — no dynamic auto-centering or auto-sizing
