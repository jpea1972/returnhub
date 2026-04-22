// ══════════════════════════════════════════════
// PRINT — Label printing via BarTender print server
// ══════════════════════════════════════════════

async function sendPrint(){
  if(!curPSku){ toast('No SKU selected', 'e'); return; }
  const copies  = parseInt(document.getElementById('pp-copies').value) || 1;
  const selId   = document.getElementById('pp-sel')?.value;
  const printer = printers.find(x => x.id === selId) || printers[0];
  const station = printer?.id === 'p1' ? 'A' : 'B';
  const btn = document.querySelector('#pmo .btn.bY');
  if(btn){ btn.textContent = 'Printing…'; btn.disabled = true; }
  try {
    const res = await fetch('https://192.168.120.13:3001/print', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({apiKey:'rh-print-2026-sku', sku:curPSku.sku, desc:curPSku.desc, station, copies})
    });
    const data = await res.json();
    if(data.success){
      toast(`🖨 ${copies}× ${curPSku.sku} sent to ${printer?.n || 'printer'}`, 's');
      addSyncLog('Label printed', 'success', `${copies}× ${curPSku.sku} → Station ${station}`);
      cm('pmo');
    } else {
      toast(`✗ Print error: ${data.error}`, 'e');
    }
  } catch(e){
    toast('✗ Cannot reach print server — is it running on 192.168.120.13?', 'e');
    console.error('Print error:', e.message);
  } finally {
    if(btn){ btn.textContent = '🖨 Send to Printer'; btn.disabled = false; }
  }
}

function buildZPL(sku, desc, orderId, copies, size){
  const s = (sku  || '').replace(/[^A-Z0-9\-]/gi, '').substring(0, 30);
  const d = (desc || '').substring(0, 80);
  let d1 = d, d2 = '';
  if(d.length > 40){
    const split = d.lastIndexOf(' ', 40);
    d1 = d.substring(0, split > 0 ? split : 40);
    d2 = d.substring(split > 0 ? split + 1 : 40).substring(0, 40);
  }
  return [
    '^XA','^MNB','^MTD','^PW900','^LL600','^LH0,0',
    `^FO50,40^BY3,2,160^BCN,,N,N^FD${s}^FS`,
    `^FO50,215^A0N,35,35^FD${s}^FS`,
    '^FO30,260^GB840,2,2^FS',
    `^FO30,270^A0N,28,28^FD${d1}^FS`,
    d2 ? `^FO30,305^A0N,28,28^FD${d2}^FS` : '',
    `^PQ${copies || 1},0,1,Y`,'^XZ'
  ].filter(Boolean).join('\n');
}

function openPM(sku, desc, orderId, qty){
  curPSku = {sku, desc, orderId, qty};
  popPSel();
  document.getElementById('lp-sku').textContent  = sku;
  document.getElementById('lp-desc').textContent = desc;
  document.getElementById('lp-ord').textContent  = 'ORDER: ' + orderId + ' · QTY: ' + qty + ' · PARAGONFITWEAR';
  buildLpBc(sku);
  om('pmo');
}

function buildLpBc(sku){
  const c = document.getElementById('lp-bc');
  c.innerHTML = '';
  sku.split('').forEach((ch, i) => {
    const w = ch.charCodeAt(0) % 3 === 0 ? 3.5 : 2;
    const d = document.createElement('div');
    d.style.cssText = `width:${w}px;height:100%;background:${i%2===0?'#000':'white'}`;
    c.appendChild(d);
    if(i % 2 === 0){
      const s = document.createElement('div');
      s.style.cssText = `width:${ch.charCodeAt(0)%2===0?2:1}px;height:100%;background:white`;
      c.appendChild(s);
    }
  });
}
