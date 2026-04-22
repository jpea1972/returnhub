// ══════════════════════════════════════════════
// SCAN — Barcode scanning, lookup, duplicate check
// ══════════════════════════════════════════════

function procScan(code){ procScanLive(code); }

async function procScanLive(code){
  if(!code) return;
  const z   = document.getElementById('sz');
  const det = document.getElementById('sdetail');
  if(det) det.style.display = 'none';
  document.getElementById('rp').classList.remove('vis');

  if(code.length > 22 && /^[0-9]+$/.test(code)){
    const m = code.match(/((?:9[0-9]{3}|82)[0-9]{17,19})/);
    if(m){ console.log('[Scan] USPS strip:', code, '->', m[0]); code = m[0]; }
  }

  const isTrack = /^[0-9]{10,30}$/.test(code);

  z.className = 'sz found';
  document.getElementById('stitle').textContent = 'Searching...';
  document.getElementById('ssub').textContent   = 'Looking up: ' + code;

  await logScanEvent(code, code, null, null);

  let candidates = [];
  if(isTrack && RETURNS_INDEX[code]){
    candidates = RETURNS_INDEX[code];
  } else if(!isTrack){
    const clean = code.replace(/^@/, '');
    candidates = RETURNS.filter(r =>
      r.id === code || r.id === '@' + clean || ('@' + clean) === r.id || r.rma === code
    );
  }

  if(candidates.length === 1){
    await handleFoundReturn(candidates[0], code, 'found_cache');
    return;
  }
  if(candidates.length > 1){
    await logScanEvent(code, code, 'found_cache_multi', candidates[0].id);
    showScanPicker(candidates, code);
    return;
  }

  document.getElementById('ssub').textContent = 'Not in cache — checking Return Rabbit live...';
  if(RR_CONFIG.connected){
    try {
      let matches = [];
      for(let p = 1; p <= 5; p++){
        let data;
        try {
          const res = await Promise.race([
            fetch(RR_CONFIG.baseUrl + '/api/v1/service-requests/?page=' + p + '&_t=' + Date.now(),
              {headers: getAuthHeaders(), cache:'no-store'}),
            new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 10000))
          ]);
          if(!res.ok) break;
          data = await res.json();
        } catch(e){ console.log('[Scan] Page', p, e.message); break; }

        const results = data.results || [];
        for(const r of results){
          const track   = r.fulfillment_details?.tracking_number || '';
          const orderId = r.order || '';
          const name    = r.name  || '';
          if(isTrack && track && track === code) matches.push(r);
          else if(!isTrack && (orderId === code || '@' + code.replace(/^@/,'') === orderId || name === code))
            matches.push(r);
        }
        if(!isTrack && matches.length > 0) break;
        if(!data.next) break;
      }

      if(matches.length > 0){
        const mapped = matches.map(mapRRReturn);
        mapped.forEach(r => {
          if(!RETURNS_INDEX[r.track]) RETURNS_INDEX[r.track] = [];
          if(!RETURNS_INDEX[r.track].find(x => x.id === r.id)) RETURNS_INDEX[r.track].push(r);
          if(!RETURNS.find(x => x.id === r.id)) RETURNS.unshift(r);
        });
        if(mapped.length === 1){
          await handleFoundReturn(mapped[0], code, 'found_live');
        } else {
          showScanPicker(mapped, code);
        }
        return;
      }
    } catch(e){ console.error('[Scan] Live error:', e.message); }
  }

  await logScanEvent(code, code, 'not_found', null);
  z.className = 'sz err';
  document.getElementById('stitle').textContent = 'Not Found';
  document.getElementById('ssub').textContent   = 'Try typing the order number (e.g. @702162)';
  setTimeout(() => {
    z.className = 'sz';
    document.getElementById('stitle').textContent = 'Ready to Scan';
    document.getElementById('ssub').textContent   = 'Point scanner at shipping label · click and type';
  }, 3500);
}

async function handleFoundReturn(r, scannedCode, lookupSource){
  const z    = document.getElementById('sz');
  const skuFp = r._sku_fingerprint || r.items.map(i => i.sku).filter(Boolean).sort().join('|');

  try {
    const dupRes  = await fetch('/api/db/duplicate-check', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        tracking_number: r.track,
        order_number:    r.id,
        customer_name:   r.cust,
        sku_fingerprint: skuFp,
        merchant_id:     activeMerchantId || 1
      })
    });
    const dupData = await dupRes.json();
    if(dupData.duplicate){
      await logScanEvent(scannedCode, r.track, 'duplicate', r.id);
      showDuplicateWarning(dupData.existing, r);
      return;
    }
  } catch(e){
    console.error('[Dup Check Error]', e.message);
  }

  await logScanEvent(scannedCode, r.track, lookupSource, r.id);
  curR = r;
  z.className = 'sz found';
  document.getElementById('stitle').textContent = 'Return Found!';
  document.getElementById('ssub').textContent   = 'Check each item received — leave unchecked = NOT returned';
  showDetail(r);
}

