# ADR-0003: Keep BarTender Fallback During QZ Tray Rollout

**Status:** Accepted
**Date:** 2026-04-22

## Context

ReturnHub originally used a BarTender print server at 192.168.120.13:3001. QZ Tray was added as the primary print path (browser → websocket → local printer). Both paths coexist.

## Decision

Keep BarTender as a fallback during the transition to QZ Tray. Print mode is configurable via PRINT_MODE env var (hybrid/qz/bartender).

## Consequences

- Workers can still print if QZ Tray is not installed on their workstation
- Two print codepaths to maintain
- BarTender server must stay running during transition
- SSL cert issue with BarTender (ERR_CERT_AUTHORITY_INVALID) is known and expected

## Alternatives Considered

- **QZ only, no fallback**: Too risky during rollout — if QZ fails, production stops
- **BarTender only**: QZ is the better long-term solution (no central server needed)
