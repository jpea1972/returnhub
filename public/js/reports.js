// ══════════════════════════════════════════════
// REPORTS — Productivity, days held, scan stats
// ══════════════════════════════════════════════

async function updateRRStats(){
  try {
    const res  = await fetch('/api/db/rr-stats');
    const data = await res.json();
    if(data.success){
      document.getElementById('rr-open')      && (document.getElementById('rr-open').textContent      = data.open_rmas);
      document.getElementById('rr-transit')   && (document.getElementById('rr-transit').textContent   = data.in_transit);
      document.getElementById('rr-arrived')   && (document.getElementById('rr-arrived').textContent   = data.arrived_today);
      document.getElementById('rr-completed') && (document.getElementById('rr-completed').textContent = data.completed);
    }
  } catch(e){ console.error('[RRStats]', e.message); }
}

async function renderDaysHeld(){
  try {
    const res  = await fetch('/api/db/days-held');
    const data = await res.json();
    if(!data.success) return;
    const s = data.summary;
    const cards = {'dh-total':s.total,'dh-green':s.green,'dh-amber':s.amber,'dh-red':s.red,'dh-avg':s.avg_days+'d'};
    Object.entries(cards).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.textContent=val; });
    const tb = document.getElementById('dh-tbody'); if(!tb) return;
    if(data.rows.length===0){
      tb.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--tx3)">No pending returns</td></tr>';
      return;
    }
    tb.innerHTML=data.rows.map(r=>{
      const lis=Array.isArray(r.line_items)?r.line_items:[];
      const skus=lis.map(li=>li.sku||'').filter(Boolean).join(', ')||'—';
      const reason=lis[0]?.reason||'—';
      const chipClass=r.status==='green'?'dg2':r.status==='amber'?'da':'dr';
      const created=new Date(r.rr_created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      return `<tr>
        <td class="mono" style="font-size:10px">${r.order_number}</td>
        <td style="font-size:12px">${r.customer_name||'—'}</td>
        <td style="font-family:var(--fm);font-size:10px;color:var(--Y)">${skus}</td>
        <td style="font-size:11px;color:var(--tx2)">${reason}</td>
        <td style="font-size:11px">${created}</td>
        <td><span class="dchip ${chipClass}">${r.days_held}d</span></td>
      </tr>`;
    }).join('');
  } catch(e){ console.error('[DaysHeld]', e.message); }
}

function setProductivityToday(){
  const today = new Date().toLocaleDateString('en-CA');
  document.getElementById('prod-date-from').value = today;
  document.getElementById('prod-date-to').value   = today;
  loadProductivity();
}

function setProductivityWeek(){
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate()-(dow===0?6:dow-1));
  document.getElementById('prod-date-from').value = monday.toISOString().slice(0,10);
  document.getElementById('prod-date-to').value   = now.toISOString().slice(0,10);
  loadProductivity();
}

async function loadProductivity(){
  const from = document.getElementById('prod-date-from')?.value;
  const to   = document.getElementById('prod-date-to')?.value;
  if(!from){ toast('Select a date range','e'); return; }
  try {
    const dateFrom = new Date(from).toISOString();
    const dateTo   = to?new Date(to+'T23:59:59').toISOString():new Date(from+'T23:59:59').toISOString();
    const res  = await fetch('/api/db/reports/productivity-summary?date_from='+encodeURIComponent(dateFrom)+'&date_to='+encodeURIComponent(dateTo));
    const data = await res.json();
    if(!data.success) return;
    const workers      = data.workers||[];
    const totalUnits   = workers.reduce((s,w)=>s+parseInt(w.total_units||0),0);
    const totalReturns = workers.reduce((s,w)=>s+parseInt(w.total_returns||0),0);
    const totalRev     = workers.reduce((s,w)=>s+parseFloat(w.total_revenue||0),0);
    document.getElementById('prod-units')   && (document.getElementById('prod-units').textContent   = totalUnits);
    document.getElementById('prod-returns') && (document.getElementById('prod-returns').textContent = totalReturns);
    document.getElementById('prod-revenue') && (document.getElementById('prod-revenue').textContent = '$'+totalRev.toFixed(2));
    document.getElementById('prod-workers') && (document.getElementById('prod-workers').textContent = workers.length);
    const label = from===to
      ? new Date(from).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})
      : from+' – '+to;
    document.getElementById('prod-period-label') && (document.getElementById('prod-period-label').textContent = label);
    document.getElementById('prod-units-sub')    && (document.getElementById('prod-units-sub').textContent    = label);
    const tb = document.getElementById('prod-tbody'); if(!tb) return;
    if(workers.length===0){
      tb.innerHTML='<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--tx3)">No activity for this period</td></tr>';
      return;
    }
    tb.innerHTML=workers.map((w,i)=>{
      const units=parseInt(w.total_units||0);
      const returns=parseInt(w.total_returns||0);
      const revenue=parseFloat(w.total_revenue||0);
      const good=parseInt(w.good_count||0);
      const damaged=parseInt(w.damaged_count||0);
      const notRet=parseInt(w.not_returned_count||0);
      const hours=Math.max(0.1,parseFloat(w.hours_active||0));
      const uph=(units/Math.max(0.1,hours)).toFixed(1);
      const activeTime=hours<1?Math.round(hours*60)+'m':hours.toFixed(1)+'h';
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      return `<tr>
        <td style="text-align:center;font-size:16px">${medal||'#'+(i+1)}</td>
        <td><div style="display:flex;align-items:center;gap:7px">
          <div style="width:26px;height:26px;border-radius:50%;background:#E8FF4722;color:#E8FF47;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px">${w.initials}</div>
          <span style="font-weight:600">${w.full_name}</span>
        </div></td>
        <td style="font-family:var(--fm);font-weight:700;color:var(--G);font-size:15px">${units}</td>
        <td style="font-family:var(--fm)">${returns}</td>
        <td style="font-weight:600;color:var(--Y)">$${revenue.toFixed(2)}</td>
        <td style="font-family:var(--fm);color:var(--G)">${good}</td>
        <td style="font-family:var(--fm);color:var(--R)">${damaged}</td>
        <td style="font-family:var(--fm);color:var(--tx3)">${notRet}</td>
        <td><span class="badge ${parseFloat(uph)>=30?'bg':parseFloat(uph)>=20?'by':'bgr'}">${uph}/hr</span></td>
        <td style="font-size:11px;color:var(--tx2)">${activeTime}</td>
      </tr>`;
    }).join('');
  } catch(e){ console.error('[Productivity]', e.message); }
}

