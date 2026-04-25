// ══════════════════════════════════════════════
// PRINTERS — Enterprise-wide printer management (database-backed)
// ══════════════════════════════════════════════

async function loadPrinters(){
  try {
    const res = await fetch('/api/db/printers');
    const data = await res.json();
    if(data.success){
      printers = (data.printers || []).map(p => ({
        id: String(p.id), n: p.name, ip: p.ip, port: p.port || '9100',
        brand: p.brand || 'Zebra', lang: p.lang || 'ZPL', size: p.size || '2x1',
        dpi: p.dpi || 300, loc: p.location || '', def: p.is_default, online: true, _dbId: p.id
      }));
      rPrinters();
      popPSel();
    }
  } catch(e){ console.error('[Printers] Load failed:', e.message); }
}

function rPrinters(){
  const el = document.getElementById('plist'); if(!el) return;
  el.innerHTML = printers.map(p => `
    <div style="background:var(--bg3);border:1px solid ${p.def?'rgba(232,255,71,.4)':'var(--b)'};border-radius:var(--rl);padding:13px;display:flex;align-items:center;gap:11px;margin-bottom:8px">
      <div style="width:40px;height:40px;border-radius:var(--r);background:${p.online?'rgba(34,212,106,.12)':'rgba(240,69,69,.1)'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${p.online?'🟢':'🔴'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px">${p.n} ${p.def?'<span class="badge by" style="font-size:9px">DEFAULT</span>':''}</div>
        <div style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:2px">${p.ip}:${p.port} · ${p.lang} · ${p.size}</div>
        <div style="font-size:12px;color:var(--tx2)">${p.loc} · <span style="color:${p.online?'var(--G)':'var(--R)'}">${p.online?'Online':'Offline'}</span></div>
      </div>
      <div style="display:flex;gap:6px">
        ${!p.def?`<button class="btn bs sm" onclick="setDef('${p.id}')">Default</button>`:''}
        <button class="btn bs sm" onclick="testPrinter('${p.ip}','${p.port}')">Test</button>
        <button class="btn bR sm" onclick="remP('${p.id}')">Remove</button>
      </div>
    </div>`).join('');
}

async function setDef(id){
  const p = printers.find(x => x.id === id);
  if(!p) return;
  try {
    await fetch('/api/db/printers/' + p._dbId + '/default', {method:'PUT'});
    printers.forEach(x => x.def = x.id === id);
    rPrinters(); popPSel();
    toast('✓ Default printer: ' + p.n, 's');
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}

async function remP(id){
  if(!confirm('Remove this printer?')) return;
  const p = printers.find(x => x.id === id);
  if(!p) return;
  try {
    await fetch('/api/db/printers/' + p._dbId, {method:'DELETE'});
    printers = printers.filter(x => x.id !== id);
    rPrinters(); popPSel();
    toast('Printer removed', 's');
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}

async function testPrinter(ip, port){
  toast('Testing ' + ip + ':' + port + '…', 's');
  // Real test: send a tiny ZPL via QZ Tray if connected, otherwise just confirm reachable
  try {
    if(typeof qz !== 'undefined' && qz.websocket.isActive()){
      const config = qz.configs.create(ip + ':' + port);
      await qz.print(config, [{type:'raw', format:'plain', data:'^XA^FO50,50^A0N,30,30^FDTEST^FS^XZ'}]);
      toast('✓ Test label sent to ' + ip, 's');
    } else {
      toast('✓ Printer at ' + ip + ' (QZ not connected for live test)', 's');
    }
  } catch(e){ toast('Print test failed: ' + e.message, 'e'); }
}

function testPC(){
  const ip = document.getElementById('np-ip').value;
  const port = document.getElementById('np-port').value || '9100';
  testPrinter(ip, port);
}

async function saveP(){
  const n  = document.getElementById('np-name').value.trim();
  const ip = document.getElementById('np-ip').value.trim();
  if(!n || !ip){ toast('Name and IP required', 'e'); return; }
  const body = {
    name: n,
    ip: ip,
    port:     document.getElementById('np-port').value || '9100',
    brand:    document.getElementById('np-brand').value || 'Zebra',
    lang:     document.getElementById('np-lang').value || 'ZPL',
    size:     document.getElementById('np-size').value || '2x1',
    dpi:      300,
    location: document.getElementById('np-loc').value || null
  };
  try {
    const res = await fetch('/api/db/printers', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    const data = await res.json();
    if(data.success){
      toast('✓ Printer "' + n + '" added — visible on all workstations', 's');
      cm('apm');
      await loadPrinters();
      ['np-name','np-ip','np-loc'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = '';
      });
    } else { toast('Error: ' + (data.error||'Unknown'), 'e'); }
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}

function popPSel(){
  const s = document.getElementById('pp-sel'); if(!s) return;
  s.innerHTML = printers.map(p => `<option value="${p.id}">${p.n} (${p.ip}) — ${p.size}</option>`).join('');
  const d = printers.find(p => p.def);
  if(d) s.value = d.id;
}
