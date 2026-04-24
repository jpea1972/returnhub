// ══════════════════════════════════════════════
// CONFIG — Constants, global state, data
// ══════════════════════════════════════════════

const USERS = [
  {id:'kirene',    n:'Kirene Alba',      i:'KA', c:'#4F8EF7', role:'Worker',        pin:'1111', billing:false},
  {id:'karen',     n:'Karen Garcia',     i:'KG', c:'#22D46A', role:'Worker',        pin:'2222', billing:false},
  {id:'emily',     n:'Emily Foote',      i:'EF', c:'#F5A623', role:'Worker',        pin:'3333', billing:false},
  {id:'leslie',    n:'Leslie Bettes',    i:'LB', c:'#F04545', role:'Worker',        pin:'4444', billing:false},
  {id:'ascension', n:'Ascension Moreno', i:'AM', c:'#9B6FF7', role:'Worker',        pin:'5555', billing:false},
  {id:'yadith',    n:'Yadith Moreno',    i:'YM', c:'#14D4C0', role:'Worker',        pin:'6666', billing:false},
  {id:'kirsten',   n:'Kirsten Felty',    i:'KF', c:'#FF8C42', role:'Senior Worker', pin:'7777', billing:false},
  {id:'admin',     n:'Admin',            i:'AD', c:'#E8FF47', role:'Administrator', pin:'0000', billing:true},
];

let printers = [
  {id:'p1', n:'Station A — Zebra ZD420', ip:'192.168.120.52', port:'9100', brand:'Zebra', lang:'ZPL', size:'3x2', dpi:300, media:'thermal-direct', sense:'black-mark', loc:'Returns Station A', def:true,  online:true},
  {id:'p2', n:'Station B — Zebra ZD621', ip:'192.168.120.60', port:'9100', brand:'Zebra', lang:'ZPL', size:'3x2', dpi:300, media:'thermal-direct', sense:'black-mark', loc:'Returns Station B', def:false, online:true},
];
try { const sp = localStorage.getItem('rh_printers'); if(sp) printers = JSON.parse(sp); } catch(e){}

const DMG_CHECKS = [
  'Torn / Ripped seam','Makeup Stains','Deodorant Stains','V-Stain',
  'Staining / Soiling','Dry Skin','Odor / Smell','Perfume',
  "It's been worn a lot",'Lots of Lint','A lot of Hair','Lots of Pet Hair',
  'Snag in Material','Bad Order','Missing tags','Shipping damage'
];

const RR_ENDPOINTS = [
  {method:'GET',   path:'/api/v1/service-requests/', desc:'List all service requests (paginated)',  used:'Return Queue & RR Feed'},
  {method:'GET',   path:'/returns?tracking={n}',     desc:'Look up by tracking / shipping barcode', used:'Scan & Process'},
  {method:'GET',   path:'/returns/{id}',             desc:'Single return with full line items',     used:'Detail panel & photo'},
  {method:'PATCH', path:'/returns/{id}',             desc:'Update return status',                   used:'Mark processed / damage out'},
  {method:'GET',   path:'/products/{sku}',           desc:'Product details and variant images',     used:'Product photo auto-load'},
  {method:'GET',   path:'/orders/{id}',              desc:'Shopify order with ship date',           used:'Days held calculation'},
];

const RETURNS       = [];
const FLAGS         = [];
const DAYS_HELD     = [];
const BI_DATA       = [];

let cu              = null;
let selU            = null;
let curR            = null;
let curPSku         = null;
let myCount         = 0;
let emailList       = ['ops@paragonfitwear.com'];
let dbSessionId     = null;
let sessionStartTime= null;
let dbWorkerId      = null;
let selStation_val  = null;
let RETURNS_INDEX   = {};
let CLIENT_RATES    = { good: 5.00, damaged: 3.50 };
let PROCESSED_LOG   = [];
let dbWorkers       = [];
let itemStates      = {};
let processedReturns= [];
let dbFlags         = [];
let manualItems     = [];
let manualItemCount = 0;
let _editUserId     = null;
let _editFlagId     = null;
let rrSyncTimer     = null;
let rrSyncLock      = false;

let RR_CONFIG = {
  baseUrl:   '/api/rr',
  store:     'paragonfitwear',
  connected: false,
  lastSync:  null,
};

const BWEEKS = [];

// ── Merchant state ──
let dbMerchants       = [];
let activeMerchantId  = null;
let activeMerchant    = null;
let _editMerchantId   = null;
