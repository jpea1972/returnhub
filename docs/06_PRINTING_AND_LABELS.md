# Printing and Labels

## Print System Overview

Primary: Browser → Server generates ZPL → QZ Tray websocket → Local Zebra printer on port 9100.
Fallback: BarTender print server at 192.168.120.13:3001 (transition only).

## Enterprise Printers (Database-Backed)

Printers are stored in the `printers` table and shared across all workstations. Workers never add printers. Admins configure once via ReturnHub UI.

Routes: GET/POST/PUT/DELETE /api/db/printers, PUT /api/db/printers/:id/default

The default printer's `size` field determines which stock profile is used when the print request doesn't specify one.

## Current Printers

| Name | IP | Port | Size | Location |
|------|----|------|------|----------|
| Station A — Zebra ZD420 | 192.168.120.52 | 9100 | 3x2 | Returns Station A |
| Station B — Zebra ZD621 | 192.168.120.60 | 9100 | 3x2 | Returns Station B |
| ZD621 16 | 192.168.120.96 | 9100 | 2x1 | Test |

## Label Profiles (v2 — Build Pack Spec)

Labels are SKU-only: barcode (Code 128 mode A) + centered human-readable text. No product descriptions. No hardcoded ^MD or ^PR.

### 2×1 Profile Family (300 DPI, ^PW600 ^LL300)

Three sub-profiles auto-selected by SKU length at print time:

| Profile | Barcode Height | Font Ladder | Max Lines | Triggers |
|---------|---------------|-------------|-----------|----------|
| Standard | 145 | [24, 22, 20] | 1 | SKU fits at font 20 (up to ~48 chars) |
| Long-SKU | 130 | [20, 18] | 1 | 49+ chars |
| Extra-Long | 120 | [18, 16] | 2 | Too long for single line. Delimiter-aware wrap |

All 2×1 profiles: module 1, ratio 3, mode A. Barcode always contains full SKU — only visible text truncates.

### 3×2 Profile (300 DPI, ^PW900 ^LL600)

Module 2, height 250, font ladder [42, 38, 34]. Single line.

### Other Profiles

4×2, 4×3, 4×6 at both 300 and 203 DPI. See STOCK_PROFILES in server.js.

## ZPL Generation Rules

1. Generated server-side at print time via `generateZPL()` in server.js
2. Never pre-saved per SKU, never trusted to browser
3. Code 128 with mode A (automatic subset optimization)
4. Separate centered text field via ^FB, not barcode interpretation line
5. No ^MD darkness override — printer calibration handles this
6. No ^PR speed override — use printer default
7. SKU sanitized: only A-Za-z0-9 - _ . / allowed, max 40 chars
8. Stock never auto-switches from 2×1 to 3×2 based on SKU length

## Delimiter-Aware Wrapping (Extra-Long Only)

For 2-line text on extra-long SKUs, splits at nearest delimiter to midpoint:
Priority: `-`, `_`, `/`. Hard-wrap only as last resort.

## QZ Tray

- Websocket: wss://localhost:8181 (QZ Tray default)
- Security: server provides certificate via GET /api/qz/certificate, signs requests via POST /api/qz/sign
- Print job audit: every attempt logged in print_jobs table

## Print Job Flow

1. Worker clicks Print on a line item
2. Browser calls POST /api/labels/print-job with SKU, description, stock, dpi
3. Server looks up default printer settings if stock/dpi not specified
4. Server generates ZPL via generateZPL()
5. Server inserts print_jobs record (status: queued)
6. Browser receives ZPL, sends to QZ Tray
7. Browser updates print job status (success/failed)
8. On success: returns.label_printed = true

## Troubleshooting

| Problem | Check |
|---------|-------|
| Nothing prints | Is QZ Tray running? Check browser console for "[QZ] Connected" |
| QZ connected but print fails | Check printer IP reachable: `nc -zv {ip} 9100` |
| Barcode cut off | Check stock profile matches physical label size |
| Text too small | SKU may be triggering long-SKU sub-profile — this is by design |
| Labels too dark/light | Adjust printer darkness in Zebra settings, not ZPL |
| BarTender fallback fails | SSL cert issue — expected during transition away from BarTender |
