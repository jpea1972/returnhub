# Billing and Reporting

## Billing Model

Per-unit billing by condition. Rates are per merchant.

| Condition | Rate Source | Billable |
|-----------|-----------|----------|
| Good | merchants.good_rate | Yes |
| Damaged | merchants.damaged_rate | Yes |
| Not Returned | $0.00 | No |
| Partial | $0.00 | No |
| Wrong Product | $0.00 | No |

## Billing Calculation

At return processing time:
- `billing_rate` = merchant's good_rate (for Good) or damaged_rate (for Damaged), or 0
- `billed_amount` = billing_rate × total line item quantity

**Only worker-processed returns appear in billing.** The returns table is the single source of truth. rr_cache records do not affect billing.

## Current Rates

| Merchant | Good Rate | Damaged Rate |
|----------|-----------|-------------|
| Paragonfitwear | $4.00 | $4.00 |
| WillDrop | $4.00 | $4.00 |

Rates updated via PUT /api/db/rates with merchant_id, or through the merchant settings UI.

## Billing Reports

### Weekly Billing (GET /api/db/reports/billing)
Returns totals for a date range: total_good, total_damaged, total_not_returned, good_revenue, damaged_revenue, total_revenue, total_units.

### Invoice History
Frontend renders 12 weeks of billing history with per-week totals. Each week has CSV export.

### CSV Export
Downloads invoice CSV with: Order, Customer, SKU(s), Condition, Units, Rate, Subtotal, Worker, Date. Filename includes merchant name.

## Productivity Reports

### Worker Summary (GET /api/db/reports/productivity-summary)
Leaderboard: units, returns, revenue, good/damaged/not-returned counts, hours active, UPH.

### Worker Hourly (GET /api/db/reports/productivity)
Hourly breakdown per worker.

### Live Leaderboard
Today's top 5 workers displayed on scan screen.

## Other Reports

### RR Stats (GET /api/db/rr-stats)
Dashboard cards: open RMAs, in transit, arrived today, completed.

### Days Held (GET /api/db/days-held)
Aging report for pending returns: green (≤30d), amber (31-60d), red (>60d).

## Known Limitations

- billing_periods and billing_line_items tables exist but are not yet populated programmatically
- No automated invoice generation — CSV export is manual
- billing_auto_generate and billing_auto_email toggles are UI-only (localStorage), not server-side
