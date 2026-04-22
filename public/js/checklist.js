// ══════════════════════════════════════════════
// CHECKLIST — Item validation UI
// ══════════════════════════════════════════════

function showDetail(r){
  const sm = {arrived:'bb',pending:'ba',flagged:'br',processed:'bg',damaged:'br'};
  const st = {arrived:'ARRIVED',pending:'PENDING',flagged:'FLAGGED',processed:'PROCESSED',damaged:'DAMAGED'};
  const b  = document.getElementById('rp-badge');
  b.className  = 'badge ' + (sm[r.status] || 'bgr');
  b.textContent = st[r.status] || r.status.toUpperCase();

  document.getElementById('rp-oid').textContent    = r.id;
  document.getElementById('rp-cust').textContent   = r.cust;
  document.getElementById('rp-rma').textContent    = r.rma;
  document.getElementById('rp-reason').textContent = r.reason;
  document.getElementById('rp-track').textContent  = r.track;
  document.getElementById('rp-ship').textContent   = r.shipDate;
  document.getElementById('rp-date').textContent   = r.date;
  document.getElementById('rp-rrid').textContent   = r.rrid;

  const dc = document.getElementById('dchip');
  dc.className  = 'dchip ' + (r.daysHeld > 60 ? 'dr' : r.daysHeld > 30 ? 'da' : 'dg2');
  dc.textContent = r.daysHeld + 'd held';

  const img = document.getElementById('pimg');
  img.style.display = 'none'; img.classList.remove('ld');
  const ph = document.getElementById('pp-ph');
  ph.style.display = 'flex'; ph.style.flexDirection = 'column'; ph.style.alignItems = 'center';

  itemStates = {};
  r.items.forEach((item, idx) => {
    itemStates[idx] = {state:'unchecked', rcvQty:item.qty, dmgChecks:[], dmgNotes:'', dmgDisp:'Damage Out — Dispose', wrongNotes:''};
  });

  buildChecklist(r);
  updateProgress();
  updateProcBtn();
  document.getElementById('rp').classList.add('vis');
}

function buildChecklist(r){
  const icl = document.getElementById('icl');
  icl.innerHTML = r.items.map((item, idx) => buildItemRow(item, idx, r.id)).join('');
  r.items.forEach((item, idx) => {
    const minusBtn = document.getElementById(`pq-minus-${idx}`);
    const plusBtn  = document.getElementById(`pq-plus-${idx}`);
    const numEl    = document.getElementById(`pq-num-${idx}`);
    if(minusBtn) minusBtn.addEventListener('click', () => adjustQty(idx, item.qty, -1));
    if(plusBtn)  plusBtn.addEventListener('click',  () => adjustQty(idx, item.qty, +1));
    if(numEl)    numEl.addEventListener('change', () => {
      const v = Math.max(0, Math.min(item.qty, parseInt(numEl.value) || 0));
      itemStates[idx].rcvQty = v; numEl.value = v;
      updateMissingLabel(idx, item.qty); updateProgress(); updateProcBtn();
    });
  });
}

