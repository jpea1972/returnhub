// ══════════════════════════════════════════════
// PHOTO — Product photo loading
// ══════════════════════════════════════════════

async function loadPhoto(){
  if(!curR) return;
  const img = document.getElementById('pimg');
  const ph  = document.getElementById('pp-ph');
  ph.innerHTML = '<div style="font-size:11px;color:var(--tx3)">Loading…</div>';

  if(RR_CONFIG.connected && curR.rrid){
    try {
      const id  = curR.rrid.replace('RR-', '');
      const res = await fetch(`${RR_CONFIG.baseUrl}/returns/${id}`, {headers: getAuthHeaders()});
      if(res.ok){
        const data = await res.json();
        const li   = (data.line_items || data.items || [])[0];
        const url  = li?.image_url || li?.image || li?.featured_image || '';
        if(url){
          img.src     = url;
          img.onload  = () => { img.classList.add('ld'); img.style.display = 'block'; ph.style.display = 'none'; };
          img.onerror = () => imgErr(img);
          return;
        }
      }
    } catch(e){}
  }

  if(curR.photo){
    img.src     = curR.photo;
    img.onload  = () => { img.classList.add('ld'); img.style.display = 'block'; ph.style.display = 'none'; };
    img.onerror = () => imgErr(img);
  } else {
    imgErr(img);
  }
}

function imgErr(img){
  img.style.display = 'none';
  document.getElementById('pp-ph').innerHTML =
    '<div style="font-size:20px;margin-bottom:4px">❌</div>' +
    '<div style="font-size:10px;color:var(--tx3);text-align:center;line-height:1.4">Not available<br>Check Shopify</div>';
}

function openShopify(){
  if(!curR) return;
  toast('🛍 Opening Shopify product for ' + curR.items[0].sku, 's');
}
