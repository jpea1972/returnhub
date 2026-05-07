# Return Processing Flow

## Normal Flow

1. **Login:** Worker enters initials + 4-digit PIN → POST /api/db/workers/verify → session created
2. **Station:** Worker selects station from dropdown
3. **Merchant:** Worker selects active merchant from merchant switcher (defaults to last used)
4. **Cache load:** Browser calls GET /api/db/cache?merchant_id=X → loads unprocessed returns from rr_cache
5. **Scan:** Worker scans barcode → browser strips USPS prefix → searches RETURNS_INDEX by tracking number
6. **Cache hit:** Found in local cache → proceed to step 8
7. **Cache miss:** Browser searches Return Rabbit API live (up to 5 pages) → if found, adds to local cache
8. **Duplicate check:** POST /api/db/duplicate-check with tracking, order, customer, SKU fingerprint, merchant_id
9. **Duplicate found:** Show warning with original process date/worker. Worker can override or cancel.
10. **Item inspection:** Worker reviews each line item. For each item, sets state: checked (Good), unchecked (Not Returned), partial, damaged, wrong
11. **Confirm:** If any items are not Good, confirm modal shows summary. Worker adds notes.
12. **Process:** POST /api/db/returns saves return with condition, billing rate, billed amount, worker_id, merchant_id
13. **Line items:** Each item inserted into return_line_items
14. **Flags:** Each non-Good item creates a return_line_flags record via POST /api/db/flags
15. **WMS export:** If condition = Good, fire-and-forget hook creates wms_return_exports records
16. **Label print:** Worker clicks Print → POST /api/labels/print-job → server generates ZPL → QZ Tray sends to printer
17. **Queue update:** Return removed from local cache, processed returns list refreshed

## Condition Determination

- All items checked → **Good**
- Any item damaged → **Damaged**
- Any item unchecked or partial → **Not Returned**

## Billing Calculation

- billing_rate = CLIENT_RATES.good for Good/Damaged, 0 for Not Returned
- billed_amount = billing_rate × total item quantity
- Rates come from the active merchant's good_rate/damaged_rate

## Failure Cases

### Scan not found
Browser shows "Not Found" after checking local cache + live RR API (5 pages). Worker can try manual entry.

### Duplicate detected
Warning displayed with original processing details. Worker can override (flagged in records) or cancel.

### Return Rabbit unavailable
Cache still works from last sync. Live lookup fails silently. Worker sees "Not in cache" for new returns.

### Database unavailable
Return save fails. Toast error shown. Worker's work is not lost (still in UI) but not saved.

### Label print failure
QZ Tray failure logged in print_jobs table. BarTender fallback attempted if enabled. Return still saves regardless of print outcome.

### Partial/Damaged/Wrong Product
Each flagged item creates a return_line_flags record with condition, disposition, notes, expected/received quantities.