function buildItemRow(item, idx, orderId){
  return `<div class="icr state-unchecked" id="icr-${idx}">
    <div class="icr-main">
      <div class="icr-check" id="ck-${idx}" onclick="toggleCheck(${idx},'${item.sku}',${item.qty})" title="Tap to mark received">
        <span class="ck-icon" id="cki-${idx}">✕</span>
      </div>
      <div class="icr-bc">${mBc(item.sku)}</div>
      <div style="flex:1;min-width:0">
        <div class="icr-sku">${item.sku}</div>
        <div class="icr-desc">${item.desc}</div>
      </div>
      <div class="icr-qty" id="iqty-${idx}" title="Expected qty">${item.qty}</div>
      <div class="icr-actions">
        <button class="ia-btn ia-print" onclick="openPM('${item.sku}','${item.desc}','${orderId}',${item.qty})" title="Print bag label">🖨 Print</button>
        <button class="ia-btn ia-partial" id="iap-${idx}" onclick="toggleSub(${idx},'partial',${item.qty})" title="Partial — enter qty received">⅟ Partial</button>
        <button class="ia-btn ia-dmg"    id="iad-${idx}" onclick="toggleSub(${idx},'damaged',${item.qty})" title="Add damage notes">🗑 Damage</button>
        <button class="ia-btn ia-wrong"  id="iaw-${idx}" onclick="toggleSub(${idx},'wrong',${item.qty})"   title="Wrong product received">❓ Wrong</button>
      </div>
    </div>
    <div class="icr-sub" id="sub-partial-${idx}">
      <div class="pq-row">
        <span class="pq-label">Expected:</span>
        <span class="pq-expected">${item.qty}</span>
        <span class="pq-arrow">→</span>
        <span class="pq-label">Received:</span>
        <div class="pq-input-wrap">
          <button class="pq-btn" id="pq-minus-${idx}">−</button>
          <input class="pq-num" type="number" id="pq-num-${idx}" value="${item.qty}" min="0" max="${item.qty}">
          <button class="pq-btn" id="pq-plus-${idx}">+</button>
        </div>
        <span class="pq-missing-label" id="pq-miss-${idx}"></span>
      </div>
      <div class="fg" style="margin-bottom:0"><label class="fl" style="color:var(--A)">Notes about missing units</label><textarea class="fta" id="pq-notes-${idx}" placeholder="Describe what was in the package…" style="min-height:65px;border-color:rgba(245,166,35,.3)"></textarea></div>
    </div>
    <div class="icr-sub" id="sub-damaged-${idx}">
      <div class="dmg-sub">
        <div class="dmg-sub-title">🗑 Damage Report — Select all that apply</div>
        <div class="dmg-checks">
          ${DMG_CHECKS.map((c,ci) => `<label class="dc"><input type="checkbox" id="dc-${idx}-${ci}" onchange="syncDmgState(${idx})"> ${c}</label>`).join('')}
        </div>
        <div class="fg"><label class="fl" style="color:var(--R)">Damage notes to Paragon</label><textarea class="fta" id="dmg-notes-${idx}" placeholder="Describe in detail…" style="min-height:75px;border-color:rgba(240,69,69,.3)" oninput="syncDmgState(${idx})"></textarea></div>
        <div class="fg" style="margin-bottom:0"><label class="fl">Disposition</label><select class="fsel" id="dmg-disp-${idx}" onchange="syncDmgState(${idx})"><option>Damage Out — Dispose</option><option>Hold for Review</option><option>Return to Customer</option><option>Quarantine</option></select></div>
      </div>
    </div>
    <div class="icr-sub" id="sub-wrong-${idx}">
      <div class="wrong-sub">
        <div class="wrong-sub-title">❓ Wrong Product — Describe what was actually received</div>
        <div class="fg"><label class="fl" style="color:var(--P)">Notes about wrong item</label><textarea class="fta" id="wrong-notes-${idx}" placeholder="What product was actually in the bag?" style="min-height:75px;border-color:rgba(155,111,247,.3)" oninput="syncWrongState(${idx})"></textarea></div>
        <div style="background:rgba(155,111,247,.08);border-radius:var(--r);padding:9px;font-size:12px;color:var(--P)">⚠ Item will be flagged as WRONG PRODUCT and held in quarantine until Paragon advises.</div>
      </div>
    </div>
  </div>`;
}

function toggleCheck(idx, sku, qty){
  const st = itemStates[idx];
  if(st.state === 'unchecked' || st.state === 'partial' || st.state === 'damaged' || st.state === 'wrong'){
    setItemState(idx, 'checked', qty);
    closeSubs(idx);
  } else {
    setItemState(idx, 'unchecked', qty);
  }
  updateProgress(); updateProcBtn();
}

function setItemState(idx, state, qty){
  const s  = itemStates[idx];
  s.state  = state;
  if(state === 'checked')   s.rcvQty = qty;
  if(state === 'unchecked') s.rcvQty = qty;
  const row = document.getElementById('icr-' + idx);
  const ki  = document.getElementById('cki-' + idx);
  const qt  = document.getElementById('iqty-' + idx);
  row.className = 'icr state-' + state;
  const icons = {checked:'✓', unchecked:'✕', partial:'⅟', damaged:'🗑', wrong:'❓'};
  ki.textContent = icons[state] || '✕';
  if(state === 'partial')                          { qt.style.color = 'var(--A)'; }
  else if(state === 'checked')                     { qt.style.color = 'var(--G)'; }
  else if(state === 'damaged' || state === 'wrong'){ qt.style.color = 'var(--R)'; }
  else                                             { qt.style.color = ''; }
}

function toggleSub(idx, type, qty){
  const subEl = document.getElementById(`sub-${type}-${idx}`);
  const btnEl = document.getElementById(`ia${type[0]}-${idx}`);
  const isOpen = subEl.classList.contains('vis');
  closeSubs(idx);
  if(!isOpen){
    subEl.classList.add('vis');
    if(btnEl) btnEl.classList.add('on');
    const currentState = itemStates[idx].state;
    if(currentState !== 'checked') setItemState(idx, type, qty);
    if(type === 'damaged') setItemState(idx, 'damaged', qty);
    if(type === 'wrong')   setItemState(idx, 'wrong', qty);
    if(type === 'partial') setItemState(idx, 'partial', qty);
    updateProgress(); updateProcBtn();
  }
}

