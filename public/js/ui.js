// ══════════════════════════════════════════════
// UI — Navigation, modals, toast, clock
// ══════════════════════════════════════════════

function om(id){ document.getElementById(id).classList.add('open'); if(id==='emo') renderEmailDisplay(); }
function cm(id){ document.getElementById(id).classList.remove('open'); }

function toast(msg, type='s'){
  const t = document.getElementById('tst');
  t.className = 'toast ' + type;
  t.innerHTML = (type==='s' ? '<span style="color:var(--G)">✓</span>' :
                 type==='e' ? '<span style="color:var(--R)">!</span>' :
                              '<span style="color:var(--A)">⚑</span>') + ' ' + msg;
  t.classList.add('show');
  clearTimeout(window._t);
  window._t = setTimeout(() => t.classList.remove('show'), 3500);
}

function updateClock(){
  document.getElementById('clk').textContent = new Date().toLocaleTimeString('en-US', {hour12:false});
}

setInterval(updateClock, 1000);

const TITLES = {
  scan:       'Scan & Process',
  rrsettings: 'Return Rabbit Integration',
  queue:      'Return Queue',
  rr:         'Return Rabbit Feed',
  flags:      'Returns Report',
  bi:         'Productivity Dashboard',
  dh:         'Days Held Analysis',
  billing:    'Billing & Invoices',
  email:      'Email Reports',
  printers:   'Printer Manager',
  merchants:  'Merchants',
  users:      'Users & Access',
};

function nav(id){
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + id);
  const navEl = document.getElementById('nav-' + id);
  if(tabEl) tabEl.classList.add('active');
  if(navEl) navEl.classList.add('active');
  document.getElementById('ptitle').textContent = TITLES[id] || id;
  if(id==='rrsettings'){ renderEndpointList(); setRRStatus(RR_CONFIG.connected ? 'connected' : 'disconnected'); }
  if(id==='billing')   { renderBilling(); loadClientRates(); updateBillingCards(); }
  if(id==='flags')     { rFlags(); }
  if(id==='users')     { loadUsersFromDB(); }
  if(id==='queue')     { loadProcessedReturns().then(() => rQueue()); }
  if(id==='dh')        { renderDaysHeld(); }
  if(id==='bi')        { setProductivityToday(); }
  if(id==='rr')        { updateRRStats(); }
}

function initApp(){
  updateClock();
  rQueue();
  rRR();
  rFlags();
  renderBilling();
  rPrinters();
  renderBI();
  renderDH();
  renderMerchants();
  renderEmailDisplay();
  popPSel();
  setTimeout(() => { renderEndpointList(); setRRStatus('disconnected'); }, 200);
}

function onBK(e){ if(e.key === 'Enter') procScan(e.target.value.trim()); }
function onBI(i){ clearTimeout(window._bc); if(i.value.length > 8) window._bc = setTimeout(() => procScan(i.value.trim()), 270); }

document.addEventListener('keydown', e => {
  if(e.key === 'F2'){
    const r = RETURNS[Math.floor(Math.random() * RETURNS.length)];
    if(r) procScan(r.bc);
  }
});
