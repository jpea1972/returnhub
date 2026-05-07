# Changelog

## 2026-05-06 — WMS Good Returns Export + Label v2 + Printers

**Summary:** MindCloud/Datex WMS integration, label engine rewrite, enterprise printers, bug fixes.

**Files changed:** server.js, public/js/printers.js, public/js/flags.js, public/js/checklist.js, public/js/sync.js, public/js/auth.js, public/js/config.js, public/index.html

**Database migrations:**
- CREATE TABLE integration_tokens
- CREATE TABLE wms_return_exports
- CREATE TABLE printers (done 2026-04-22)
- Indexes on all new tables

**Routes added:**
- GET/POST /api/integrations/wms/returns (pull + acknowledge)
- GET/POST /api/db/integration-tokens
- GET /api/db/wms-export-stats
- GET/POST/PUT/DELETE /api/db/printers
- PUT /api/db/printers/:id/default

**Behavior changes:**
- POST /api/db/returns now creates wms_return_exports for Good returns (fire-and-forget)
- Label ZPL engine rewritten per build pack v2 spec
- Printers loaded from database instead of localStorage
- Flags search is now server-side (q= param)

**Tests performed:** Valid/invalid token auth, empty export pull, printer CRUD, label printing on 2x1 and 3x2

**Known issues:** None blocking.

---

## 2026-04-22 — Multi-Merchant + Platform Adapters + QZ Print

**Summary:** Multi-merchant architecture, platform adapters, AfterShip webhook, QZ Tray print system.

**Files changed:** server.js, all frontend JS modules, public/index.html, schema.sql

**Database migrations:**
- CREATE TABLE merchants
- ADD COLUMN merchant_id on returns, rr_cache, sync_checkpoints, client_rates, billing_periods, print_jobs
- Backfill merchant_id = 1 for all existing data
- CREATE TABLE workstation_printer_preferences
- CREATE TABLE print_jobs
- INSERT merchants: Paragonfitwear (id=1), WillDrop (id=2)

**Routes added:**
- All merchant CRUD routes
- POST /api/webhooks/aftership/:merchantId
- GET/POST sync trigger per merchant
- GET/PUT /api/db/printer-preferences
- POST /api/labels/print-job
- PUT /api/db/print-jobs/:id/status
- POST /api/labels/preview
- GET /api/print/config
- GET /api/qz/certificate
- POST /api/qz/sign

**Behavior changes:**
- All data routes accept merchant_id parameter
- All frontend modules send activeMerchantId
- Sync scheduler loops through all merchants
- Platform adapter pattern: syncReturnRabbit, syncLoop, syncMerchant router
- AfterShip webhook with HMAC verification

---

## Pre-2026-04-22 — Original Build

Initial ReturnHub with Return Rabbit integration, single-tenant, BarTender printing. 11 database tables.