function closeSubs(idx){
  ['partial','damaged','wrong'].forEach(type => {
    document.getElementById(`sub-${type}-${idx}`)?.classList.remove('vis');
    document.getElementById(`ia${type[0]}-${idx}`)?.classList.remove('on');
  });
}

function adjustQty(idx, maxQty, delta){
  const s    = itemStates[idx];
  const inp  = document.getElementById(`pq-num-${idx}`);
  const newVal = Math.max(0, Math.min(maxQty, (s.rcvQty || 0) + delta));
  s.rcvQty   = newVal;
  inp.value  = newVal;
  updateMissingLabel(idx, maxQty);
  if(newVal === maxQty)      setItemState(idx, 'checked', maxQty);
  else if(newVal === 0)      setItemState(idx, 'unchecked', maxQty);
  else                       setItemState(idx, 'partial', maxQty);
  updateProgress(); updateProcBtn();
}

function updateMissingLabel(idx, maxQty){
  const s    = itemStates[idx];
  const miss = maxQty - (s.rcvQty || 0);
  const el   = document.getElementById(`pq-miss-${idx}`);
  if(!el) return;
  if(miss > 0){ el.textContent = `${miss} MISSING`; el.style.color = 'var(--R)'; }
  else        { el.textContent = 'All present';      el.style.color = 'var(--G)'; }
}

function syncDmgState(idx){
  const s    = itemStates[idx];
  s.dmgChecks = DMG_CHECKS.filter((_, ci) => document.getElementById(`dc-${idx}-${ci}`)?.checked);
  s.dmgNotes  = document.getElementById(`dmg-notes-${idx}`)?.value || '';
  s.dmgDisp   = document.getElementById(`dmg-disp-${idx}`)?.value  || 'Damage Out — Dispose';
}

function syncWrongState(idx){
  itemStates[idx].wrongNotes = document.getElementById(`wrong-notes-${idx}`)?.value || '';
}

function checkAll(val){
  if(!curR) return;
  curR.items.forEach((item, idx) => {
    closeSubs(idx);
    setItemState(idx, val ? 'checked' : 'unchecked', item.qty);
    if(val) itemStates[idx].rcvQty = item.qty;
  });
  updateProgress(); updateProcBtn();
}

function updateProgress(){
  if(!curR) return;
  const inHand = curR.items.filter((_, i) => ['checked','damaged','wrong','partial'].includes(itemStates[i]?.state)).length;
  document.getElementById('chk-count').textContent = inHand;
  document.getElementById('chk-total').textContent = ` / ${curR.items.length} in package`;
}

function updateProcBtn(){
  if(!curR) return;
  const states          = curR.items.map((_, i) => itemStates[i]?.state);
  const allAccountedFor = states.every(s => ['checked','damaged','wrong'].includes(s));
  const hasAnyFlag      = states.some(s => s !== 'checked');
  const btn  = document.getElementById('proc-btn');
  const txt  = document.getElementById('proc-btn-txt');
  const hint = document.getElementById('proc-hint');

  if(!hasAnyFlag){
    btn.className  = 'btn bG lg'; btn.style.flex = '1';
    txt.textContent  = '✓ All Items Confirmed — Process Return';
    hint.textContent = '';
  } else if(allAccountedFor){
    btn.className  = 'btn bA lg'; btn.style.flex = '1';
    const damaged = states.filter(s => s === 'damaged').length;
    const wrong   = states.filter(s => s === 'wrong').length;
    const parts   = [];
    if(damaged) parts.push(`${damaged} damaged`);
    if(wrong)   parts.push(`${wrong} wrong item`);
    txt.textContent  = '⚑ All received — flags: ' + parts.join(', ');
    hint.textContent = 'Will log to Paragon report';
  } else {
    btn.className  = 'btn bA lg'; btn.style.flex = '1';
    const unchecked = states.filter(s => s === 'unchecked').length;
    const partial   = states.filter(s => s === 'partial').length;
    const damaged   = states.filter(s => s === 'damaged').length;
    const wrong     = states.filter(s => s === 'wrong').length;
    const parts     = [];
    if(unchecked) parts.push(`${unchecked} not returned`);
    if(partial)   parts.push(`${partial} partial`);
    if(damaged)   parts.push(`${damaged} damaged`);
    if(wrong)     parts.push(`${wrong} wrong item`);
    txt.textContent  = '⚑ Process with flags: ' + parts.join(', ');
    hint.textContent = 'Will prompt confirmation';
  }
}

function mBc(sku){
  return sku.split('').map((c, i) => {
    const w = c.charCodeAt(0) % 3 === 0 ? 3 : 1.5;
    const h = 9 + c.charCodeAt(0) % 14;
    return `<div class="icr-bar" style="width:${w}px;height:${h}px;background:${i%2===0?'var(--tx2)':'transparent'}"></div>`;
  }).join('');
}
