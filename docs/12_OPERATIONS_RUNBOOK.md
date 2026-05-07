# Operations Runbook

## App Is Down

**Symptom:** Browser shows error or blank page.
**Check:** `curl https://returnhub-production.up.railway.app/api/health`
**If no response:** Railway service may be crashed. Check Railway dashboard → Deployments → View Logs.
**Fix:** If last deploy broke it, rollback: `git revert HEAD --no-edit && git push origin main`

## Return Rabbit Lookup Fails

**Symptom:** "RR Offline" in header, scans show "Not in cache."
**Check:** `curl https://returnhub-production.up.railway.app/api/health` — is rrConfigured true?
**Likely cause:** RR_TOKEN expired or RR API is down.
**Fix:** Verify token in Railway env vars. Test manually: Admin → RR Integration → Test Connection.

## Scanning Does Not Find a Return

**Symptom:** "Not Found" after scanning.
**Check:** Is the return in rr_cache? Query in TablePlus: `SELECT * FROM rr_cache WHERE tracking_number LIKE '%{last-digits}%'`
**Likely cause:** Return hasn't been synced yet, or wrong merchant selected.
**Fix:** Run Sync Now from admin panel, or verify merchant switcher.

## Duplicate Warning Appears

**Symptom:** "Already Processed" warning on scan.
**Check:** Normal behavior if return was already processed.
**Action:** Worker can override if this is a legitimate re-process, or cancel.

## Printer Does Not Print

**Symptom:** Click Print, nothing happens.
**Check browser console (Cmd+Option+J):**
- "[QZ] Connected" → QZ Tray is running
- "Printer is not accepting job" → wrong printer selected
- No QZ messages → QZ Tray not installed or not running
**Check printer reachable:** `nc -zv {printer-ip} 9100`
**Check default printer:** Is the right printer set as default in ReturnHub Printers section?

## Labels Look Bad

**Symptom:** Barcode cut off, text too small, layout wrong.
**Check:** Does the printer's configured label size match the physical labels loaded?
**Fix:** Update printer size in ReturnHub → Printers, or in TablePlus: `UPDATE printers SET size='2x1' WHERE id=X`
**If too dark/light:** Adjust printer darkness in Zebra settings (not in ZPL).

## MindCloud Export Fails

**Symptom:** MindCloud reports no data or auth errors.
**Check token:** `curl -H "Authorization: Bearer {token}" https://returnhub-production.up.railway.app/api/integrations/wms/returns`
**Check stats:** `curl https://returnhub-production.up.railway.app/api/db/wms-export-stats`
**If 401:** Token may be deactivated. Check integration_tokens table.
**If empty results:** No Good returns processed since deploy, or all already acknowledged.

## Datex Acknowledgement Missing

**Symptom:** export stats show queued > 0 but MindCloud says they pulled.
**Check:** MindCloud may not be calling the acknowledge endpoint.
**Fix:** MindCloud needs to POST /api/integrations/wms/returns/acknowledge with the export_ids.

## Billing Report Issue

**Symptom:** Numbers don't match expectations.
**Check:** Correct date range? Correct merchant selected?
**Verify in DB:** `SELECT COUNT(*), SUM(billed_amount) FROM returns WHERE received_at >= '2026-04-15' AND merchant_id = 1`
**Remember:** Only worker-processed returns appear in billing. rr_cache does not affect billing.

## Worker Cannot Log In

**Symptom:** PIN rejected or worker not in list.
**Check:** `SELECT initials, active, pin_hash FROM workers WHERE initials = '{initials}'`
**Fix:** If active=false, update to true. If PIN wrong, update pin_hash.
