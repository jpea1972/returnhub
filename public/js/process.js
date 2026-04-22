// ══════════════════════════════════════════════
// PROCESS — Confirm flow and finalize return
// ══════════════════════════════════════════════

function tryProcess(){
  if(!curR) return;
  const states          = curR.items.map((_, i) => itemStates[i]?.state);
  const hasMissingItems = states.some(s => s === 'unchecked' || s === 'partial');
  const hasDamageFlags  = states.some(s => s === 'damaged' || s === 'wrong');
  if(hasMissingItems)       { openConfirmModal(); }
  else if(hasDamageFlags)   { confirmAndProcess(); }
  else                      { finalizeProcess(); }
}

function openConfirmModal(){
  const summary = document.getElementById('confirm-summary');
  const stateLabels = {
    checked:'Received ✓', unchecked:'NOT RETURNED ✕', partial:'Partial Return',
    damaged:'Received — Damaged 🗑', wrong:'Received — Wrong Product ❓',
  };
  const stateBadge    = {checked:'bg', unchecked:'br', partial:'ba', damaged:'br', wrong:'bp'};
  const stateDot      = {checked:'var(--G)', unchecked:'var(--R)', partial:'var(--A)', damaged:'var(--R)', wrong:'var(--P)'};
  const stateQtyColor = stateDot;

  const receivedWithIssues = curR.items.filter((_, i) => ['damaged','wrong'].includes(itemStates[i].state));
  const notReceived        = curR.items.filter((_, i) => ['unchecked','partial'].includes(itemStates[i].state));
  const allItems           = curR.items;
  let html = '';

  if(receivedWithIssues.length > 0){
    html += `<div style="padding:8px 12px;background:rgba(240,69,69,.08);font-size:10px;font-weight:700;color:var(--R);text-transform:uppercase;letter-spacing:.6px;font-family:var(--fm);border-bottom:1px solid var(--b2)">Received — Flagged Issues (${receivedWithIssues.length})</div>`;
  }
  allItems.forEach((item, idx) => {
    const s = itemStates[idx];
    if(!['damaged','wrong'].includes(s.state)) return;
    const rcv     = item.qty;
    const subNote = s.state === 'damaged'
      ? (s.dmgChecks.length ? s.dmgChecks.join(', ') : '') + (s.dmgNotes ? ' · ' + s.dmgNotes.substring(0,70) : '')
      : s.wrongNotes.substring(0,80);
    html += `<div class="ci-row ${s.state}" style="background:${s.state==='damaged'?'rgba(240,69,69,.05)':'rgba(155,111,247,.05)'}">
      <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${stateDot[s.state]}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fm);font-size:11px;color:var(--Y);margin-bottom:1px">${item.sku}</div>
        <div style="font-size:12px;color:var(--tx2)">${item.desc}</div>
        ${subNote ? `<div style="font-size:11px;color:${stateDot[s.state]};margin-top:3px;opacity:.85">${subNote}</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:10px">
        <div style="font-family:var(--fm);font-size:12px;font-weight:700;color:${stateQtyColor[s.state]}">${rcv}/${item.qty} rcvd</div>
        <div style="font-size:10px;color:var(--G);font-family:var(--fm);">0 missing</div>
        <span class="badge ${stateBadge[s.state]}" style="font-size:9px;margin-top:2px">${stateLabels[s.state]}</span>
      </div>
    </div>`;
  });

  if(notReceived.length > 0){
    html += `<div style="padding:8px 12px;background:rgba(245,166,35,.08);font-size:10px;font-weight:700;color:var(--A);text-transform:uppercase;letter-spacing:.6px;font-family:var(--fm);border-bottom:1px solid var(--b2);border-top:1px solid var(--b2)">Not Received / Missing (${notReceived.length})</div>`;
  }
  allItems.forEach((item, idx) => {
    const s = itemStates[idx];
    if(!['unchecked','partial'].includes(s.state)) return;
    const rcv  = s.state === 'partial' ? (s.rcvQty || 0) : 0;
    const miss = item.qty - rcv;
    html += `<div class="ci-row ${s.state==='unchecked'?'not-returned':'partial'}">
      <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${stateDot[s.state]}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fm);font-size:11px;color:var(--Y);margin-bottom:1px">${item.sku}</div>
        <div style="font-size:12px;color:var(--tx2)">${item.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:10px">
        <div style="font-family:var(--fm);font-size:12px;font-weight:700;color:${stateQtyColor[s.state]}">${rcv}/${item.qty} rcvd</div>
        <div style="font-size:10px;color:var(--R);font-family:var(--fm);font-weight:700">${miss} MISSING</div>
        <span class="badge ${stateBadge[s.state]}" style="font-size:9px;margin-top:2px">${stateLabels[s.state]}</span>
      </div>
    </div>`;
  });

  allItems.forEach((item, idx) => {
    const s = itemStates[idx];
    if(s.state !== 'checked') return;
    html += `<div class="ci-row checked">
      <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--G)"></div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fm);font-size:11px;color:var(--Y);margin-bottom:1px">${item.sku}</div>
        <div style="font-size:12px;color:var(--tx2)">${item.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:10px">
        <div style="font-family:var(--fm);font-size:12px;font-weight:700;color:var(--G)">${item.qty}/${item.qty} rcvd</div>
        <span class="badge bg" style="font-size:9px;margin-top:2px">Received ✓</span>
      </div>
    </div>`;
  });

  summary.innerHTML = html;
  const missingCount = notReceived.length;
  const flaggedCount = receivedWithIssues.length;
  const parts = [];
  if(missingCount > 0) parts.push(`${missingCount} item(s) NOT received — will be flagged as missing`);
  if(flaggedCount > 0) parts.push(`${flaggedCount} item(s) received but flagged with issues`);
  document.getElementById('confirm-warning').textContent = parts.join(' · ') + '. Notes below apply to missing items.';
  document.getElementById('confirm-notes').value = '';
  document.getElementById('confirm-modal').classList.add('open');
}

function cancelConfirm(){ document.getElementById('confirm-modal').classList.remove('open'); }

function confirmAndProcess(){
  const missingNotes = document.getElementById('confirm-notes')?.value.trim() || 'Logged during return processing.';

  curR.items.forEach((item, idx) => {
    const s = itemStates[idx];
    if(s.state === 'unchecked'){
      FLAGS.push({type:'Not Returned', oid:curR.id, rrid:curR.rrid, cust:curR.cust, sku:item.sku, desc:item.desc, expQty:item.qty, rcvQty:0, missing:item.qty, disp:'Hold — Awaiting Resolution', notes:`Item NOT received. ${missingNotes} Logged by ${cu.n}.`, days:curR.daysHeld, date:'Today', status:'open'});
    } else if(s.state === 'partial'){
      const rcv = s.rcvQty || 0;
      FLAGS.push({type:'Partial Return', oid:curR.id, rrid:curR.rrid, cust:curR.cust, sku:item.sku, desc:item.desc, expQty:item.qty, rcvQty:rcv, missing:item.qty-rcv, disp:'Hold — Awaiting Resolution', notes:`Partial: ${rcv}/${item.qty} received. ${missingNotes} Logged by ${cu.n}.`, days:curR.daysHeld, date:'Today', status:'open'});
    } else if(s.state === 'damaged'){
      const checks = s.dmgChecks.length ? s.dmgChecks.join(', ') + '. ' : '';
      FLAGS.push({type:'Damaged', oid:curR.id, rrid:curR.rrid, cust:curR.cust, sku:item.sku, desc:item.desc, expQty:item.qty, rcvQty:item.qty, missing:0, disp:s.dmgDisp||'Damage Out — Dispose', notes:`${checks}${s.dmgNotes||'No additional notes.'} Logged by ${cu.n}.`, days:curR.daysHeld, date:'Today', status:'open'});
    } else if(s.state === 'wrong'){
      FLAGS.push({type:'Wrong Product', oid:curR.id, rrid:curR.rrid, cust:curR.cust, sku:item.sku, desc:item.desc, expQty:item.qty, rcvQty:item.qty, missing:0, disp:'Quarantine', notes:`Wrong product received. ${s.wrongNotes||'No description.'} Logged by ${cu.n}.`, days:curR.daysHeld, date:'Today', status:'open'});
    }
  });

  document.getElementById('confirm-modal').classList.remove('open');

  const flagRecords = [];
  curR.items.forEach((item, idx) => {
    const s    = itemStates[idx];
    const base = {
      order_number:curR.id, rma_name:curR.rma||curR.id, customer_name:curR.cust,
      reason:curR.reason||'--', sku:item.sku, product_name:item.desc,
      worker_id:dbWorkerId, session_id:dbSessionId
    };
    if(s.state === 'checked'){
      flagRecords.push({...base, expected_qty:item.qty, received_qty:item.qty, condition:'Good', disposition:'Restock'});
    } else if(s.state === 'unchecked'){
      flagRecords.push({...base, expected_qty:item.qty, received_qty:0, condition:'Not Returned', disposition:'Hold'});
    } else if(s.state === 'partial'){
      const rcv   = s.rcvQty || 0;
      const notes = document.getElementById('pq-notes-'+idx)?.value || null;
      flagRecords.push({...base, expected_qty:item.qty, received_qty:rcv, condition:'Partial', damage_notes:notes, disposition:'Hold'});
    } else if(s.state === 'damaged'){
      const checks = DMG_CHECKS.filter((_,ci) => document.getElementById('dc-'+idx+'-'+ci)?.checked).join(', ');
      flagRecords.push({...base, expected_qty:item.qty, received_qty:item.qty, condition:'Damaged', damage_checks:checks||null, damage_notes:s.dmgNotes||null, disposition:s.dmgDisp||'Damage Out -- Dispose'});
    } else if(s.state === 'wrong'){
      flagRecords.push({...base, expected_qty:item.qty, received_qty:item.qty, condition:'Wrong Product', wrong_notes:s.wrongNotes||null, disposition:'Quarantine'});
    }
  });

  curR._flagRecords = flagRecords;
  const nonGoodCount = curR.items.filter((_, i) => itemStates[i].state !== 'checked').length;
  if(nonGoodCount > 0) toast('⚑ ' + nonGoodCount + ' flag(s) will be saved to Returns Report', 'w');
  rFlags();
  finalizeProcess();
}

async function finalizeProcess(){
  if(!curR) return;

  const states    = curR.items.map((_, i) => itemStates[i]?.state);
  let condition   = 'Good';
  if(states.some(s => s === 'unchecked' || s === 'partial')) condition = 'Not Returned';
  else if(states.some(s => s === 'damaged')) condition = 'Damaged';

  const billingRate  = (condition === 'Good' || condition === 'Damaged') ? CLIENT_RATES.good : 0.00;
  const billedAmount = billingRate * curR.items.reduce((s, i) => s + i.qty, 0);
  const skuFp        = curR._sku_fingerprint || curR.items.map(i => i.sku).filter(Boolean).sort().join('|');

  if(!curR._flagRecords){
    curR._flagRecords = curR.items.map((item, idx) => ({
      order_number:curR.id, rma_name:curR.rma||curR.id, customer_name:curR.cust,
      reason:curR.reason||'--', sku:item.sku, product_name:item.desc,
      expected_qty:item.qty, received_qty:item.qty, condition:'Good', disposition:'Restock',
      worker_id:dbWorkerId, session_id:dbSessionId
    }));
  }

  if(dbSessionId && dbWorkerId){
    try {
      const payload = {
        order_number:curR.id, tracking_number:curR.track, carrier:curR._carrier||'USPS',
        customer_name:curR.cust, customer_zip:curR._customer_zip||null, sku_fingerprint:skuFp,
        condition, billing_rate:billingRate, billed_amount:billedAmount,
        worker_id:dbWorkerId, session_id:dbSessionId, station:selStation_val,
        label_printed:false, rr_created_at:curR._rr_created_at||null, notes:null,
        is_duplicate_override:curR._duplicateOverride||false, is_manual:curR._is_manual||false,
        line_items:curR.items.map(i => ({sku:i.sku, product_name:i.desc, quantity:i.qty}))
      };
      const res  = await fetch('/api/db/returns', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      const data = await res.json();
      if(data.success){
        console.log('[DB] Return saved:', curR.id, 'return_id:', data.return_id);
        if(curR._flagRecords && curR._flagRecords.length > 0){
          const flagsWithId = curR._flagRecords.map(f => ({...f, return_id:data.return_id}));
          fetch('/api/db/flags', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({return_id:data.return_id, flags:flagsWithId})
          }).then(r=>r.json()).then(d=>{
            if(d.success) console.log('[DB] Flags saved:', d.saved);
            else console.error('[DB] Flags save failed:', d.error);
          }).catch(e=>console.error('[DB] Flags error:', e.message));
        }
        const t = curR.track;
        if(t && RETURNS_INDEX[t]){
          RETURNS_INDEX[t] = RETURNS_INDEX[t].filter(r => r.id !== curR.id);
          if(!RETURNS_INDEX[t].length) delete RETURNS_INDEX[t];
        }
        const idx = RETURNS.findIndex(r => r.id === curR.id);
        if(idx >= 0) RETURNS.splice(idx, 1);
      } else if(res.status !== 409){
        console.error('[DB] Save failed:', data.error);
        toast('⚠ Processed but DB save failed', 'w');
      }
    } catch(e){
      console.error('[DB] Save error:', e.message);
      toast('⚠ Processed but DB save failed', 'w');
    }
  }

  myCount++;
  PROCESSED_LOG.push({orderId:curR.id, condition, billedAmount});
  document.getElementById('s2').textContent = parseInt(document.getElementById('s2').textContent) + 1;
  document.getElementById('s3').textContent = Math.max(0, parseInt(document.getElementById('s3').textContent) - 1);
  document.getElementById('s5').textContent = myCount;
  toast('✓ ' + curR.id + ' processed — saved', 's');
  loadProcessedReturns().then(() => {
    if(document.getElementById('tab-queue')?.classList.contains('active')) rQueue();
  });
  updateLiveLeaderboard();
  updateScanStats();
  updateBillingCards();
  if(document.getElementById('tab-billing')?.classList.contains('active')) renderBilling();
  clearScan();
}
