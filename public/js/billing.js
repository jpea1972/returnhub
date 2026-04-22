// ══════════════════════════════════════════════
// BILLING — Invoices, rates, billing reports
// ══════════════════════════════════════════════

async function saveRates(){
  const good    = parseFloat(document.getElementById('rate-good')?.value);
  const damaged = parseFloat(document.getElementById('rate-damaged')?.value || good);
  if(isNaN(good) || good <= 0){ toast('Invalid rate', 'e'); return; }
  try {
    const res  = await fetch('/api/db/rates', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({good_rate:good, damaged_rate:damaged, worker_id:dbWorkerId})
    });
    const data = await res.json();
    if(data.success){
      CLIENT_RATES = {good:data.good_rate, damaged:data.damaged_rate};
      localStorage.setItem('client_rates_paragon', JSON.stringify(CLIENT_RATES));
      toast('✓ Rates saved — $' + good.toFixed(2) + '/unit', 's');
      updateBillingCards();
    } else { toast('Save failed: ' + data.error, 'e'); }
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}

async function loadClientRates(){
  try {
    const res  = await fetch('/api/db/rates');
    const data = await res.json();
    if(data.success){
      CLIENT_RATES = {good:parseFloat(data.good_rate), damaged:parseFloat(data.damaged_rate||data.good_rate)};
      localStorage.setItem('client_rates_paragon', JSON.stringify(CLIENT_RATES));
      console.log('[Rates] Loaded from DB:', CLIENT_RATES);
    }
    const gi = document.getElementById('rate-good');
    const di = document.getElementById('rate-damaged');
    if(gi) gi.value = CLIENT_RATES.good.toFixed(2);
    if(di) di.value = CLIENT_RATES.damaged.toFixed(2);
  } catch(e){
    try {
      const stored = localStorage.getItem('client_rates_paragon');
      if(stored) CLIENT_RATES = JSON.parse(stored);
    } catch(e2){}
    console.error('[Rates] DB load failed, using localStorage:', e.message);
  }
}

function toggleSetting(id, key){
  const el = document.getElementById(id); if(!el) return;
  el.classList.toggle('on');
  localStorage.setItem(key, el.classList.contains('on') ? '1' : '0');
  toast('✓ Setting saved', 's');
}

function loadBillingSettings(){
  ['tgl-auto:billing_auto_generate','tgl-email:billing_auto_email','tgl-approval:billing_approval'].forEach(pair => {
    const [id, key] = pair.split(':');
    const el = document.getElementById(id); if(!el) return;
    const val = localStorage.getItem(key);
    if(val === '0') el.classList.remove('on');
    else el.classList.add('on');
  });
}

async function updateBillingCards(){
  try {
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate()-(dow===0?6:dow-1));
    monday.setHours(0,0,0,0);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate()+5);
    saturday.setHours(23,59,59,999);

    const wRes  = await fetch('/api/db/reports/billing?date_from='+encodeURIComponent(monday.toISOString())+'&date_to='+encodeURIComponent(saturday.toISOString()));
    const wData = await wRes.json();
    const wb    = wData.billing||{};
    const wGood  = parseInt(wb.total_good||0);
    const wDmg   = parseInt(wb.total_damaged||0);
    const wUnits = parseInt(wb.total_units||0)||wGood+wDmg;
    const wTotal = parseFloat(wb.total_revenue||0);

    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mRes  = await fetch('/api/db/reports/billing?date_from='+encodeURIComponent(mtdStart.toISOString()));
    const mData = await mRes.json();
    const mb    = mData.billing||{};
    const mTotal = parseFloat(mb.total_revenue||0);
    const monthName = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});

    document.getElementById('bill-units')     && (document.getElementById('bill-units').textContent     = wUnits);
    document.getElementById('bill-total')     && (document.getElementById('bill-total').textContent     = '$'+wTotal.toFixed(2));
    document.getElementById('bill-rate')      && (document.getElementById('bill-rate').textContent      = '@ $'+CLIENT_RATES.good.toFixed(2)+'/unit');
    document.getElementById('bill-mtd')       && (document.getElementById('bill-mtd').textContent       = '$'+mTotal.toFixed(2));
    document.getElementById('bill-mtd-label') && (document.getElementById('bill-mtd-label').textContent = monthName);

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const tRes   = await fetch('/api/db/reports/billing?date_from='+encodeURIComponent(todayStart.toISOString()));
    const tData  = await tRes.json();
    const tb2    = tData.billing||{};
    const todayUnits = parseInt(tb2.total_units||0)||parseInt(tb2.total_good||0)+parseInt(tb2.total_damaged||0);
    const hoursSinceOpen = Math.max(1,(Date.now()-todayStart.getTime())/3600000);
    const uph = todayUnits>0?(todayUnits/Math.min(hoursSinceOpen,8)).toFixed(1):'0';
    document.getElementById('bill-uph')       && (document.getElementById('bill-uph').textContent       = uph);
    document.getElementById('bill-uph-label') && (document.getElementById('bill-uph-label').textContent = todayUnits+' units today');
  } catch(e){ console.error('[BillingCards]', e.message); }
}

