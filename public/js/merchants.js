// ══════════════════════════════════════════════
// MERCHANTS — Merchant management and switching
// ══════════════════════════════════════════════

async function loadMerchants() {
  try {
    const res = await fetch('/api/db/merchants');
    const data = await res.json();
    if (data.success) {
      dbMerchants = data.merchants || [];
      // Set active merchant if not set
      if (!activeMerchantId && dbMerchants.length > 0) {
        const saved = localStorage.getItem('rh_active_merchant');
        activeMerchantId = saved ? parseInt(saved) : dbMerchants[0].id;
      }
      activeMerchant = dbMerchants.find(m => m.id === activeMerchantId) || dbMerchants[0] || null;
      if (activeMerchant) {
        activeMerchantId = activeMerchant.id;
        localStorage.setItem('rh_active_merchant', activeMerchantId);
        // Update rates from merchant
        CLIENT_RATES = {
          good: parseFloat(activeMerchant.good_rate || 4),
          damaged: parseFloat(activeMerchant.damaged_rate || 4)
        };
      }
      renderMerchantSelector();
      renderMerchants();
    }
  } catch (e) {
    console.error('[Merchants]', e.message);
  }
}

function renderMerchantSelector() {
  const sel = document.getElementById('merch-select');
  if (!sel) return;
  sel.innerHTML = dbMerchants
    .filter(m => m.active)
    .map(m => `<option value="${m.id}" ${m.id === activeMerchantId ? 'selected' : ''}>${m.name}</option>`)
    .join('') + '<option value="add">+ Add Merchant</option>';

  const label = document.getElementById('mlabel');
  if (label && activeMerchant) label.textContent = activeMerchant.name;
}

function switchM(v) {
  if (v === 'add') {
    openAddMerchant();
    const sel = document.getElementById('merch-select');
    if (sel) sel.value = activeMerchantId;
    return;
  }
  const id = parseInt(v);
  const merchant = dbMerchants.find(m => m.id === id);
  if (!merchant) return;

  activeMerchantId = id;
  activeMerchant = merchant;
  localStorage.setItem('rh_active_merchant', id);

  CLIENT_RATES = {
    good: parseFloat(merchant.good_rate || 4),
    damaged: parseFloat(merchant.damaged_rate || 4)
  };

  const label = document.getElementById('mlabel');
  if (label) label.textContent = merchant.name;

  toast('Switched to ' + merchant.name, 's');

  // Refresh all data for new merchant
  loadDBCache();
  updateScanStats();
  updateBillingCards();
  updateRRStats();
  if (typeof renderBilling === 'function') renderBilling();
  if (typeof rFlags === 'function') rFlags();
}

function renderMerchants() {
  const el = document.getElementById('merch-list');
  if (!el) return;

  const platformIcons = {
    'return_rabbit': '🐰',
    'loop': '🔄',
    'manual': '📋'
  };

  let html = dbMerchants.map(m => {
    const icon = platformIcons[m.platform] || '📦';
    const isActive = m.id === activeMerchantId;
    return `
    <div style="background:var(--bg3);border:1px solid ${isActive ? 'rgba(232,255,71,.4)' : m.active ? 'rgba(34,212,106,.3)' : 'rgba(240,69,69,.3)'};border-radius:var(--rl);padding:15px;margin-bottom:10px;display:flex;align-items:center;gap:13px">
      <div style="width:42px;height:42px;border-radius:var(--rl);background:${m.active ? 'var(--Yd)' : 'rgba(240,69,69,.1)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${icon}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;margin-bottom:2px">${m.name}
          ${isActive ? '<span class="badge by" style="font-size:9px">ACTIVE</span>' : ''}
          ${m.active ? '<span class="badge bg" style="font-size:9px">ENABLED</span>' : '<span class="badge br" style="font-size:9px">DISABLED</span>'}
        </div>
        <div style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:3px">
          ${m.shopify_domain || m.slug} · ${m.platform} · ${m.contact_email || 'No contact'}
        </div>
        <div style="font-size:12px;color:var(--tx2)">
          Rates: $${parseFloat(m.good_rate).toFixed(2)} good / $${parseFloat(m.damaged_rate).toFixed(2)} damaged
          · Sync: ${m.sync_enabled ? 'Every ' + m.sync_interval_hours + 'h' : 'Disabled'}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        ${!isActive && m.active ? `<button class="btn bY sm" onclick="switchM(${m.id})">Switch</button>` : ''}
        <button class="btn bs sm" onclick="openEditMerchant(${m.id})">Settings</button>
      </div>
    </div>`;
  }).join('');

  html += `
    <div style="border:2px dashed var(--b2);border-radius:var(--rl);padding:22px;text-align:center;cursor:pointer" onclick="openAddMerchant()">
      <div style="font-size:22px;margin-bottom:7px">➕</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:3px">Add New Merchant</div>
      <div style="font-size:12px;color:var(--tx2)">Connect a new client · Set billing rates · Configure RMA platform</div>
    </div>`;

  el.innerHTML = html;
}

