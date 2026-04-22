// ══════════════════════════════════════════════
// MERCHANTS — Merchant switcher and management
// ══════════════════════════════════════════════

function renderMerchants(){
  const el = document.getElementById('merch-list'); if(!el) return;
  el.innerHTML = `
    <div style="background:var(--bg3);border:1px solid rgba(34,212,106,.3);border-radius:var(--rl);padding:15px;margin-bottom:10px;display:flex;align-items:center;gap:13px">
      <div style="width:42px;height:42px;border-radius:var(--rl);background:var(--Yd);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🛍</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;margin-bottom:2px">Paragonfitwear <span class="badge bg" style="font-size:9px">Active</span></div>
        <div style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-bottom:3px">paragonfitwear.myshopify.com · RR-PARA-001 · ops@paragonfitwear.com</div>
        <div style="font-size:12px;color:var(--tx2)">Active client · Return Rabbit connected</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn bs sm" onclick="toast('Settings for Paragonfitwear','s')">Settings</button>
        <button class="btn bY sm" onclick="om('emo')">📧 Report</button>
      </div>
    </div>
    <div style="border:2px dashed var(--b2);border-radius:var(--rl);padding:22px;text-align:center;cursor:pointer" onclick="addMerchant()">
      <div style="font-size:22px;margin-bottom:7px">➕</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:3px">Add New Merchant</div>
      <div style="font-size:12px;color:var(--tx2)">Connect Shopify store + Return Rabbit account · Set billing rates · Configure email reports</div>
    </div>`;
}

function addMerchant(){
  toast('➕ Merchant wizard — Shopify domain, RR API key, billing rate, contact email', 's');
}

function switchM(v){
  if(v === 'add'){
    toast('➕ Add merchant — see Merchants page', 'w');
    document.getElementById('merch-select').value = 'paragon';
    return;
  }
  document.getElementById('mlabel').textContent = 'Paragonfitwear';
  toast('Merchant: Paragonfitwear', 's');
}
