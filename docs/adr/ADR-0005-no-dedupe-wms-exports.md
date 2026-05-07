# ADR-0005: Do Not Deduplicate WMS Exports by SKU

**Status:** Accepted
**Date:** 2026-05-06

## Context

When exporting Good returns to Datex WMS via MindCloud, the same SKU frequently appears multiple times (e.g., 10 returns of the same product in one day). The question: should we aggregate these into one line (SKU ABC, qty 10) or keep them as separate records?

## Decision

Do not aggregate. Each unique return_line_item creates one wms_return_exports record. If the same SKU appears 10 times, MindCloud sees 10 separate export records, each with quantity 1.

## Consequences

- Clean 1:1 traceability: ReturnHub line item → export record → MindCloud pull → Datex update
- Each export_id maps back to exactly one database record
- Auditability is preserved — every inventory event can be traced to a specific return
- MindCloud/Datex receives more records but each is individually verifiable
- Duplicate prevention is by export_id (return_line_item_id), not by SKU

## Correct Behavior

```
Export ID 1049 | SKU ABC | qty 1 | Good
Export ID 1050 | SKU ABC | qty 1 | Good
Export ID 1051 | SKU ABC | qty 1 | Good
```

## Incorrect Behavior (Rejected)

```
SKU ABC | qty 3
```

This loses traceability.

## Alternatives Considered

- **Aggregate by SKU per day**: Simpler for Datex but loses audit trail. Rejected.
- **Aggregate by SKU per batch**: Same problem. Rejected.
- **Let MindCloud aggregate**: Possible, but ReturnHub should provide granular data and let the consumer decide.