function openAddMerchant() {
  _editMerchantId = null;
  document.getElementById('mm-title').textContent = '+ Add Merchant';
  document.getElementById('mm-name').value = '';
  document.getElementById('mm-slug').value = '';
  document.getElementById('mm-platform').value = 'return_rabbit';
  document.getElementById('mm-api-key').value = '';
  document.getElementById('mm-api-url').value = 'https://api.returnrabbit.app';
  document.getElementById('mm-shopify').value = '';
  document.getElementById('mm-contact').value = '';
  document.getElementById('mm-billing-email').value = '';
  document.getElementById('mm-good-rate').value = '4.00';
  document.getElementById('mm-damaged-rate').value = '4.00';
  document.getElementById('mm-sync-enabled').checked = true;
  document.getElementById('mm-sync-interval').value = '24';
  document.getElementById('mm-active').checked = true;
  om('merchant-modal');
}

function openEditMerchant(id) {
  const m = dbMerchants.find(x => x.id === id);
  if (!m) return;
  _editMerchantId = id;
  document.getElementById('mm-title').textContent = '✏ Edit ' + m.name;
  document.getElementById('mm-name').value = m.name || '';
  document.getElementById('mm-slug').value = m.slug || '';
  document.getElementById('mm-platform').value = m.platform || 'return_rabbit';
  document.getElementById('mm-api-key').value = m.api_key || '';
  document.getElementById('mm-api-url').value = m.api_url || '';
  document.getElementById('mm-shopify').value = m.shopify_domain || '';
  document.getElementById('mm-contact').value = m.contact_email || '';
  document.getElementById('mm-billing-email').value = m.billing_email || '';
  document.getElementById('mm-good-rate').value = parseFloat(m.good_rate || 4).toFixed(2);
  document.getElementById('mm-damaged-rate').value = parseFloat(m.damaged_rate || 4).toFixed(2);
  document.getElementById('mm-sync-enabled').checked = m.sync_enabled !== false;
  document.getElementById('mm-sync-interval').value = m.sync_interval_hours || 24;
  document.getElementById('mm-active').checked = m.active !== false;
  om('merchant-modal');
}

function autoSlug() {
  const name = document.getElementById('mm-name').value;
  const slugField = document.getElementById('mm-slug');
  if (!_editMerchantId && name && !slugField.dataset.manual) {
    slugField.value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

async function saveMerchant() {
  const name = document.getElementById('mm-name').value.trim();
  const slug = document.getElementById('mm-slug').value.trim().toLowerCase();
  if (!name || !slug) { toast('Name and slug required', 'e'); return; }

  const body = {
    name,
    slug,
    platform: document.getElementById('mm-platform').value,
    api_key: document.getElementById('mm-api-key').value.trim() || null,
    api_url: document.getElementById('mm-api-url').value.trim() || null,
    shopify_domain: document.getElementById('mm-shopify').value.trim() || null,
    contact_email: document.getElementById('mm-contact').value.trim() || null,
    billing_email: document.getElementById('mm-billing-email').value.trim() || null,
    good_rate: parseFloat(document.getElementById('mm-good-rate').value) || 4.00,
    damaged_rate: parseFloat(document.getElementById('mm-damaged-rate').value) || 4.00,
    sync_enabled: document.getElementById('mm-sync-enabled').checked,
    sync_interval_hours: parseInt(document.getElementById('mm-sync-interval').value) || 24,
    active: document.getElementById('mm-active').checked,
  };

  try {
    const url = _editMerchantId ? '/api/db/merchants/' + _editMerchantId : '/api/db/merchants';
    const method = _editMerchantId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success || data.id) {
      toast(_editMerchantId ? '✓ Merchant updated' : '✓ Merchant added', 's');
      cm('merchant-modal');
      await loadMerchants();
      // If rates changed for active merchant, update billing
      if (_editMerchantId === activeMerchantId) {
        CLIENT_RATES = { good: body.good_rate, damaged: body.damaged_rate };
        updateBillingCards();
      }
    } else {
      toast('Error: ' + (data.error || 'Unknown'), 'e');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'e');
  }
}
