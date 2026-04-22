// ══════════════════════════════════════════════
// SYNC — Return Rabbit API, DB cache, sync log
// ══════════════════════════════════════════════

function getAuthHeaders(){
  return {'Content-Type':'application/json'};
}

function saveRRToken(){
  const store = document.getElementById('rr-store')?.value.trim() || 'paragonfitwear';
  RR_CONFIG.store = store;
  toast('Connecting via server — testing…', 's');
  testRRConnection();
}

function toggleToken(){
  const inp = document.getElementById('rr-token');
  const btn = document.getElementById('tok-vis-btn');
  if(!inp) return;
  if(inp.type === 'password'){ inp.type = 'text'; if(btn) btn.textContent = 'Hide'; }
  else { inp.type = 'password'; if(btn) btn.textContent = 'Show'; }
}

async function testRRConnection(){
  setRRStatus('testing');
  try {
    const healthRes = await fetch('/api/health');
    if(!healthRes.ok) throw new Error('ReturnHub server not reachable — is it running?');
    const health = await healthRes.json();
    if(!health.rrConfigured) throw new Error('RR_TOKEN not in server .env — add it and restart');
    const rrRes = await fetch(`${RR_CONFIG.baseUrl}/api/v1/service-requests/?page=1`, {
      headers: getAuthHeaders(),
    });
    if(rrRes.ok){
      RR_CONFIG.connected = true;
      setRRStatus('connected');
      toast('✓ Return Rabbit connected!', 's');
      addSyncLog('Connection test', 'success', 'Server proxy → Return Rabbit OK');
      fetchRR();
    } else {
      const txt = await rrRes.text();
      throw new Error(`Return Rabbit HTTP ${rrRes.status}: ${txt.substring(0,100)}`);
    }
  } catch(e){
    RR_CONFIG.connected = false;
    setRRStatus('error');
    toast(`✗ ${e.message.substring(0,80)}`, 'e');
    addSyncLog('Connection test', 'error', e.message.substring(0,140));
  }
}

function setRRStatus(state){
  const dot    = document.getElementById('rr-sdot');
  const txt    = document.getElementById('rr-status-txt');
  const bdot   = document.getElementById('rr-banner-dot');
  const btitle = document.getElementById('rr-banner-title');
  const bsub   = document.getElementById('rr-banner-sub');
  const banner = document.getElementById('rr-conn-banner');
  const cfgs = {
    connected:    {dot:'var(--G)',anim:true, txt:'Return Rabbit ✓',bg:'rgba(34,212,106,.08)', bdr:'rgba(34,212,106,.25)', bt:'Connected',         bs:'Live sync active — data flowing from returnrabbit.app'},
    error:        {dot:'var(--R)',anim:false,txt:'RR Offline',      bg:'rgba(240,69,69,.08)',  bdr:'rgba(240,69,69,.25)',  bt:'Connection failed', bs:'Check RR_TOKEN in server .env then restart'},
    testing:      {dot:'var(--A)',anim:true, txt:'Connecting…',     bg:'rgba(245,166,35,.08)', bdr:'rgba(245,166,35,.25)', bt:'Testing…',          bs:'Connecting to Return Rabbit via server proxy'},
    syncing:      {dot:'var(--B)',anim:true, txt:'Syncing…',        bg:'rgba(79,142,247,.08)', bdr:'rgba(79,142,247,.25)', bt:'Syncing',           bs:'Fetching latest RMAs from Return Rabbit'},
    disconnected: {dot:'var(--tx3)',anim:false,txt:'Return Rabbit', bg:'rgba(74,82,112,.1)',   bdr:'var(--b2)',            bt:'Not connected',     bs:'Add RR_TOKEN to server .env and restart, then click Test Connection'},
  };
  const c = cfgs[state] || cfgs.disconnected;
  if(dot){
    dot.style.background  = c.dot;
    dot.style.boxShadow   = c.anim ? `0 0 4px ${c.dot}` : 'none';
    dot.style.animation   = c.anim ? 'bl 1.5s infinite' : 'none';
  }
  if(txt)    txt.textContent    = c.txt;
  if(bdot)   bdot.style.background = c.dot;
  if(btitle) btitle.textContent = c.bt;
  if(bsub)   bsub.textContent   = c.bs;
  if(banner){ banner.style.background = c.bg; banner.style.borderColor = c.bdr; }
}