async function updateLiveLeaderboard(){
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const res   = await fetch('/api/db/reports/productivity-summary?date_from='+encodeURIComponent(new Date(today).toISOString())+'&date_to='+encodeURIComponent(new Date(today+'T23:59:59').toISOString()));
    const data  = await res.json();
    if(!data.success) return;
    const workers   = data.workers||[];
    const board     = document.getElementById('leaderboard-rows');
    const container = document.getElementById('live-leaderboard');
    if(!board||!container) return;
    if(workers.length===0){ container.style.display='none'; return; }
    container.style.display='block';
    board.innerHTML=workers.slice(0,5).map((w,i)=>{
      const units=parseInt(w.total_units||0);
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      const isMe=w.worker_id==dbWorkerId;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:${isMe?'rgba(232,255,71,.06)':'var(--bg3)'};border-radius:var(--r);border:1px solid ${isMe?'rgba(232,255,71,.2)':'var(--b)'}">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:14px">${medal||'#'+(i+1)}</span>
          <div style="width:22px;height:22px;border-radius:50%;background:#E8FF4722;color:#E8FF47;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:9px">${w.initials}</div>
          <span style="font-size:12px;font-weight:${isMe?700:400}">${w.full_name}</span>
        </div>
        <span style="font-family:var(--fm);font-weight:700;color:var(--G)">${units} units</span>
      </div>`;
    }).join('');
  } catch(e){}
}

async function updateScanStats(){
  try {
    const today=new Date(); today.setHours(0,0,0,0);
    const todayEnd=new Date(); todayEnd.setHours(23,59,59,999);
    const res  = await fetch('/api/db/reports/billing?date_from='+encodeURIComponent(today.toISOString())+'&date_to='+encodeURIComponent(todayEnd.toISOString()));
    const data = await res.json();
    const b    = data.billing||{};
    const totalToday=parseInt(b.total_units||0)||parseInt(b.total_returns||0);
    const pending=RETURNS.length;
    const nonGood=parseInt(b.total_damaged||0)+parseInt(b.total_not_returned||0);
    document.getElementById('s1').textContent=totalToday+pending;
    document.getElementById('s1s')&&(document.getElementById('s1s').textContent=totalToday+' processed today');
    document.getElementById('s2').textContent=totalToday;
    document.getElementById('s3').textContent=pending;
    document.getElementById('s4').textContent=nonGood;
    if(dbWorkerId&&sessionStartTime){
      const wRes=await fetch('/api/db/reports/productivity?worker_id='+dbWorkerId+'&date_from='+encodeURIComponent(today.toISOString())+'&date_to='+encodeURIComponent(todayEnd.toISOString()));
      const wData=await wRes.json();
      const rows=wData.rows||[];
      const myUnits=rows.reduce((s,r)=>s+parseInt(r.units_processed||r.returns_processed||0),0);
      const sessionHours=Math.max(0.1,(Date.now()-sessionStartTime.getTime())/3600000);
      const myUph=(myUnits/sessionHours).toFixed(1);
      document.getElementById('s5').textContent=myCount;
      document.getElementById('s5s')&&(document.getElementById('s5s').textContent=myUph+' units/hr');
    }
  } catch(e){ console.error('[Stats]', e.message); }
}

function renderBI(){
  const ll=document.getElementById('bi-launches'); if(!ll) return;
  if(BI_DATA.length===0){ ll.innerHTML='<div style="text-align:center;padding:20px;color:var(--tx3)">No BI data available</div>'; }
}

function renderDH(){
  const tb=document.getElementById('dh-tbody'); if(!tb) return;
  if(DAYS_HELD.length===0){ tb.innerHTML='<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--tx3)">Loading from database…</td></tr>'; }
}
