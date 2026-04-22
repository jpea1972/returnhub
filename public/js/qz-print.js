// ══════════════════════════════════════════════
// QZ-PRINT — QZ Tray integration for local printing
// ══════════════════════════════════════════════

// ── State ─────────────────────────────────────
let qzConnected     = false;
let qzPrintConfig   = null;   // from /api/print/config
let qzLocalPrinters = [];     // discovered via QZ
let qzDefaultPrinter = null;
let workstationKey  = null;

// ── Workstation Key ───────────────────────────
function getWorkstationKey() {
  if (workstationKey) return workstationKey;
  workstationKey = localStorage.getItem('rh_workstation_key');
  if (!workstationKey) {
    workstationKey = 'rh-ws-' + crypto.randomUUID();
    localStorage.setItem('rh_workstation_key', workstationKey);
  }
  return workstationKey;
}

// ── Load Print Config ─────────────────────────
async function loadPrintConfig() {
  try {
    const res = await fetch('/api/print/config');
    const data = await res.json();
    if (data.success) {
      qzPrintConfig = data;
      console.log('[QZ] Print config loaded:', data.printMode);
    }
    return data;
  } catch (e) {
    console.error('[QZ] Config load failed:', e.message);
    return null;
  }
}

// ── QZ Security Bootstrap ─────────────────────
function configureQzSecurity() {
  if (!window.qz) return;

  qz.security.setCertificatePromise(async function () {
    const res = await fetch('/api/qz/certificate', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load QZ certificate');
    return res.text();
  });

  qz.security.setSignaturePromise(async function (toSign) {
    const res = await fetch('/api/qz/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toSign })
    });
    if (!res.ok) throw new Error('Failed to sign QZ request');
    const data = await res.json();
    return data.signature;
  });
}

// ── Connect to QZ ─────────────────────────────
async function connectQz() {
  if (!window.qz) {
    throw new Error('QZ_NOT_LOADED');
  }
  if (qz.websocket.isActive()) {
    qzConnected = true;
    return true;
  }
  try {
    await qz.websocket.connect({ retries: 2, delay: 1 });
    qzConnected = true;
    console.log('[QZ] Connected to QZ Tray');
    return true;
  } catch (e) {
    qzConnected = false;
    throw new Error('QZ_NOT_RUNNING');
  }
}

// ── Discover Local Printers ───────────────────
async function discoverQzPrinters() {
  await connectQz();
  try {
    qzDefaultPrinter = await qz.printers.getDefault();
    const all = await qz.printers.find();
    qzLocalPrinters = Array.isArray(all) ? all : [];
    console.log('[QZ] Default printer:', qzDefaultPrinter);
    console.log('[QZ] Found', qzLocalPrinters.length, 'printers');
    return { defaultPrinter: qzDefaultPrinter, printers: qzLocalPrinters };
  } catch (e) {
    console.error('[QZ] Printer discovery failed:', e.message);
    return { defaultPrinter: null, printers: [] };
  }
}

// ── Load Saved Preference ─────────────────────
async function loadPrinterPreference(station) {
  const wsKey = getWorkstationKey();
  try {
    const res = await fetch(`/api/db/printer-preferences?workstation_key=${encodeURIComponent(wsKey)}&station=${encodeURIComponent(station)}`);
    const data = await res.json();
    return data.preference || data.defaults || null;
  } catch (e) {
    console.error('[QZ] Preference load failed:', e.message);
    return null;
  }
}

// ── Save Preference ───────────────────────────
async function savePrinterPreference(station, printerName, useDefault, dpi, stock, printMethod) {
  const wsKey = getWorkstationKey();
  try {
    const res = await fetch('/api/db/printer-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workstation_key: wsKey,
        station,
        use_default_printer: useDefault,
        printer_name: useDefault ? null : printerName,
        dpi: dpi || 300,
        stock: stock || '3x2',
        print_method: printMethod || 'direct_thermal'
      })
    });
    const data = await res.json();
    if (data.success) toast('✓ Printer preference saved', 's');
    return data;
  } catch (e) {
    toast('Failed to save preference: ' + e.message, 'e');
    return null;
  }
}

