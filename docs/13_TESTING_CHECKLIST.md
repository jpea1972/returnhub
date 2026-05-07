# Testing Checklist

Run after major changes. Update this list if a change affects testing.

## Core Workflow

- [ ] Login with valid initials + PIN
- [ ] Login with invalid PIN (should reject)
- [ ] Select station
- [ ] Switch merchant via dropdown
- [ ] Scan a known return (in cache)
- [ ] Scan an unknown barcode (should show Not Found)
- [ ] Scan a previously processed return (should show duplicate warning)
- [ ] Process Good return — verify saves to returns table
- [ ] Process Damaged return — verify flag created
- [ ] Process Partial/Not Returned — verify flag created
- [ ] Process return with multiple line items
- [ ] Label prints via QZ Tray

## Merchant Scoping

- [ ] Switch to Paragonfitwear — data shows only Paragonfitwear returns
- [ ] Switch to WillDrop — data shows only WillDrop returns
- [ ] Billing report scoped to active merchant
- [ ] Productivity report scoped to active merchant
- [ ] Flags/Returns Report scoped to active merchant

## Returns Report / Flags

- [ ] Date range filter: set From/To and click Apply — shows filtered results
- [ ] Click All — clears filter, shows all
- [ ] Search by order number — finds correct flags
- [ ] Search by SKU — finds correct flags
- [ ] Search by customer name — finds correct flags

## Printing

- [ ] Print job generates ZPL on server (check print_jobs table)
- [ ] QZ Tray sends to correct printer
- [ ] Label matches configured stock size (2x1 or 3x2)
- [ ] Long SKU (25+ chars) prints readable on 2x1
- [ ] Printers visible on all workstations without re-adding

## Billing

- [ ] Weekly billing total matches sum of billed_amount in returns table
- [ ] Rates update via settings (PUT /api/db/rates)
- [ ] CSV export downloads with correct data
- [ ] Non-Good returns have $0 billing

## WMS Export

- [ ] Process a Good return → wms_return_exports record created (status: queued)
- [ ] Process a Damaged return → NO wms_return_exports record created
- [ ] Process multiple Good returns with same SKU → separate export records (not aggregated)
- [ ] Pull with valid token: `curl -H "Authorization: Bearer {token}" .../api/integrations/wms/returns`
- [ ] Pull with no token → 401
- [ ] Pull with bad token → 401
- [ ] Acknowledge exports → status changes to acknowledged
- [ ] Acknowledged exports do not appear in subsequent pulls
- [ ] Same Good return processed twice → only one export (idempotency_key prevents duplicate)

## Sync

- [ ] Manual sync for Paragonfitwear: POST /api/db/sync with merchant_id=1
- [ ] AfterShip webhook test payload arrives for WillDrop
- [ ] Sync does not affect existing processed returns
