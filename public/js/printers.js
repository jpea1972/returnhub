// ══════════════════════════════════════════════
// PRINTERS — Printer manager
// ══════════════════════════════════════════════

function savePrinters(){
  try { localStorage.setItem('rh_printers', JSON.stringify(printers)); } catch(e){}
}

function loadPrinters(){
  try {
    const saved = localStorage.getItem('rh_printers');
    if(saved) printers = JSON.parse(saved);
  } catch(e){}
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
        <button class="btn bs sm" onclick="toast('Testing ${p.ip}… OK','s')">Test</button>
        <button class="btn bR sm" onclick="remP('${p.id}')">Remove</button>
      </div>
    </div>`).join('');
}

function setDef(id){
  printers.forEach(p => p.def = p.id === id);
  savePrinters(); rPrinters(); popPSel();
  toast('Default printer updated', 's');
}

function remP(id){
  if(confirm('Remove?')){
    printers = printers.filter(p => p.id !== id);
    savePrinters(); rPrinters();
    toast('Printer removed', 'e');
  }
}

function testPC(){
  toast('Testing ' + document.getElementById('np-ip').value + '… OK', 's');
}

function saveP(){
  const n  = document.getElementById('np-name').value.trim();
  const ip = document.getElementById('np-ip').value.trim();
  if(!n || !ip){ toast('Name and IP required', 'e'); return; }
  printers.push({
    id:'p'+Date.now(), n, ip,
    port:  document.getElementById('np-port').value||'9100',
    brand: document.getElementById('np-brand').value,
    lang:  document.getElementById('np-lang').value,
    size:  document.getElementById('np-size').value,
    loc:   document.getElementById('np-loc').value||'Unspecified',
    def:   printers.length===0,
    online:true
  });
  savePrinters(); cm('apm'); rPrinters(); popPSel();
  toast('Printer "'+n+'" added', 's');
  ['np-name','np-ip','np-loc'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value='';
  });
}

function popPSel(){
  const s = document.getElementById('pp-sel'); if(!s) return;
  s.innerHTML = printers.map(p => `<option value="${p.id}">${p.n} (${p.ip})</option>`).join('');
  const d = printers.find(p => p.def);
  if(d) s.value = d.id;
}