async function loadDBCache(){
  if(rrSyncLock){ console.log('[Cache] locked'); return; }
  rrSyncLock = true;
  setRRStatus('syncing');
  try {
    const mid = activeMerchantId || '';
    const res  = await fetch('/api/db/cache' + (mid ? '?merchant_id=' + mid : ''), { cache:'no-store' });
    if(!res.ok) throw new Error('DB cache HTTP ' + res.status);
    const data = await res.json();
    if(!data.success) throw new Error(data.error || 'Cache load failed');

    RETURNS.length = 0;
    const rows = data.returns || [];

    if(rows.length === 0){
      setRRStatus('connected');
      addSyncLog('DB Cache', 'success', 'No unprocessed returns — run Sync Now to populate');
      toast('⚠ No returns in DB — Admin: RR Integration > Sync Now', 'w');
      rRR(); rQueue();
      return;
    }

    for(const row of rows){
      const lineItems = typeof row.line_items === 'string'
        ? JSON.parse(row.line_items)
        : (row.line_items || []);
      RETURNS.push({
        id:       row.order_number,
        bc:       row.tracking_number || row.order_number || '',
        cust:     row.customer_name || '',
        items:    lineItems.length > 0 ? lineItems.map(li => ({
          sku:   li.sku   || '--',
          desc:  [li.product_name, li.variant].filter(Boolean).join(' - ') || li.name || '--',
          qty:   parseInt(li.quantity || 1),
          image: li.image_url || '',
          price: parseFloat(li.payment_detail?.amount || 0),
        })) : [{sku:'--', desc:'No items', qty:1, image:'', price:0}],
        reason:   lineItems[0]?.reason || '--',
        rma:      row.rr_name || row.order_number,
        rrid:     row.rr_id   || row.order_number,
        track:    row.tracking_number || '--',
        date:     row.rr_created_at
                    ? new Date(row.rr_created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})
                    : '--',
        shipDate: '--',
        daysHeld: 0,
        status:   'pending',
        val:      0,
        photo:    lineItems[0]?.image_url || '',
        _sku_fingerprint: row.sku_fingerprint || '',
        _rr_created_at:   row.rr_created_at   || null,
        _carrier:         row.carrier          || 'USPS',
        _customer_zip:    row.customer_zip     || null,
      });
    }

    buildReturnsIndex();
    RR_CONFIG.connected = true;
    RR_CONFIG.lastSync  = new Date();
    setRRStatus('connected');
    addSyncLog('DB Cache loaded', 'success', rows.length + ' unprocessed returns loaded');
    toast('↻ ' + rows.length + ' returns loaded', 's');
    rRR(); rQueue();
    updateTopStats(rows.length);

  } catch(e){
    setRRStatus('error');
    addSyncLog('Cache error', 'error', e.message);
    toast('Cache error: ' + e.message.substring(0,60), 'e');
    console.error('[Cache Error]', e);
  } finally {
    rrSyncLock = false;
  }
}

