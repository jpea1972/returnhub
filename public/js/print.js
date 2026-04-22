// ══════════════════════════════════════════════
// PRINT — Label printing (QZ Tray + BarTender fallback)
// ══════════════════════════════════════════════

async function sendPrint() {
  // Delegate to hybrid QZ flow (in qz-print.js)
  // Falls back to BarTender if QZ unavailable and fallback enabled
  await sendPrintHybrid();
}

// Legacy ZPL builder — kept as diagnostic reference only
// Production ZPL is generated server-side via /api/labels/print-job
function buildZPL(sku, desc, orderId, copies, size) {
  const s = (sku || '').replace(/[^A-Z0-9\-]/gi, '').substring(0, 30);
  const d = (desc || '').substring(0, 80);
  let d1 = d, d2 = '';
  if (d.length > 40) {
    const split = d.lastIndexOf(' ', 40);
    d1 = d.substring(0, split > 0 ? split : 40);
    d2 = d.substring(split > 0 ? split + 1 : 40).substring(0, 40);
  }
  return [
    '^XA', '^MNB', '^MTD', '^PW900', '^LL600', '^LH0,0',
    `^FO50,40^BY3,2,160^BCN,,N,N^FD${s}^FS`,
    `^FO50,215^A0N,35,35^FD${s}^FS`,
    '^FO30,260^GB840,2,2^FS',
    `^FO30,270^A0N,28,28^FD${d1}^FS`,
    d2 ? `^FO30,305^A0N,28,28^FD${d2}^FS` : '',
    `^PQ${copies || 1},0,1,Y`, '^XZ'
  ].filter(Boolean).join('\n');
}

function openPM(sku, desc, orderId, qty) {
  curPSku = { sku, desc, orderId, qty };

  // Update QZ printer dropdown if available, otherwise fall back to station list
  if (typeof updateQzPrinterDropdown === 'function' && qzLocalPrinters.length > 0) {
    updateQzPrinterDropdown();
  } else {
    popPSel();
  }

  document.getElementById('lp-sku').textContent = sku;
  document.getElementById('lp-desc').textContent = desc;
  document.getElementById('lp-ord').textContent = 'ORDER: ' + orderId + ' · QTY: ' + qty + ' · PARAGONFITWEAR';
  buildLpBc(sku);

  // Remove any stale install banner
  const banner = document.getElementById('qz-install-banner');
  if (banner) banner.remove();

  // Show QZ status indicator
  updatePrintModalStatus();

  om('pmo');
}

function updatePrintModalStatus() {
  let statusEl = document.getElementById('qz-status-indicator');
  if (!statusEl) {
    const mb = document.querySelector('#pmo .mb');
    if (!mb) return;
    statusEl = document.createElement('div');
    statusEl.id = 'qz-status-indicator';
    statusEl.style.cssText = 'font-size:11px;padding:6px 10px;border-radius:var(--r);margin-bottom:10px;display:flex;align-items:center;gap:6px';
    mb.insertBefore(statusEl, mb.firstChild);
  }

  if (qzConnected && qzLocalPrinters.length > 0) {
    statusEl.style.background = 'rgba(34,212,106,.08)';
    statusEl.style.color = 'var(--G)';
    statusEl.innerHTML = '<span style="font-size:8px">🟢</span> QZ Tray connected · ' + qzLocalPrinters.length + ' printer(s)';
  } else if (qzPrintConfig?.barTenderFallbackEnabled) {
    statusEl.style.background = 'rgba(245,166,35,.08)';
    statusEl.style.color = 'var(--A)';
    statusEl.innerHTML = '<span style="font-size:8px">🟡</span> QZ not connected · BarTender fallback available';
  } else {
    statusEl.style.background = 'rgba(240,69,69,.08)';
    statusEl.style.color = 'var(--R)';
    statusEl.innerHTML = '<span style="font-size:8px">🔴</span> No printer connection · <a href="#" onclick="retryQzConnection();return false" style="color:var(--B)">Retry</a>';
  }
}

function buildLpBc(sku) {
  const c = document.getElementById('lp-bc');
  c.innerHTML = '';
  sku.split('').forEach((ch, i) => {
    const w = ch.charCodeAt(0) % 3 === 0 ? 3.5 : 2;
    const d = document.createElement('div');
    d.style.cssText = `width:${w}px;height:100%;background:${i % 2 === 0 ? '#000' : 'white'}`;
    c.appendChild(d);
    if (i % 2 === 0) {
      const s = document.createElement('div');
      s.style.cssText = `width:${ch.charCodeAt(0) % 2 === 0 ? 2 : 1}px;height:100%;background:white`;
      c.appendChild(s);
    }
  });
}
