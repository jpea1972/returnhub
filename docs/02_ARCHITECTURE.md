# Architecture

## Frontend

Single HTML file (`public/index.html`) with 20+ JavaScript modules loaded via `<script>` tags. No build step, no bundler, no framework. Each `.js` file in `public/js/` is a self-contained module sharing global state variables defined in the HTML shell.

Key global state: `activeMerchantId`, `activeMerchant`, `dbMerchants`, `CLIENT_RATES`, `RETURNS`, `RETURNS_INDEX`, `curR`, `itemStates`, `printers`, `dbWorkerId`, `dbSessionId`.

All API calls include `activeMerchantId` for merchant scoping.

### Frontend Modules

| Module | Purpose |
|--------|---------|
| auth.js | Login, PIN verification, session management |
| sync.js | RR cache loading, sync triggering |
| scan.js | Barcode scanning, lookup, duplicate check |
| process.js | Return finalization, condition setting, DB save |
| checklist.js | Item validation UI, condition checkboxes |
| queue.js | Return queue rendering |
| billing.js | Rates, billing cards, invoice history |
| reports.js | Productivity, days held, scan stats, leaderboard |
| flags.js | Discrepancy/returns report with search and date filtering |
| email.js | Report email management |
| merchants.js | Merchant CRUD, switcher, rates sync |
| printers.js | Enterprise printer management (DB-backed) |
| qz-print.js | QZ Tray connection, print job dispatch |
| config.js | Global state initialization |
| ui.js | Tab navigation, UI utilities |
| manual.js | Manual return entry |
| users.js | Worker management |
| photo.js | Product photo loading |
| print.js | Print modal logic |

## Backend

Node.js/Express server (`server.js`, ~2,500 lines). Hosted on Railway. Single file — no separate route files or middleware modules.

### Key Sections in server.js

1. Database pool + Express setup
2. Worker/session routes
3. Return processing routes (save, duplicate check, search)
4. RR cache and sync routes
5. Billing/productivity/stats routes
6. Merchant CRUD routes
7. ZPL label engine (stock profiles, text fitting, barcode generation)
8. QZ Tray security routes (certificate, signing)
9. Printer preference routes
10. Enterprise printer CRUD routes
11. Print job routes (create, status update, preview)
12. Platform adapters (syncReturnRabbit, syncLoop, syncMerchant router)
13. AfterShip webhook endpoint
14. Daily sync scheduler (scheduleDailySync)
15. WMS export system (createWmsExports, pull API, acknowledge, token auth)
16. Catch-all route (serves index.html)

## Database

PostgreSQL on Railway. 17 tables. All return-related tables include `merchant_id` for multi-tenant data isolation.

### Data Flow

```
RMA Platform (RR/Loop/AfterShip)
        ↓ sync/webhook
    rr_cache (permanent pending queue)
        ↓ worker scans & processes
    returns + return_line_items (billing source of truth)
        ↓ if condition = Good
    wms_return_exports (MindCloud pulls)
        ↓ MindCloud acknowledges
    status = acknowledged
```

## Platform Adapter Pattern

Each RMA platform has a dedicated adapter function. All adapters save to `rr_cache` only. Workers process returns into the `returns` table.

| Platform | Sync Model | Adapter |
|----------|-----------|---------|
| Return Rabbit | Pull (scheduled + on-demand) | `syncReturnRabbit(merchant)` |
| Loop Returns | Pull (scheduled + on-demand) | `syncLoop(merchant)` |
| AfterShip Returns | Push (webhook) | `POST /api/webhooks/aftership/:merchantId` |

The router `syncMerchant(merchant)` reads `merchant.platform` and calls the right adapter. Adding a new platform = one new function + one case in the switch.

## Do Not Casually Change

- Station workflow (login → select station → scan → process)
- Duplicate check logic (4-field match: tracking, order, customer, SKU fingerprint)
- Return processing flow (POST /api/db/returns → line items → session update)
- Billing logic (only worker-processed returns with billing_rate > 0)
- Print fallback path (QZ Tray primary → BarTender fallback)
- rr_cache as permanent storage (not a throwaway cache)
- WMS export one-to-one traceability (never aggregate by SKU)