async function fetchRR(){
  try {
    toast('Triggering incremental sync...', 's');
    const res  = await fetch('/api/db/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({merchant_id: activeMerchantId || 1})});
    const data = await res.json();
    if(data.success){
      addSyncLog('Incremental sync', 'success', data.records_added + ' new records, ' + data.pages_fetched + ' pages');
      toast('Sync complete: ' + data.records_added + ' new records', 's');
    } else {
      addSyncLog('Sync error', 'error', data.error || 'Unknown error');
    }
  } catch(e){
    addSyncLog('Sync trigger error', 'error', e.message);
    toast('Sync failed: ' + e.message.substring(0,50), 'e');
  }
  await loadDBCache();
}

function buildReturnsIndex(){
  RETURNS_INDEX = {};
  RETURNS.forEach(r => {
    const t = r.track;
    if(t && t !== '--' && t !== ''){
      if(!RETURNS_INDEX[t]) RETURNS_INDEX[t] = [];
      RETURNS_INDEX[t].push(r);
    }
  });
  console.log('[Index] Built with ' + Object.keys(RETURNS_INDEX).length + ' tracking keys');
}

function mapRRReturn(rma){
  const lineItems = rma.line_items || [];
  const items = lineItems.map(li => ({
    sku:   li.sku || '—',
    desc:  [li.product_name, li.variant].filter(Boolean).join(' - ') || li.name || '—',
    qty:   parseInt(li.quantity || 1),
    image: li.image_url || li.product_image || '',
    price: parseFloat(li.payment_detail?.amount || rma.amount || 0),
  }));
  const tracking = rma.fulfillment_details?.tracking_number || '';
  const ship     = rma.shipping_information || {};
  const custName = ship.name || [ship.first_name, ship.last_name].filter(Boolean).join(' ') || ship.email || '—';
  const rrStatus = (rma.status || '').toLowerCase();
  const statusMap = {
    'pending delivery':'pending','pending':'pending','label created':'pending',
    'in transit':'pending','out for delivery':'pending','delivered':'arrived',
    'received':'arrived','processing':'arrived','completed':'processed',
    'refunded':'processed','closed':'processed','cancelled':'flagged','rejected':'flagged',
  };
  const rmaRaw = rma.created || rma.created_at || null;
  const fmtDate = raw => raw ? new Date(raw).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const reason  = lineItems[0]?.reason || '—';
  return {
    id:       rma.order || rma.ecom_order_id || rma.name || rma.id || '—',
    bc:       tracking,
    cust:     custName,
    items:    items.length > 0 ? items : [{sku:'—',desc:'No items',qty:1,image:'',price:0}],
    reason,
    rma:      rma.name || `RMA-${String(rma.id).substring(0,8)}`,
    rrid:     `RR-${rma.id}`,
    track:    tracking || '—',
    date:     fmtDate(rmaRaw),
    shipDate: rma.fulfillment_details?.status === 'DELIVERED' ? 'Delivered' : 'In Transit',
    daysHeld: 0,
    status:   statusMap[rrStatus] || 'pending',
    val:      Math.abs(parseFloat(rma.amount || 0)),
    photo:    items[0]?.image || '',
    _raw:     rma,
  };
}

async function addSyncLog(action, status, detail){
  try {
    const res  = await fetch('/api/db/health');
    const data = await res.json();
    if(data.last_sync){
      const ls  = data.last_sync;
      const lst = document.getElementById('last-sync-time');
      const el  = document.getElementById('sync-log');
      if(lst){
        const d = new Date(ls.last_sync_run_at);
        lst.textContent = 'Last sync: ' + d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      }
      if(el){
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--b)">
            <div style="font-size:13px;color:var(--tx2)">Status</div>
            <span class="badge ${ls.status==='success'?'bg':'br'}">${ls.status.toUpperCase()}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--b)">
            <div style="font-size:13px;color:var(--tx2)">Records Added</div>
            <div style="font-family:var(--fm);font-weight:600">${ls.records_added||0}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px">
            <div style="font-size:13px;color:var(--tx2)">Run At</div>
            <div style="font-size:12px;color:var(--tx2)">${new Date(ls.last_sync_run_at).toLocaleString()}</div>
          </div>`;
      }
    }
  } catch(e){ console.error('[SyncLog]', e.message); }

  const el = document.getElementById('sync-log'); if(!el) return;
  const color = status==='success' ? 'var(--G)' : status==='error' ? 'var(--R)' : 'var(--A)';
  const icon  = status==='success' ? '✓' : status==='error' ? '✗' : '⚑';
  const entry = document.createElement('div');
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--b);font-size:12px';
  entry.innerHTML = `<span style="color:${color};font-weight:700;flex-shrink:0">${icon}</span><span style="color:var(--tx2);font-family:var(--fm);font-size:11px;flex-shrink:0">${new Date().toLocaleTimeString()}</span><span style="font-weight:500">${action}</span><span style="color:var(--tx2);flex:1;overflow:hidden;text-overflow:ellipsis">${detail}</span>`;
  const ph = el.querySelector('[style*="text-align:center"]');
  if(ph) ph.remove();
  el.insertBefore(entry, el.firstChild);
  while(el.children.length > 20) el.removeChild(el.lastChild);
  const lst = document.getElementById('last-sync-time');
  if(lst && RR_CONFIG.lastSync) lst.textContent = 'Last sync: ' + RR_CONFIG.lastSync.toLocaleTimeString();
}

function renderEndpointList(){
  const el = document.getElementById('endpoint-list'); if(!el) return;
  el.innerHTML = RR_ENDPOINTS.map(e => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:1px solid var(--b)">
      <span style="background:${e.method==='GET'?'rgba(34,212,106,.14)':'rgba(245,166,35,.14)'};color:${e.method==='GET'?'var(--G)':'var(--A)'};font-family:var(--fm);font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;flex-shrink:0;min-width:46px;text-align:center">${e.method}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fm);font-size:12px;color:var(--Y);margin-bottom:2px">${e.path}</div>
        <div style="font-size:12px;color:var(--tx2)">${e.desc}</div>
      </div>
      <span style="font-size:11px;color:var(--tx3);flex-shrink:0;text-align:right;max-width:140px">${e.used}</span>
    </div>`).join('');
}

function updateTopStats(n){
  const el = document.getElementById('s1');
  if(el && n > 0) el.textContent = n;
}

function startAutoSync(){
  if(rrSyncTimer) clearInterval(rrSyncTimer);
}
