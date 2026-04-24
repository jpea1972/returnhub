// ══════════════════════════════════════════════
// FLAGS — Discrepancy / Returns Report
// ══════════════════════════════════════════════

async function loadFlags(conditionFilter='all', dateFrom=null, dateTo=null, search=null){
  try {
    let url = '/api/db/flags?limit=500';
    if(activeMerchantId) url += '&merchant_id=' + activeMerchantId;
    if(conditionFilter && conditionFilter !== 'all') url += '&condition=' + encodeURIComponent(conditionFilter);
    if(dateFrom) url += '&date_from=' + encodeURIComponent(dateFrom);
    if(dateTo)   url += '&date_to='   + encodeURIComponent(dateTo);
    if(search && search.trim()) url += '&q=' + encodeURIComponent(search.trim());
    const res  = await fetch(url);
    const data = await res.json();
    if(data.success) dbFlags = data.flags || [];
  } catch(e){ console.error('[Flags Load]', e.message); }
}

function getFlagsFilterState(){
  const from   = document.getElementById('flags-date-from')?.value || null;
  const to     = document.getElementById('flags-date-to')?.value || null;
  const search = document.getElementById('flags-search')?.value || null;
  return {
    dateFrom: from ? new Date(from).toISOString() : null,
    dateTo:   to   ? new Date(to + 'T23:59:59').toISOString() : null,
    search:   search
  };
}

function applyFlagsDateFilter(){
  const from = document.getElementById('flags-date-from')?.value;
  if(!from){ toast('Select a start date', 'e'); return; }
  rFlags('all');
}

function clearFlagsDateFilter(){
  const fi = document.getElementById('flags-date-from');
  const ti = document.getElementById('flags-date-to');
  const si = document.getElementById('flags-search');
  if(fi) fi.value = '';
  if(ti) ti.value = '';
  if(si) si.value = '';
  rFlags('all');
}

function searchFlags(){
  rFlags('all');
}

function onFlagsSearchKey(e){
  if(e.key === 'Enter') searchFlags();
}

async function rFlags(conditionFilter='all'){
  const filters = getFlagsFilterState();
  await loadFlags(conditionFilter, filters.dateFrom, filters.dateTo, filters.search);
  const tb = document.getElementById('ftbody'); if(!tb) return;

  const total   = dbFlags.length;
  const damaged = dbFlags.filter(f => f.condition === 'Damaged').length;
  const partial = dbFlags.filter(f => f.condition === 'Partial').length;
  const notRet  = dbFlags.filter(f => f.condition === 'Not Returned').length;
  const wrong   = dbFlags.filter(f => f.condition === 'Wrong Product').length;
  const nonGood = damaged + partial + notRet + wrong;

  document.getElementById('fct')        && (document.getElementById('fct').textContent        = nonGood);
  document.getElementById('flag-badge') && (document.getElementById('flag-badge').textContent = total + ' TOTAL');
  document.getElementById('s4')         && (document.getElementById('s4').textContent         = nonGood);
  document.getElementById('fl-t')       && (document.getElementById('fl-t').textContent       = total);
  document.getElementById('fl-p')       && (document.getElementById('fl-p').textContent       = partial + notRet);
  document.getElementById('fl-w')       && (document.getElementById('fl-w').textContent       = wrong);
  document.getElementById('fl-d')       && (document.getElementById('fl-d').textContent       = damaged);

  if(dbFlags.length === 0){
    tb.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:20px;color:var(--tx3)">No returns found' +
      (filters.search ? ' matching "' + filters.search + '"' : '') +
      (filters.dateFrom ? ' in selected date range' : '') +
      '</td></tr>';
    return;
  }

  const condBadgeMap = {
    'Good':          '<span class="badge bg">GOOD</span>',
    'Damaged':       '<span class="badge br">DAMAGED</span>',
    'Partial':       '<span class="badge ba">PARTIAL</span>',
    'Not Returned':  '<span class="badge br">NOT RETURNED</span>',
    'Wrong Product': '<span class="badge bp">WRONG PRODUCT</span>'
  };

  tb.innerHTML = dbFlags.map(f => {
    const missing = (f.expected_qty||0) - (f.received_qty||0);
    const time    = f.created_at
      ? new Date(f.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
      : '—';
    const details = [f.damage_checks, f.damage_notes, f.wrong_notes].filter(Boolean).join(' · ') || '—';
    return `<tr>
      <td>${condBadgeMap[f.condition]||'<span class="badge bgr">'+f.condition+'</span>'}</td>
      <td class="mono" style="font-size:10px">${f.order_number||'—'}</td>
      <td style="font-family:var(--fm);font-size:10px;color:var(--T)">${f.rma_name||'—'}</td>
      <td style="font-size:12px">${f.customer_name||'—'}</td>
      <td style="font-size:11px;color:var(--tx2)">${f.reason||'—'}</td>
      <td style="font-family:var(--fm);font-size:10px;color:var(--Y)">${f.sku||'—'}</td>
      <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.product_name||'—'}</td>
      <td style="text-align:center;font-family:var(--fm)">${f.expected_qty||0}</td>
      <td style="text-align:center;font-family:var(--fm)">${f.received_qty||0}</td>
      <td style="text-align:center;font-family:var(--fm);font-weight:700;color:${missing>0?'var(--R)':'var(--G)'}">${missing}</td>
      <td style="font-size:11px">${f.disposition||'—'}</td>
      <td style="font-size:11px;color:var(--tx2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${details}">${details}</td>
      <td style="font-size:11px;color:var(--tx3)">${time}</td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--B)">${f.worker_initials||'—'}</td>
      <td><button class="btn bs sm" onclick="editFlag(${f.id},'${f.condition}')">Edit</button></td>
    </tr>`;
  }).join('');
}

function editFlag(flagId, currentCondition){
  _editFlagId = flagId;
  const flag = dbFlags.find(f => f.id === flagId) || {};
  document.getElementById('ef-sku').textContent    = flag.sku || '';
  document.getElementById('ef-order').textContent  = flag.order_number || '';
  document.getElementById('ef-condition').value    = currentCondition;
  document.getElementById('ef-disposition').value  = flag.disposition || 'Restock';
  document.getElementById('ef-expected-qty').value = flag.expected_qty || 1;
  document.getElementById('ef-received-qty').value = flag.received_qty !== undefined ? flag.received_qty : flag.expected_qty || 1;
  document.getElementById('ef-notes').value        = [flag.damage_checks, flag.damage_notes, flag.wrong_notes].filter(Boolean).join(' | ') || '';
  om('edit-flag-modal');
}

async function saveEditFlag(){
  if(!_editFlagId){ toast('No flag selected', 'e'); return; }
  const condition    = document.getElementById('ef-condition').value;
  const disposition  = document.getElementById('ef-disposition').value;
  const notes        = document.getElementById('ef-notes').value.trim();
  const received_qty = parseInt(document.getElementById('ef-received-qty').value) || 0;
  try {
    const res  = await fetch('/api/db/flags/' + _editFlagId, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({condition, disposition, damage_notes:notes, received_qty, billing_rate:CLIENT_RATES.good, worker_id:dbWorkerId})
    });
    const data = await res.json();
    if(data.success){
      toast('✓ Updated to ' + condition, 's');
      cm('edit-flag-modal');
      rFlags();
      updateScanStats();
      updateBillingCards();
    } else {
      toast('Update failed: ' + data.error, 'e');
    }
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}
