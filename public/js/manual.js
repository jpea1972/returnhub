// ══════════════════════════════════════════════
// MANUAL — Manual returns and extra items
// ══════════════════════════════════════════════

function openManualReturn(){
  manualItems = [];
  manualItemCount = 0;
  document.getElementById('mr-tracking').value  = document.getElementById('bc')?.value?.trim() || '';
  document.getElementById('mr-order').value     = '';
  document.getElementById('mr-customer').value  = '';
  document.getElementById('mr-reason').value    = 'Manual Entry';
  document.getElementById('mr-items-list').innerHTML = '';
  addManualItem();
  om('manual-return-modal');
}

function addManualItem(){
  const idx = manualItemCount++;
  const div = document.createElement('div');
  div.id = 'mr-item-' + idx;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:6px;margin-bottom:6px;align-items:end';
  div.innerHTML = `
    <div><label class="fl" style="font-size:10px">SKU</label>
      <input class="fi" id="mri-sku-${idx}" placeholder="SKU" style="font-family:var(--fm);font-size:12px"></div>
    <div><label class="fl" style="font-size:10px">Description</label>
      <input class="fi" id="mri-desc-${idx}" placeholder="Product name" style="font-size:12px"></div>
    <div><label class="fl" style="font-size:10px">Qty</label>
      <input class="fi" id="mri-qty-${idx}" type="number" min="1" value="1" style="font-size:12px"></div>
    <button class="btn bs sm" onclick="document.getElementById('mr-item-${idx}').remove()" style="margin-bottom:0;padding:8px 10px">×</button>`;
  document.getElementById('mr-items-list').appendChild(div);
}

async function saveManualReturn(){
  const tracking = document.getElementById('mr-tracking').value.trim();
  const customer = document.getElementById('mr-customer').value.trim();
  const reason   = document.getElementById('mr-reason').value;
  let   orderNum = document.getElementById('mr-order').value.trim();

  if(!customer){ toast('Customer name required', 'e'); return; }

  const items = [];
  for(let i = 0; i < manualItemCount; i++){
    const skuEl  = document.getElementById('mri-sku-'  + i);
    const descEl = document.getElementById('mri-desc-' + i);
    const qtyEl  = document.getElementById('mri-qty-'  + i);
    if(!skuEl) continue;
    const sku = skuEl.value.trim().toUpperCase();
    if(!sku) continue;
    items.push({
      sku, name:sku,
      product_name: descEl?.value.trim() || sku,
      quantity:     parseInt(qtyEl?.value) || 1,
      reason, status:'pending', type:'Return'
    });
  }
  if(items.length === 0){ toast('Add at least one item', 'e'); return; }

  try {
    const res  = await fetch('/api/db/manual-ref', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tracking_number:tracking, customer_name:customer, order_number:orderNum||null, reason, line_items:items})
    });
    const data   = await res.json();
    const manRef = data.ref || 'MAN-001';
    if(!orderNum) orderNum = manRef;

    const skuFp = items.map(i => i.sku).sort().join('|');
    const manReturn = {
      id:       orderNum,
      bc:       tracking || manRef,
      track:    tracking || '',
      cust:     customer,
      reason,
      rma:      manRef,
      rrid:     manRef,
      date:     new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      shipDate: '--',
      daysHeld: 0,
      items:    items.map(i => ({sku:i.sku, desc:i.product_name, qty:i.quantity, image:''})),
      status:   'pending',
      _sku_fingerprint: skuFp,
      _carrier:         'USPS',
      _rr_created_at:   new Date().toISOString(),
      _is_manual:       true,
      _manual_ref:      manRef
    };

    RETURNS.unshift(manReturn);
    if(tracking){
      if(!RETURNS_INDEX[tracking]) RETURNS_INDEX[tracking] = [];
      RETURNS_INDEX[tracking].push(manReturn);
    }

    cm('manual-return-modal');
    document.getElementById('bc').value = '';
    toast('✓ Manual return created: ' + manRef, 's');
    await handleFoundReturn(manReturn, tracking||manRef, 'manual_entry');

  } catch(e){ toast('Error: ' + e.message, 'e'); console.error('[Manual Return]', e); }
}

function addExtraItem(){
  if(!curR){ toast('No active return', 'e'); return; }
  document.getElementById('ei-sku').value       = '';
  document.getElementById('ei-desc').value      = '';
  document.getElementById('ei-qty').value       = '1';
  document.getElementById('ei-condition').value = 'Good';
  document.getElementById('ei-notes').value     = '';
  om('extra-item-modal');
}

function saveExtraItem(){
  const sku       = document.getElementById('ei-sku').value.trim().toUpperCase();
  const desc      = document.getElementById('ei-desc').value.trim();
  const qty       = parseInt(document.getElementById('ei-qty').value) || 1;
  const condition = document.getElementById('ei-condition').value;
  const notes     = document.getElementById('ei-notes').value.trim();

  if(!sku){ toast('SKU is required', 'e'); return; }

  const newItem = {sku, desc:desc||sku, qty, image:'', _extra:true};
  curR.items.push(newItem);

  const newIdx = curR.items.length - 1;
  itemStates[newIdx] = {
    state:    condition === 'Good' ? 'checked' : 'damaged',
    dmgNotes: notes || 'Extra item not in original RR return',
    dmgDisp:  'Restock',
    rcvQty:   qty
  };

  cm('extra-item-modal');
  toast('✓ Extra item added: ' + sku, 's');
  showDetail(curR);
}
