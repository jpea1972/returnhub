# ADR-0004: Use MindCloud Pull Model for Datex WMS

**Status:** Accepted
**Date:** 2026-05-06

## Context

ReturnHub needs to send Good-condition return inventory data to Datex WMS. MindCloud is the middleware connecting ReturnHub to Datex. Two models were considered: push (ReturnHub POSTs to MindCloud) or pull (MindCloud polls ReturnHub's API).

## Decision

Use the pull model. ReturnHub exposes a REST API with Bearer token authentication. MindCloud polls on their schedule, acknowledges after syncing to Datex.

## Consequences

- MindCloud controls polling frequency and retry logic
- If MindCloud is down, no data is lost — they pull when back
- ReturnHub doesn't need to know MindCloud's internal endpoints
- MindCloud can re-pull historical data if needed
- ReturnHub needs to maintain a token auth system (integration_tokens table)
- Export records sit in queued state until acknowledged

## Alternatives Considered

- **Push model (ReturnHub → MindCloud webhook)**: Requires ReturnHub to know MindCloud's URL, handle retries, manage webhook failures. More complex server-side.
- **Shared database**: Security risk, tight coupling
- **File export (CSV/SFTP)**: Too slow, no real-time