function showDuplicateWarning(existing, r){
  const z   = document.getElementById('sz');
  const det = document.getElementById('sdetail');
  z.className = 'sz err';
  document.getElementById('stitle').textContent = 'Already Processed';
  document.getElementById('ssub').textContent   = 'This return was already logged — see details below';
  if(!det) return;
  const procDate = existing.received_at
    ? new Date(existing.received_at).toLocaleString('en-US',
        {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})
    : '--';
  det.style.display = 'block';
  det.innerHTML = `
    <div style="background:rgba(240,69,69,.07);border:2px solid rgba(240,69,69,.4);border-radius:var(--rxl);padding:16px">
      <div style="font-family:var(--fd);font-size:15px;font-weight:700;color:var(--R);margin-bottom:12px">⚠ Already Processed</div>
      <div class="dg" style="margin-bottom:14px">
        <div><div class="dfl">Order</div><div class="dfv m">${existing.order_number}</div></div>
        <div><div class="dfl">Customer</div><div class="dfv">${existing.customer_name}</div></div>
        <div><div class="dfl">Condition</div><div class="dfv">${existing.condition}</div></div>
        <div><div class="dfl">Processed By</div><div class="dfv">${existing.processed_by||'--'} (${existing.processed_by_initials||'--'})</div></div>
        <div><div class="dfl">Date &amp; Time</div><div class="dfv m" style="font-size:11px">${procDate}</div></div>
        <div><div class="dfl">Tracking</div><div class="dfv m" style="font-size:10px;word-break:break-all">${existing.tracking_number}</div></div>
      </div>
      <div style="font-size:12px;color:var(--tx2);margin-bottom:12px;line-height:1.6">
        This return has already been processed and saved. If this is an error, you can override.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn bR" onclick="processDuplicateOverride()" style="flex:1;justify-content:center">Process Anyway (Override)</button>
        <button class="btn bs" onclick="clearScan()" style="flex:1;justify-content:center">Cancel</button>
      </div>
    </div>`;
  window._dupReturn = r;
}

function processDuplicateOverride(){
  const r = window._dupReturn;
  if(!r) return;
  window._dupReturn = null;
  const det = document.getElementById('sdetail');
  if(det) det.style.display = 'none';
  r._duplicateOverride = true;
  curR = r;
  const z = document.getElementById('sz');
  z.className = 'sz found';
  document.getElementById('stitle').textContent = 'Override — Re-processing Return';
  document.getElementById('ssub').textContent   = 'Duplicate override — flagged in records';
  showDetail(r);
}

async function logScanEvent(scannedValue, resolvedTracking, lookupResult, matchedOrder){
  if(!dbSessionId || !dbWorkerId) return;
  try {
    await fetch('/api/db/scan-events', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        session_id:        dbSessionId,
        worker_id:         dbWorkerId,
        scanned_value:     scannedValue,
        resolved_tracking: resolvedTracking,
        lookup_result:     lookupResult,
        matched_order:     matchedOrder
      })
    });
  } catch(e){ console.error('[Scan Event]', e.message); }
}

function showScanPicker(matches, scannedCode){
  const z   = document.getElementById('sz');
  const det = document.getElementById('sdetail');
  z.className = 'sz found';
  document.getElementById('stitle').textContent = matches.length + ' returns found — select the correct one';
  document.getElementById('ssub').textContent   = 'Tracking: ' + scannedCode + ' — ' + matches.length + ' matches';
  if(!det) return;

  const rows = matches.map(r => {
    const isMapped = !!r.cust;
    const cust    = isMapped ? r.cust   : (r.shipping_information?.name || 'Unknown');
    const order   = isMapped ? r.id     : (r.order || r.name || '--');
    const created = isMapped ? r.date   : (r.created ? new Date(r.created).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '--');
    const reason  = isMapped ? r.reason : (r.line_items?.[0]?.reason || '--');
    const items   = isMapped ? (r.items?.length || 0) : (r.line_items?.length || 0);
    const rid     = isMapped ? r.rrid   : mapRRReturn(r).rrid;
    const safeRid = String(rid).replace(/'/g, "\\'");
    return '<div onclick="pickScanMatch(\'' + safeRid + '\')" style="background:var(--bg2);border:1px solid var(--b2);border-radius:var(--rl);padding:14px 16px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:border-color .15s" onmouseover="this.style.borderColor=\'var(--Y)\'" onmouseout="this.style.borderColor=\'var(--b2)\'">'
      + '<div>'
      + '<div style="font-family:var(--fm);font-size:13px;color:var(--Y);font-weight:700;margin-bottom:3px">' + order + '</div>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:2px">' + cust + '</div>'
      + '<div style="font-size:11px;color:var(--tx3)">' + created + ' · ' + items + ' item(s) · ' + reason + '</div>'
      + '</div>'
      + '<div style="background:var(--Yd);color:var(--Y);font-family:var(--fm);font-size:11px;padding:4px 10px;border-radius:20px;white-space:nowrap">Select →</div>'
      + '</div>';
  }).join('');

  det.innerHTML = '<div style="padding:16px;display:flex;flex-direction:column;gap:10px">' + rows + '</div>';
  det.style.display = 'block';
}

function pickScanMatch(rrid){
  const r = RETURNS.find(x => x.rrid === rrid);
  if(!r) return;
  curR = r;
  document.getElementById('sz').className = 'sz found';
  document.getElementById('stitle').textContent = '✓ Return Found!';
  document.getElementById('ssub').textContent   = 'Check each item received · leave unchecked = NOT returned';
  showDetail(r);
  addSyncLog('Scan picker', 'success', `Selected ${r.id} · ${r.cust}`);
}

function clearScan(){
  curR = null; itemStates = {}; window._dupReturn = null;
  document.getElementById('rp').classList.remove('vis');
  const det = document.getElementById('sdetail');
  if(det) det.style.display = 'none';
  document.getElementById('sz').className     = 'sz';
  document.getElementById('stitle').textContent = 'Ready to Scan';
  document.getElementById('ssub').textContent   = 'Point scanner at shipping label · click and type';
  document.getElementById('bc').value = '';
  document.getElementById('bc').focus();
}