async function renderBilling(){
  const el = document.getElementById('bill-w'); if(!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tx3)">Loading billing data...</div>';
  try {
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate()-(dow===0?6:dow-1));
    monday.setHours(0,0,0,0);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate()+5);
    saturday.setHours(23,59,59,999);
    const dateFrom = monday.toISOString();
    const dateTo   = saturday.toISOString();

    const [rRes,bRes] = await Promise.all([
      fetch('/api/db/returns/search?limit=500&date_from='+encodeURIComponent(dateFrom)+'&date_to='+encodeURIComponent(dateTo)),
      fetch('/api/db/reports/billing?date_from='+encodeURIComponent(dateFrom)+'&date_to='+encodeURIComponent(dateTo))
    ]);
    const rData   = await rRes.json();
    const bData   = await bRes.json();
    const returns = rData.returns||[];
    const billing = bData.billing||{};

    const goodRate  = CLIENT_RATES.good;
    const dmgRate   = CLIENT_RATES.damaged;
    const totalGood = parseInt(billing.total_good||0);
    const totalDmg  = parseInt(billing.total_damaged||0);
    const totalUnits= parseInt(billing.total_units||0)||totalGood+totalDmg;
    const totalRev  = parseFloat(billing.total_revenue||0);
    const weekLabel = monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+
      saturday.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

    if(returns.length===0){
      el.innerHTML='<div style="text-align:center;padding:30px;color:var(--tx3)">No returns processed this week yet</div>';
      return;
    }

    el.innerHTML=`
      <div style="background:var(--bg3);border:1px solid var(--b);border-radius:var(--rl);margin-bottom:10px;overflow:hidden">
        <div style="padding:12px 15px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-family:var(--fd);font-weight:700;font-size:14px">${weekLabel}</span>
            <span class="badge bgr">${returns.length} returns</span>
            <span class="badge bgr">${totalUnits} units</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:var(--tx3);font-family:var(--fm)">WEEK TOTAL</div>
            <div style="font-family:var(--fd);font-size:17px;font-weight:800;color:var(--Y)">$${totalRev.toFixed(2)}</div>
          </div>
        </div>
        <table class="tbl" style="margin:0;border-top:1px solid var(--b)">
          <thead><tr>
            <th>Time</th><th>Order ID</th><th>Customer</th><th>SKU(s)</th>
            <th>Condition</th><th>Rate</th><th>Subtotal</th><th>Worker</th>
          </tr></thead>
          <tbody>
            ${returns.map(r=>{
              const lis  = Array.isArray(r.line_items)?r.line_items:[];
              const skus = lis.map(li=>li.sku||'').filter(Boolean).join(', ')||r.sku_fingerprint||'—';
              const rate = r.condition==='Good'?goodRate:r.condition==='Damaged'?dmgRate:0;
              const qty  = lis.reduce((s,li)=>s+(li.quantity||1),0)||1;
              const sub  = parseFloat(r.billed_amount||(rate*qty));
              const time = new Date(r.received_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
              return `<tr>
                <td style="font-family:var(--fm);font-size:10px;color:var(--tx2)">${time}</td>
                <td class="mono" style="font-size:10px">${r.order_number}</td>
                <td style="font-size:12px">${r.customer_name}</td>
                <td style="font-family:var(--fm);font-size:10px;color:var(--Y)">${skus}</td>
                <td><span class="badge ${r.condition==='Good'?'bg':r.condition==='Damaged'?'br':'ba'}">${r.condition}</span></td>
                <td class="mono">$${rate.toFixed(2)}/unit</td>
                <td style="font-family:var(--fm);font-weight:700;color:var(--G)">$${sub.toFixed(2)}</td>
                <td style="font-family:var(--fm);font-size:11px;color:var(--B)">${r.worker_initials||'—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 15px;background:var(--Yd);border-top:1px solid var(--b)">
          <div style="font-size:12px;color:var(--tx2)">
            Good: ${totalGood}×$${goodRate.toFixed(2)}=$${(totalGood*goodRate).toFixed(2)} ·
            Damaged: ${totalDmg}×$${dmgRate.toFixed(2)}=$${(totalDmg*dmgRate).toFixed(2)}
          </div>
          <div style="font-family:var(--fd);font-size:20px;font-weight:800;color:var(--Y)">$${totalRev.toFixed(2)}</div>
        </div>
      </div>`;
    renderInvoiceHistory();
  } catch(e){
    console.error('[Billing]',e.message);
    el.innerHTML='<div style="text-align:center;padding:30px;color:var(--R)">Error loading billing: '+e.message+'</div>';
  }
}

function getInvoiceNum(monday){
  const d = new Date(Date.UTC(monday.getFullYear(),monday.getMonth(),monday.getDate()));
  const dayNum = d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d-yearStart)/86400000)+1)/7);
  return 'INV-'+monday.getFullYear()+'-W'+String(weekNo).padStart(2,'0');
}

async function exportInvoiceCSV(mondayISO, saturdayISO, invNum){
  try {
    const res     = await fetch('/api/db/returns/search?limit=500&date_from='+encodeURIComponent(mondayISO)+'&date_to='+encodeURIComponent(saturdayISO));
    const data    = await res.json();
    const returns = data.returns||[];
    if(returns.length===0){ toast('No returns for this period','e'); return; }
    const headers = ['Order','Customer','SKU(s)','Condition','Units','Rate','Subtotal','Worker','Date'];
    const rows    = returns.map(r=>{
      const lis  = Array.isArray(r.line_items)?r.line_items:[];
      const skus = lis.map(li=>li.sku||'').filter(Boolean).join('; ');
      const qty  = lis.reduce((s,li)=>s+(li.quantity||1),0)||1;
      const date = r.received_at?new Date(r.received_at).toLocaleDateString('en-US'):'';
      return [r.order_number,r.customer_name,skus,r.condition,qty,
              '$'+parseFloat(r.billing_rate||0).toFixed(2),
              '$'+parseFloat(r.billed_amount||0).toFixed(2),
              r.worker_initials||'',date
      ].map(v=>'"'+(String(v||'').replace(/"/g,'""'))+'"');
    });
    const csv  = [headers.join(','),...rows.map(r=>r.join(','))].join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = invNum+'-Paragonfitwear.csv';
    a.click();
    toast('↓ '+invNum+' downloaded','s');
  } catch(e){ toast('Export failed: '+e.message,'e'); }
}

async function renderInvoiceHistory(){
  const ih = document.getElementById('ih-tbody'); if(!ih) return;
  ih.innerHTML='';
  try {
    const weeks=[];
    const now=new Date();
    for(let w=0;w<12;w++){
      const monday=new Date(now);
      const dow=now.getDay();
      monday.setDate(now.getDate()-(dow===0?6:dow-1)-(w*7));
      monday.setHours(0,0,0,0);
      const saturday=new Date(monday);
      saturday.setDate(monday.getDate()+5);
      saturday.setHours(23,59,59,999);
      weeks.push({monday,saturday});
    }
    const results=await Promise.all(weeks.map(({monday,saturday})=>
      fetch('/api/db/reports/billing?date_from='+encodeURIComponent(monday.toISOString())+'&date_to='+encodeURIComponent(saturday.toISOString()))
        .then(r=>r.json()).then(d=>({...d.billing,monday,saturday}))
    ));
    results.forEach((w,i)=>{
      const label=w.monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+
        w.saturday.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      const good=parseInt(w.total_good||0);
      const dmg=parseInt(w.total_damaged||0);
      const total=parseFloat(w.total_revenue||0);
      const orders=parseInt(w.total_returns||0);
      const tr=ih.insertRow();
      tr.innerHTML=`
        <td style="font-family:var(--fm);color:var(--Y)">${getInvoiceNum(w.monday)}</td>
        <td>${label}</td><td>${orders}</td>
        <td style="font-family:var(--fm);font-weight:600">${parseInt(w.total_units||0)||good+dmg}</td>
        <td class="mono">$${CLIENT_RATES.good.toFixed(2)}/$${CLIENT_RATES.damaged.toFixed(2)}</td>
        <td style="font-weight:700;color:var(--G)">$${total.toFixed(2)}</td>
        <td><span class="badge ${i===0?'ba':'bg'}">${i===0?'CURRENT':'COMPLETE'}</span></td>
        <td style="font-size:11px;color:var(--tx2)">${i===0?'This week':w.saturday.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
        <td><button class="btn bs sm" onclick="exportInvoiceCSV('${w.monday.toISOString()}','${w.saturday.toISOString()}','${getInvoiceNum(w.monday)}')">↓ CSV</button></td>`;
    });
  } catch(e){ console.error('[InvoiceHistory]',e.message); }
}

function bTab(id, btn){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  ['w','h','r'].forEach(s=>{
    const el=document.getElementById('bt-'+s);
    if(el) el.style.display=s===id?'block':'none';
  });
  if(id==='w'||id==='h') renderBilling();
  if(id==='r'){ loadClientRates(); loadBillingSettings(); }
}
