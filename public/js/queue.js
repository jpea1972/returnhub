// ══════════════════════════════════════════════
// QUEUE — Return queue and RR feed rendering
// ══════════════════════════════════════════════

async function loadProcessedReturns(){
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const mParam = activeMerchantId ? '&merchant_id=' + activeMerchantId : '';
    const res  = await fetch('/api/db/returns/search?limit=500&date_from=' + encodeURIComponent(today.toISOString()) + mParam);
    const data = await res.json();
    if(data.success){
      processedReturns = data.returns || [];
      console.log('[Queue] Loaded', processedReturns.length, 'processed returns from DB');
    }
  } catch(e){ console.error('[Queue] Failed to load processed:', e.message); }
}

function rQueue(f='all'){
  const tb = document.getElementById('qtbody'); if(!tb) return;
  const sm = {arrived:'bb',pending:'ba',flagged:'br',processed:'bg',damaged:'br'};
  const st = {arrived:'ARRIVED',pending:'PENDING',flagged:'FLAGGED',processed:'PROCESSED',damaged:'DAMAGED'};
  let rows = [];

  if(f === 'all' || f === 'pending'){
    RETURNS.forEach(r => {
      rows.push({
        isPending:true, status:r.status||'pending', id:r.id, cust:r.cust,
        skus:r.items.map(i => i.sku).join('<br>'),
        descs:r.items.map(i => i.desc).join(', '),
        qty:r.items.reduce((s,i) => s+i.qty, 0),
        shipDate:r.shipDate||'—', daysHeld:r.daysHeld||0,
        date:r.date||'—', rma:r.rma||'—', rrid:r.rrid||'—',
        bc:r.bc, condition:'Pending', processedBy:'—', receivedAt:'—'
      });
    });
  }

  if(f === 'all' || f === 'processed'){
    processedReturns.forEach(r => {
      const lis   = Array.isArray(r.line_items) ? r.line_items : [];
      const skus  = lis.map(li => li.sku||'').filter(Boolean).join('<br>') || r.sku_fingerprint || '—';
      const descs = lis.map(li => li.product_name||'').filter(Boolean).join(', ') || '—';
      const time  = r.received_at ? new Date(r.received_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : '—';
      rows.push({
        isPending:false, status:'processed', id:r.order_number, cust:r.customer_name,
        skus, descs, qty:lis.reduce((s,li) => s+(li.quantity||1), 0)||1,
        shipDate:'—', daysHeld:0, date:time, rma:'—', rrid:'—',
        bc:r.tracking_number||'', condition:r.condition,
        processedBy:r.worker_initials||'—', receivedAt:time
      });
    });
  }

  if(rows.length === 0){
    tb.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:20px;color:var(--tx3)">No returns found</td></tr>';
    updateQueueBadges(); return;
  }

  tb.innerHTML = rows.map(r => `<tr style="${r.isPending?'':'background:rgba(34,212,106,.02);'}">
    <td><span class="badge ${sm[r.status]||'bgr'}">${(st[r.status]||r.status).toUpperCase()}</span></td>
    <td class="mono" style="font-size:10px">${r.id}</td>
    <td style="font-size:12px">${r.cust}</td>
    <td style="font-family:var(--fm);font-size:10px;color:var(--Y)">${r.skus}</td>
    <td style="font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.descs}</td>
    <td style="text-align:center;font-family:var(--fm)">${r.qty}</td>
    <td style="text-align:center;font-family:var(--fm)">${r.qty}</td>
    <td style="text-align:center;color:var(--tx3)">—</td>
    <td style="font-size:11px">${r.shipDate}</td>
    <td>${r.daysHeld>0?`<span class="dchip ${r.daysHeld>60?'dr':r.daysHeld>30?'da':'dg2'}">${r.daysHeld}d</span>`:'<span style="color:var(--tx3)">—</span>'}</td>
    <td>${r.isPending?'<span class="badge ba">Pending</span>':condBadge(r.condition)}</td>
    <td class="mono" style="font-size:10px">${r.rma}</td>
    <td style="font-family:var(--fm);font-size:10px;color:var(--T)">${r.rrid}</td>
    <td style="font-size:11px;color:var(--tx2)">${r.date}</td>
    <td>${r.isPending
      ?`<button class="btn bs sm" onclick="qGo('${r.bc||r.id}')">Process →</button>`
      :`<span style="font-size:11px;color:var(--G);font-weight:600">✓ ${r.processedBy}</span>`
    }</td>
  </tr>`).join('');

  updateQueueBadges();
}

async function refreshQueue(){
  const lbl = document.getElementById('queue-last-refresh');
  if(lbl) lbl.textContent = 'Refreshing...';
  try {
    await loadDBCache();
    await loadProcessedReturns();
    rQueue();
    const now = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    if(lbl) lbl.textContent = 'Last refresh: ' + now;
    toast('✓ Queue refreshed', 's');
  } catch(e){
    if(lbl) lbl.textContent = 'Refresh failed';
    console.error('[Refresh]', e.message);
  }
}

function updateQueueBadges(){
  const pending    = RETURNS.length;
  const processed  = processedReturns.length;
  const total      = pending + processed;
  const qfAll      = document.getElementById('qf-all');
  const qfPending  = document.getElementById('qf-pending');
  const qfProcessed= document.getElementById('qf-processed');
  if(qfAll)        qfAll.textContent       = 'All (' + total + ')';
  if(qfPending)    qfPending.textContent   = 'Pending (' + pending + ')';
  if(qfProcessed)  qfProcessed.textContent = 'Processed (' + processed + ')';
  const qct = document.getElementById('qct');
  if(qct) qct.textContent = pending;
}

function fQ(f, btn){
  document.querySelectorAll('#qf .btn').forEach(b => { b.style.borderColor=''; b.style.color=''; });
  btn.style.borderColor = 'var(--Y)'; btn.style.color = 'var(--Y)';
  rQueue(f);
}

function qGo(bc){
  nav('scan');
  setTimeout(() => { procScan(bc); }, 80);
}

function condBadge(c){
  const m = {
    'Good':         '<span class="badge bg">Good</span>',
    'Damaged':      '<span class="badge br">Damaged</span>',
    'Partial':      '<span class="badge ba">Partial</span>',
    'Wrong Item':   '<span class="badge bp">Wrong Item</span>',
    'Not Received': '<span class="badge ba">Not Received</span>',
  };
  return m[c] || `<span class="badge bgr">${c}</span>`;
}

function rRR(){
  const tb = document.getElementById('rrtbody'); if(!tb) return;
  const sm = {arrived:'bb',pending:'ba',flagged:'br',processed:'bg'};
  const st = {arrived:'ARRIVED',pending:'PENDING',flagged:'FLAGGED',processed:'PROCESSED'};
  tb.innerHTML = RETURNS.map(r => `<tr>
    <td style="font-family:var(--fm);color:var(--T);font-size:10px">${r.rrid}</td>
    <td class="mono">${r.id}</td>
    <td style="font-size:12px">${r.cust}</td>
    <td><div style="width:34px;height:34px;border-radius:6px;overflow:hidden;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer" onclick="toast('📷 Load photo in Scan panel','s')">📷</div></td>
    <td style="font-family:var(--fm);font-size:10px;color:var(--Y)">${r.items[0].sku}</td>
    <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.items[0].desc}</td>
    <td style="text-align:center;font-family:var(--fm)">${r.items.reduce((s,i) => s+i.qty, 0)}</td>
    <td style="color:var(--G);font-weight:600">$${r.val}</td>
    <td style="font-size:11px">${r.shipDate}</td>
    <td><span class="dchip ${r.daysHeld>60?'dr':r.daysHeld>30?'da':'dg2'}">${r.daysHeld}d</span></td>
    <td style="font-size:11px">${r.reason}</td>
    <td><span class="badge ${sm[r.status]||'bgr'}">${st[r.status]||r.status}</span></td>
    <td><button class="btn bs sm" onclick="qGo('${r.bc||r.id}')">Process</button></td>
  </tr>`).join('');
}