// ── Resolve Printer Name ──────────────────────
async function resolveQzPrinter(station) {
  const pref = await loadPrinterPreference(station);
  if (pref && !pref.use_default_printer && pref.printer_name) {
    // Verify the saved printer still exists locally
    if (qzLocalPrinters.includes(pref.printer_name)) {
      return { name: pref.printer_name, source: 'saved', pref };
    }
    // Saved printer not found — fall through to default
    console.warn('[QZ] Saved printer not found:', pref.printer_name);
  }
  // Use OS default
  if (qzDefaultPrinter) {
    return { name: qzDefaultPrinter, source: 'default', pref };
  }
  return { name: null, source: 'none', pref };
}

// ── Send Print via QZ ─────────────────────────
async function sendPrintViaQz(printerName, zpl, copies) {
  await connectQz();
  const config = qz.configs.create(printerName, { copies: copies || 1 });
  await qz.print(config, [zpl]);
}

// ── Send Print via BarTender Fallback ─────────
async function sendPrintViaBarTenderFallback(sku, desc, station, copies) {
  const res = await fetch('https://192.168.120.13:3001/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: 'rh-print-2026-sku',
      sku, desc, station, copies
    })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'BarTender print failed');
  return data;
}

// ── Update Job Status ─────────────────────────
async function finalizePrintJobStatus(jobId, status, printerName, transport, responseData, errorText) {
  try {
    await fetch(`/api/db/print-jobs/${jobId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        printer_name: printerName || null,
        transport: transport || null,
        response_json: responseData || null,
        error_text: errorText || null
      })
    });
  } catch (e) {
    console.error('[QZ] Status update failed:', e.message);
  }
}

// ── Main Print Flow (Hybrid) ──────────────────
async function sendPrintHybrid() {
  if (!curPSku) { toast('No SKU selected', 'e'); return; }

  const btn = document.querySelector('#pmo .btn.bY');
  if (btn) { btn.textContent = 'Printing…'; btn.disabled = true; }

  const copies = parseInt(document.getElementById('pp-copies').value) || 1;
  const stock = document.getElementById('pp-size')?.value || '3x2';
  const printMethodEl = document.getElementById('pp-type');
  const printMethodMap = { 'Direct Thermal': 'direct_thermal', 'Thermal Transfer': 'thermal_transfer', 'Inkjet / Laser': 'other' };
  const printMethod = printMethodMap[printMethodEl?.value] || 'direct_thermal';
  const station = selStation_val || 'A';

  // Determine DPI from preference or default
  const pref = await loadPrinterPreference(station);
  const dpi = pref?.dpi || qzPrintConfig?.defaultDpi || 300;

  let jobId = null;
  let zpl = null;

  try {
    // Step 1: Create print job on server (generates ZPL)
    const jobRes = await fetch('/api/labels/print-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        return_id: curR?.dbReturnId || null,
        session_id: dbSessionId,
        worker_id: dbWorkerId,
        workstation_key: getWorkstationKey(),
        station,
        sku: curPSku.sku,
        description: curPSku.desc,
        copies,
        stock,
        dpi,
        print_method: printMethod
      })
    });
    const jobData = await jobRes.json();
    if (!jobData.success) throw new Error(jobData.error || 'Failed to create print job');
    jobId = jobData.jobId;
    zpl = jobData.zpl;

    // Step 2: Try QZ Tray
    if (qzPrintConfig?.qzEnabled !== false) {
      try {
        await connectQz();
        if (qzLocalPrinters.length === 0) await discoverQzPrinters();
        const resolved = await resolveQzPrinter(station);

        if (!resolved.name) {
          throw new Error('NO_PRINTER');
        }

        await sendPrintViaQz(resolved.name, zpl, copies);
        await finalizePrintJobStatus(jobId, 'success', resolved.name, 'qz', { mode: 'qz', copies });
        toast(`🖨 ${copies}× ${curPSku.sku} sent to ${resolved.name}`, 's');
        addSyncLog('Label printed (QZ)', 'success', `${copies}× ${curPSku.sku} → ${resolved.name}`);
        cm('pmo');
        return;

      } catch (qzErr) {
        console.warn('[QZ] Print failed:', qzErr.message);

        // If fallback not available, fail here
        if (!qzPrintConfig?.barTenderFallbackEnabled) {
          await finalizePrintJobStatus(jobId, 'failed', null, 'qz', null, qzErr.message);
          handleQzError(qzErr.message);
          return;
        }

        // Log the QZ failure, fall through to BarTender
        toast('⚠ QZ unavailable — trying BarTender fallback…', 'w');
      }
    }

    // Step 3: BarTender fallback (only during transition)
    if (qzPrintConfig?.barTenderFallbackEnabled) {
      try {
        await sendPrintViaBarTenderFallback(curPSku.sku, curPSku.desc, station, copies);
        await finalizePrintJobStatus(jobId, 'success', 'BarTender', 'bartender', { mode: 'bartender', copies });
        toast(`🖨 ${copies}× ${curPSku.sku} sent via BarTender fallback`, 's');
        addSyncLog('Label printed (BarTender)', 'success', `${copies}× ${curPSku.sku} → Station ${station}`);
        cm('pmo');
        return;
      } catch (btErr) {
        await finalizePrintJobStatus(jobId, 'failed', null, 'bartender', null, btErr.message);
        toast('✗ Both QZ and BarTender failed', 'e');
        return;
      }
    }

    // No print method available
    if (jobId) await finalizePrintJobStatus(jobId, 'failed', null, null, null, 'No print method available');
    toast('✗ No print method available — install QZ Tray', 'e');

  } catch (e) {
    if (jobId) await finalizePrintJobStatus(jobId, 'failed', null, null, null, e.message);
    toast('✗ Print error: ' + e.message, 'e');
    console.error('[Print Error]', e);
  } finally {
    if (btn) { btn.textContent = '🖨 Send to Printer'; btn.disabled = false; }
  }
}

// ── QZ Error Handling & Install Prompt ────────
function handleQzError(errorMsg) {
  if (errorMsg === 'QZ_NOT_LOADED' || errorMsg === 'QZ_NOT_RUNNING' || errorMsg === 'NO_PRINTER') {
    showQzInstallPrompt(errorMsg);
  } else {
    toast('✗ Print error: ' + errorMsg, 'e');
  }
}

function showQzInstallPrompt(reason) {
  const messages = {
    'QZ_NOT_LOADED': 'QZ Tray library not loaded. Refresh the page and try again.',
    'QZ_NOT_RUNNING': 'QZ Tray is not running on this computer.',
    'NO_PRINTER': 'No printer found. Connect a printer and try again.',
  };

  const downloads = qzPrintConfig?.qzDownloads || {};
  const isInstall = reason === 'QZ_NOT_RUNNING' || reason === 'QZ_NOT_LOADED';

  const det = document.getElementById('sdetail') || document.querySelector('#pmo .mb');
  if (!det) {
    toast('✗ ' + (messages[reason] || reason), 'e');
    return;
  }

  // Show install/retry UI inside the print modal
  const existingBanner = document.getElementById('qz-install-banner');
  if (existingBanner) existingBanner.remove();

  const banner = document.createElement('div');
  banner.id = 'qz-install-banner';
  banner.style.cssText = 'background:rgba(79,142,247,.08);border:2px solid rgba(79,142,247,.3);border-radius:var(--rl);padding:16px;margin-bottom:14px';
  banner.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:var(--B)">🖨 QZ Tray Required for Printing</div>
    <div style="font-size:13px;color:var(--tx2);margin-bottom:12px;line-height:1.6">${messages[reason] || reason}</div>
    ${isInstall ? `
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">Download QZ Tray:</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        ${downloads.windows ? `<a href="${downloads.windows}" target="_blank" class="btn bs sm" style="text-decoration:none">⊞ Windows</a>` : ''}
        ${downloads.mac ? `<a href="${downloads.mac}" target="_blank" class="btn bs sm" style="text-decoration:none">🍎 Mac</a>` : ''}
        ${downloads.linux ? `<a href="${downloads.linux}" target="_blank" class="btn bs sm" style="text-decoration:none">🐧 Linux</a>` : ''}
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Install, then click Retry below. No page refresh needed.</div>
    ` : ''}
    <div style="display:flex;gap:8px">
      <button class="btn bY sm" onclick="retryQzConnection()">↻ Retry Connection</button>
      ${reason === 'NO_PRINTER' ? '<button class="btn bs sm" onclick="openQzPrinterPicker()">Choose Printer…</button>' : ''}
    </div>`;

  const mb = document.querySelector('#pmo .mb');
  if (mb) mb.insertBefore(banner, mb.firstChild);
}

async function retryQzConnection() {
  const banner = document.getElementById('qz-install-banner');
  try {
    configureQzSecurity();
    await connectQz();
    await discoverQzPrinters();
    if (banner) banner.remove();
    toast('✓ QZ Tray connected — ' + qzLocalPrinters.length + ' printer(s) found', 's');
    updateQzPrinterDropdown();
  } catch (e) {
    toast('✗ Still cannot connect to QZ Tray', 'e');
  }
}

// ── QZ Printer Dropdown ───────────────────────
function updateQzPrinterDropdown() {
  const sel = document.getElementById('pp-sel');
  if (!sel) return;

  sel.innerHTML = '';

  // Default printer option
  if (qzDefaultPrinter) {
    const opt = document.createElement('option');
    opt.value = '__default__';
    opt.textContent = '⭐ Default: ' + qzDefaultPrinter;
    sel.appendChild(opt);
  }

  // All discovered printers
  qzLocalPrinters.forEach(name => {
    if (name === qzDefaultPrinter) return; // already listed as default
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  // Fallback: original station printers (for BarTender mode)
  if (qzLocalPrinters.length === 0 && printers.length > 0) {
    printers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.n + ' (' + p.ip + ')';
      sel.appendChild(opt);
    });
  }
}

function openQzPrinterPicker() {
  discoverQzPrinters().then(() => {
    updateQzPrinterDropdown();
    toast(qzLocalPrinters.length + ' printer(s) found', 's');
  }).catch(e => {
    toast('Cannot discover printers: ' + e.message, 'e');
  });
}

// ── Save Current Selection as Preference ──────
async function saveCurrentPrinterPref() {
  const sel = document.getElementById('pp-sel');
  const station = selStation_val || 'A';
  const stock = document.getElementById('pp-size')?.value || '3x2';
  const isDefault = sel?.value === '__default__';
  const printerName = isDefault ? qzDefaultPrinter : sel?.value;
  const pref = await loadPrinterPreference(station);
  const dpi = pref?.dpi || qzPrintConfig?.defaultDpi || 300;

  await savePrinterPreference(station, printerName, isDefault, dpi, stock, 'direct_thermal');
}

// ── Initialize QZ on App Start ────────────────
async function initQzPrint() {
  await loadPrintConfig();

  if (!qzPrintConfig?.qzEnabled) {
    console.log('[QZ] QZ printing disabled by server config');
    return;
  }

  if (!window.qz) {
    console.warn('[QZ] qz-tray.js not loaded — QZ printing unavailable');
    return;
  }

  try {
    configureQzSecurity();
    await connectQz();
    await discoverQzPrinters();
    updateQzPrinterDropdown();
    console.log('[QZ] Ready — ' + qzLocalPrinters.length + ' printer(s)');
  } catch (e) {
    console.warn('[QZ] Init failed (will retry on print):', e.message);
    // Not fatal — will show install prompt on first print attempt
  }
}
