// ══════════════════════════════════════════════
// AUTH — Login, logout, session management
// ══════════════════════════════════════════════

async function buildUCards(){
  try {
    const res  = await fetch('/api/db/workers');
    const data = await res.json();
    if(data.success && data.workers.length > 0) dbWorkers = data.workers;
  } catch(e){
    console.warn('[Login] Could not load workers from DB, using fallback');
  }

  const colors  = ['#4F8EF7','#22D46A','#F04545','#F5A623','#9B6FF7','#E8FF47','#FF6B6B','#4ECDC4','#45B7D1','#96CEB4'];
  const workers = dbWorkers.length > 0
    ? dbWorkers
    : USERS.map(u => ({ id: u.id, full_name: u.n, initials: u.i, role: u.role }));

  document.getElementById('ucards').innerHTML = workers.map((w, idx) => {
    const color = colors[idx % colors.length];
    return `<div class="uc" onclick="selU2('${w.id}','${w.full_name}','${w.initials}','${w.role||'Worker'}')">
      <div class="ucav" style="background:${color}22;color:${color}">${w.initials}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:1px">${w.full_name}</div>
      <div style="font-size:10px;color:var(--tx3)">${w.role||'Worker'}</div>
    </div>`;
  }).join('');
}

function selU2(id, name, initials, role){
  selU = { id, n: name, i: initials, role };
  document.getElementById('ucards').style.display = 'none';
  document.getElementById('pinsec').style.display = 'block';
  document.getElementById('pinlbl').innerHTML = `PIN for <strong style="color:var(--Y)">${name}</strong>`;
  document.getElementById('pin').value = '';
  document.getElementById('pin').focus();
}

function selStation(s){
  selStation_val = s;
  document.getElementById('sta-a').style.borderColor = s==='A' ? 'var(--Y)' : 'var(--b2)';
  document.getElementById('sta-b').style.borderColor = s==='B' ? 'var(--Y)' : 'var(--b2)';
}

function cancelLogin(){
  selU = null; selStation_val = null;
  document.getElementById('ucards').style.display = 'grid';
  document.getElementById('pinsec').style.display = 'none';
  if(document.getElementById('sta-a')) document.getElementById('sta-a').style.borderColor = 'var(--b2)';
  if(document.getElementById('sta-b')) document.getElementById('sta-b').style.borderColor = 'var(--b2)';
}

async function doLogin(){
  const pin = document.getElementById('pin').value;
  if(!pin){ toast('Enter your PIN', 'e'); return; }
  if(!selStation_val){ toast('Select Station A or B first', 'e'); return; }
  const btn = document.querySelector('#pinsec .btn.bY');
  if(btn){ btn.textContent = 'Signing in...'; btn.disabled = true; }
  try {
    const res  = await fetch('/api/db/sessions/start', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ initials: selU.i, pin, station: selStation_val, ip_address: null })
    });
    const data = await res.json();
    if(!res.ok || !data.success){
      toast(data.error || 'Login failed', 'e');
      document.getElementById('pin').style.borderColor = 'var(--R)';
      document.getElementById('pin').value = '';
      setTimeout(() => document.getElementById('pin').style.borderColor = '', 1200);
      return;
    }
    dbSessionId      = data.session_id;
    sessionStartTime = new Date();
    dbWorkerId       = data.worker.id;
    cu = USERS.find(u => u.i === data.worker.initials) || selU;

    document.getElementById('ls').style.display  = 'none';
    document.getElementById('sb').style.display  = 'flex';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('sav').textContent        = cu.i;
    document.getElementById('sav').style.background   = cu.c + '22';
    document.getElementById('sav').style.color        = cu.c;
    document.getElementById('sname').textContent      = cu.n;
    document.getElementById('srole').textContent      = cu.role + ' · Station ' + selStation_val;

    const role      = data.worker.role || 'Worker';
    const isSenior  = role === 'Senior Worker';
    const isAdmin   = role === 'Administrator' || role === 'Admin';
    const showBilling = isAdmin || isSenior || data.worker.billing;

    const navBilling = document.getElementById('nav-billing');
    if(navBilling) navBilling.style.display = showBilling ? '' : 'none';

    ['nav-bi','nav-dh'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = (isAdmin || isSenior) ? '' : 'none';
    });
    ['nav-email','nav-merchants','nav-rrsettings','nav-users'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = isAdmin ? '' : 'none';
    });

    initApp();
    toast('👋 Welcome, ' + cu.n + ' — Station ' + selStation_val, 's');
    setTimeout(() => {
      loadDBCache();
      loadClientRates();
      updateScanStats();
      updateBillingCards();
      updateRRStats();
      updateLiveLeaderboard();
    }, 800);
  } catch(e){
    toast('Server error: ' + e.message, 'e');
    console.error('[Login Error]', e);
  } finally {
    if(btn){ btn.textContent = 'Sign In →'; btn.disabled = false; }
  }
}

document.getElementById('pin').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });

async function logout(){
  if(dbSessionId){
    try {
      await fetch('/api/db/sessions/' + dbSessionId + '/end', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ total_returns: myCount })
      });
    } catch(e){ console.error('[Logout]', e); }
  }
  cu = null; dbSessionId = null; dbWorkerId = null; selStation_val = null;
  rrSyncLock = false; RETURNS.length = 0; RETURNS_INDEX = {}; PROCESSED_LOG = [];
  myCount = 0;

  ['nav-billing','nav-bi','nav-dh','nav-email','nav-merchants','nav-rrsettings','nav-users'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });

  document.getElementById('ls').style.display  = 'flex';
  document.getElementById('sb').style.display  = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('ucards').style.display = 'grid';
  document.getElementById('pinsec').style.display = 'none';
  if(document.getElementById('sta-a')) document.getElementById('sta-a').style.borderColor = 'var(--b2)';
  if(document.getElementById('sta-b')) document.getElementById('sta-b').style.borderColor = 'var(--b2)';
}
