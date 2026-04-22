// ══════════════════════════════════════════════
// EMAIL — Email report management
// ══════════════════════════════════════════════

function renderEmailDisplay(){
  const ed = document.getElementById('email-display');
  if(ed) ed.innerHTML = emailList.map(e =>
    `<span class="echip">${e}<button onclick="removeEmail('${e}')">×</button></span>`
  ).join('');
  const ec = document.getElementById('email-chips');
  if(ec) ec.innerHTML = emailList.map(e =>
    `<span class="echip">${e}<button onclick="removeEmail('${e}')">×</button></span>`
  ).join('');
}

function addEmailList(){
  const i = document.getElementById('email-new');
  const v = i.value.trim();
  if(!v || !v.includes('@')){ toast('Enter valid email', 'e'); return; }
  if(!emailList.includes(v)) emailList.push(v);
  i.value = '';
  renderEmailDisplay();
}

function addEmail(){
  const i = document.getElementById('email-add-in');
  const v = i.value.trim();
  if(!v || !v.includes('@')){ toast('Enter valid email', 'e'); return; }
  if(!emailList.includes(v)) emailList.push(v);
  i.value = '';
  renderEmailDisplay();
}

function removeEmail(e){
  emailList = emailList.filter(x => x !== e);
  renderEmailDisplay();
}

function sendReport(){
  toast(`📧 Report sent to: ${emailList.join(', ')}`, 's');
  cm('emo');
}

function dlReport(){
  if(!dbFlags || dbFlags.length === 0){ toast('No data to export', 'e'); return; }
  const headers = ['Condition','Order','RMA #','Customer','Reason','SKU','Description','Exp Qty','Rcvd Qty','Missing','Disposition','Damage Notes','Date','Worker'];
  const rows = dbFlags.map(f => {
    const missing = (f.expected_qty||0) - (f.received_qty||0);
    const details = [f.damage_checks, f.damage_notes, f.wrong_notes].filter(Boolean).join(' | ') || '';
    const date    = f.created_at ? new Date(f.created_at).toLocaleDateString('en-US') : '';
    return [
      f.condition, f.order_number, f.rma_name, f.customer_name, f.reason,
      f.sku, f.product_name, f.expected_qty, f.received_qty, missing,
      f.disposition, details, date, f.worker_initials
    ].map(v => '"' + (String(v||'').replace(/"/g,'""')) + '"');
  });
  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'ReturnHub-Returns-Report-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('↓ CSV downloaded', 's');
}
