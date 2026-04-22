// ══════════════════════════════════════════════
// USERS — User management (DB-backed)
// ══════════════════════════════════════════════

async function loadUsersFromDB(){
  try {
    const res  = await fetch('/api/db/workers');
    const data = await res.json();
    if(data.success) renderUsersTable(data.workers);
  } catch(e){ console.error('[Users]', e.message); }
}

function renderUsersTable(workers){
  const tb = document.getElementById('utbody'); if(!tb) return;
  tb.innerHTML = workers.map(w => `<tr>
    <td><div style="display:flex;align-items:center;gap:8px">
      <div style="width:28px;height:28px;border-radius:50%;background:#E8FF4722;color:#E8FF47;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px">${w.initials}</div>
      <span style="font-weight:600;font-size:13px">${w.full_name}</span>
    </div></td>
    <td><span class="badge ${w.role==='Administrator'?'by':'bgr'}">${w.role||'Worker'}</span></td>
    <td style="font-family:var(--fm);color:var(--tx3)">••••</td>
    <td style="font-size:12px">All Merchants</td>
    <td><span class="badge by">${w.role==='Administrator'?'Yes':'No'}</span></td>
    <td style="font-size:11px;color:var(--tx2)">${w.last_login_at?new Date(w.last_login_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Never'}</td>
    <td><span class="badge bg">Active</span></td>
    <td><button class="btn bs sm" data-uid="${w.id}" data-name="${w.full_name}" data-initials="${w.initials}" data-billing="${w.billing||false}" data-role="${w.role||'Worker'}" onclick="openEditUser(this)">Edit</button></td>
  </tr>`).join('');
}

function openAddUser(){
  _editUserId = null;
  document.getElementById('um-title').textContent   = '+ Add Worker';
  document.getElementById('um-name').value          = '';
  document.getElementById('um-initials').value      = '';
  document.getElementById('um-pin').value           = '';
  document.getElementById('um-pin').placeholder     = 'e.g. 1234';
  document.getElementById('um-role').value          = 'Worker';
  document.getElementById('um-billing').checked     = false;
  om('user-modal');
}

function openEditUser(btn){
  const id       = btn.dataset.uid;
  const name     = btn.dataset.name;
  const initials = btn.dataset.initials;
  const billing  = btn.dataset.billing === 'true';
  const role     = btn.dataset.role || 'Worker';
  _editUserId    = id;
  document.getElementById('um-title').textContent   = '✏ Edit Worker';
  document.getElementById('um-name').value          = name;
  document.getElementById('um-initials').value      = initials;
  document.getElementById('um-pin').value           = '';
  document.getElementById('um-pin').placeholder     = 'Leave blank to keep current PIN';
  document.getElementById('um-role').value          = role;
  document.getElementById('um-billing').checked     = billing;
  om('user-modal');
}

async function saveUser(){
  const name     = document.getElementById('um-name').value.trim();
  const initials = document.getElementById('um-initials').value.trim().toUpperCase();
  const pin      = document.getElementById('um-pin').value.trim();
  const role     = document.getElementById('um-role').value;
  const billing  = document.getElementById('um-billing')?.checked || false;

  if(!name || !initials){ toast('Name and initials required', 'e'); return; }
  if(initials.length < 2 || initials.length > 3){ toast('Initials must be 2-3 characters', 'e'); return; }
  if(!_editUserId && (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))){
    toast('4-digit PIN required for new workers', 'e'); return;
  }
  if(pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))){
    toast('PIN must be exactly 4 digits', 'e'); return;
  }

  try {
    const url    = _editUserId ? '/api/db/workers/'+_editUserId : '/api/db/workers';
    const method = _editUserId ? 'PUT' : 'POST';
    const body   = {full_name:name, initials, role, billing};
    if(pin) body.pin = pin;
    const res  = await fetch(url, {
      method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    const data = await res.json();
    if(data.success){
      toast(_editUserId ? '✓ Worker updated' : '✓ Worker added', 's');
      cm('user-modal');
      loadUsersFromDB();
    } else {
      toast('Error: ' + data.error, 'e');
    }
  } catch(e){ toast('Error: ' + e.message, 'e'); }
}
