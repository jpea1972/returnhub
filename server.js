/**
 * ReturnHub Server
 * ─────────────────────────────────────────────────────
 * - Serves the dashboard at /
 * - Proxies all Return Rabbit API calls at /api/rr/*
 *   so the API token never touches the browser
 * - Handles ZPL label printing at /api/print
 */

require('dotenv').config();
const express    = require('express');
const fetch      = require('node-fetch');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { Pool }   = require('pg');
const crypto     = require('crypto');

// ── POSTGRES CONNECTION ───────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB Pool Error]', err.message);
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────
app.set('trust proxy', 1); // Required for Railway proxy / express-rate-limit

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());

// Rate limiting — prevent abuse on the API proxy
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,              // 120 requests per minute is plenty for a warehouse
  message: { error: 'Too many requests — slow down' },
});
app.use('/api/', apiLimiter);

// ── STATIC DASHBOARD ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── RETURN RABBIT API PROXY ───────────────────────────
// All calls go to /api/rr/* and get forwarded to Return Rabbit
// The RR_TOKEN env variable is never sent to the browser

const RR_BASE = process.env.RR_BASE_URL || 'https://api.returnrabbit.app';

app.all('/api/rr/*', async (req, res) => {
  if (!process.env.RR_TOKEN) {
    return res.status(400).json({ error: 'RR_TOKEN not configured on server. Add it to your .env file.' });
  }

  // Strip the /api/rr prefix to get the RR path
  const rrPath    = req.path.replace('/api/rr', '');
  const rrUrl     = `${RR_BASE}${rrPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
  const rrHeaders = {
    'Authorization': `Token ${process.env.RR_TOKEN}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  try {
    const rrRes = await fetch(rrUrl, {
      method:  req.method,
      headers: rrHeaders,
      body:    ['POST','PATCH','PUT'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });

    const contentType = rrRes.headers.get('content-type') || '';
    res.status(rrRes.status);

    if (contentType.includes('application/json')) {
      const data = await rrRes.json();
      res.json(data);
    } else {
      const text = await rrRes.text();
      res.send(text);
    }
  } catch (err) {
    console.error('[RR Proxy Error]', err.message);
    res.status(502).json({ error: 'Could not reach Return Rabbit API', detail: err.message });
  }
});

// ── ZPL LABEL PRINT PROXY ─────────────────────────────
// Sends ZPL to a network printer by IP:port (TCP socket)
// The browser calls POST /api/print with { ip, port, zpl }

const net = require('net');

app.post('/api/print', (req, res) => {
  const { ip, port = 9100, zpl } = req.body;

  if (!ip || !zpl) {
    return res.status(400).json({ error: 'ip and zpl are required' });
  }

  // Basic IP validation
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address' });
  }

  const socket = new net.Socket();
  const timeout = 5000; // 5 second timeout

  socket.setTimeout(timeout);

  socket.connect(parseInt(port), ip, () => {
    socket.write(zpl, 'utf8', () => {
      socket.end();
      res.json({ success: true, message: `Label sent to ${ip}:${port}` });
    });
  });

  socket.on('timeout', () => {
    socket.destroy();
    res.status(504).json({ error: `Connection timed out — is the printer at ${ip}:${port} online?` });
  });

  socket.on('error', (err) => {
    res.status(502).json({ error: `Printer connection failed: ${err.message}` });
  });
});

// ── HEALTH CHECK ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    rrConfigured: !!process.env.RR_TOKEN,
    dbConfigured: !!process.env.DATABASE_URL,
    timestamp: new Date().toISOString(),
  });
});

// ── DATABASE ROUTES ──────────────────────────────────

// ── SESSION: Start on login ───────────────────────────
app.post('/api/db/sessions/start', async (req, res) => {
  const { initials, pin, station, ip_address } = req.body;
  if (!initials || !pin) return res.status(400).json({ error: 'initials and pin required' });
  try {
    // Verify worker credentials
    const workerRes = await pool.query(
      'SELECT id, initials, full_name, role FROM workers WHERE initials = $1 AND pin_hash = $2 AND active = true',
      [initials.toUpperCase(), pin]
    );
    if (workerRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const worker = workerRes.rows[0];
    // Create session
    const sessionRes = await pool.query(
      'INSERT INTO sessions (worker_id, station, login_at, last_activity_at, ip_address) VALUES ($1, $2, NOW(), NOW(), $3) RETURNING id',
      [worker.id, station || null, ip_address || null]
    );
    // Update last login time
    await pool.query('UPDATE workers SET last_login_at = NOW() WHERE id = $1', [worker.id]);
    res.json({ 
      success: true, 
      session_id: sessionRes.rows[0].id,
      worker 
    });
  } catch (err) {
    console.error('[Session Start Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SESSION: End on logout ────────────────────────────
app.put('/api/db/sessions/:id/end', async (req, res) => {
  const { id } = req.params;
  const { total_returns } = req.body;
  try {
    await pool.query(
      `UPDATE sessions 
       SET logout_at = NOW(),
           active_minutes = EXTRACT(EPOCH FROM (NOW() - login_at))/60,
           total_returns = $1
       WHERE id = $2`,
      [total_returns || 0, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Session End Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SCAN EVENT: Log every scan ────────────────────────
app.post('/api/db/scan-events', async (req, res) => {
  const { session_id, worker_id, scanned_value, resolved_tracking, lookup_result, matched_order } = req.body;
  try {
    // Calculate seconds since last scan in this session
    const lastScan = await pool.query(
      'SELECT scan_at FROM scan_events WHERE session_id = $1 ORDER BY scan_at DESC LIMIT 1',
      [session_id]
    );
    const secondsSinceLast = lastScan.rows.length > 0
      ? Math.floor((Date.now() - new Date(lastScan.rows[0].scan_at).getTime()) / 1000)
      : null;

    await pool.query(
      `INSERT INTO scan_events (session_id, worker_id, scanned_value, resolved_tracking, lookup_result, matched_order, scan_at, seconds_since_last)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [session_id, worker_id, scanned_value, resolved_tracking, lookup_result, matched_order || null, secondsSinceLast]
    );

    // Update session last_activity_at
    await pool.query('UPDATE sessions SET last_activity_at = NOW() WHERE id = $1', [session_id]);

    res.json({ success: true });
  } catch (err) {
    console.error('[Scan Event Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DUPLICATE CHECK — fires first on every scan ───────
app.post('/api/db/duplicate-check', async (req, res) => {
  const { tracking_number, order_number, customer_name, sku_fingerprint, merchant_id } = req.body;
  if (!tracking_number || !order_number || !customer_name || !sku_fingerprint) {
    return res.status(400).json({ error: 'All 4 fields required for duplicate check' });
  }
  try {
    const where = [
      'r.tracking_number = $1',
      'r.order_number = $2',
      'r.customer_name = $3',
      'r.sku_fingerprint = $4'
    ];
    const params = [tracking_number, order_number, customer_name, sku_fingerprint];
    if (merchant_id) {
      where.push('r.merchant_id = $5');
      params.push(parseInt(merchant_id));
    }
    const result = await pool.query(
      `SELECT r.id, r.order_number, r.tracking_number, r.customer_name, 
              r.sku_fingerprint, r.condition, r.received_at, r.is_duplicate_override,
              r.merchant_id,
              w.full_name as processed_by, w.initials as processed_by_initials
       FROM returns r
       LEFT JOIN workers w ON r.worker_id = w.id
       WHERE ${where.join(' AND ')}
       ORDER BY r.received_at DESC
       LIMIT 1`,
      params
    );
    if (result.rows.length > 0) {
      res.json({ duplicate: true, existing: result.rows[0] });
    } else {
      res.json({ duplicate: false });
    }
  } catch (err) {
    console.error('[Duplicate Check Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RETURNS: Save a processed return ─────────────────
app.post('/api/db/returns', async (req, res) => {
  const {
    order_number, shopify_order_id, tracking_number, carrier,
    customer_name, customer_zip, sku_fingerprint, condition,
    billing_rate, billed_amount, worker_id, session_id, station,
    label_printed, rr_created_at, notes, is_duplicate_override, is_manual,
    line_items, merchant_id
  } = req.body;

  if (!order_number || !tracking_number || !condition || !worker_id) {
    return res.status(400).json({ error: 'order_number, tracking_number, condition, worker_id required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const returnRes = await client.query(
      `INSERT INTO returns (
        order_number, shopify_order_id, tracking_number, carrier,
        customer_name, customer_zip, sku_fingerprint, condition,
        billing_rate, billed_amount, worker_id, session_id, station,
        label_printed, label_printed_at, rr_created_at, received_at, 
        notes, is_duplicate_override, is_manual, merchant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,$18,$19,$20)
      RETURNING id`,
      [
        order_number, shopify_order_id || null, tracking_number, carrier || 'USPS',
        customer_name, customer_zip || null, sku_fingerprint, condition,
        billing_rate, billed_amount, worker_id, session_id || null, station || null,
        label_printed || false, label_printed ? new Date() : null,
        rr_created_at || null, notes || null, is_duplicate_override || false, is_manual || false,
        merchant_id || 1
      ]
    );

    const returnId = returnRes.rows[0].id;

    // Insert line items
    if (line_items && line_items.length > 0) {
      for (const item of line_items) {
        await client.query(
          'INSERT INTO return_line_items (return_id, sku, product_name, quantity) VALUES ($1, $2, $3, $4)',
          [returnId, item.sku, item.product_name || null, item.quantity || 1]
        );
      }
    }

    // Update session total_returns
    if (session_id) {
      await client.query(
        'UPDATE sessions SET total_returns = total_returns + 1, last_activity_at = NOW() WHERE id = $1',
        [session_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, return_id: returnId });
  } catch (err) {
    await client.query('ROLLBACK');
    // Handle duplicate key violation gracefully
    if (err.code === '23505') {
      return res.status(409).json({ error: 'duplicate', message: 'This return has already been processed' });
    }
    console.error('[Save Return Error]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── RR CACHE: Serve unprocessed returns to browser ───
// This replaces fetchRR() hitting RR API directly
// ?merchant_id=X filters to a specific merchant's returns
app.get('/api/db/cache', async (req, res) => {
  const { merchant_id } = req.query;
  try {
    const where = ["c.rr_created_at >= '2026-01-01'"];
    const params = [];
    let i = 1;

    if (merchant_id) {
      where.push(`c.merchant_id = $${i}`);
      params.push(parseInt(merchant_id));
      i++;
      // Exclude returns already processed for this merchant
      where.push(`c.order_number NOT IN (
        SELECT DISTINCT order_number FROM returns
        WHERE is_duplicate_override = false AND merchant_id = $${i}
      )`);
      params.push(parseInt(merchant_id));
      i++;
    } else {
      where.push(`c.order_number NOT IN (
        SELECT DISTINCT order_number FROM returns
        WHERE is_duplicate_override = false
      )`);
    }

    const result = await pool.query(
      `SELECT 
        c.order_number, c.rr_name, c.rr_id, c.tracking_number, c.customer_name,
        c.customer_zip, c.line_items, c.sku_fingerprint,
        c.carrier, c.rr_created_at, c.merchant_id
       FROM rr_cache c
       WHERE ${where.join(' AND ')}
       ORDER BY c.rr_created_at DESC`,
      params
    );
    res.json({ success: true, count: result.rows.length, returns: result.rows });
  } catch (err) {
    console.error('[Cache Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SEARCH: Returns (processed) ──────────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/returns/search', async (req, res) => {
  const { q, condition, worker_id, date_from, date_to, merchant_id, limit = 100, offset = 0 } = req.query;
  try {
    let where = ['1=1'];
    let params = [];
    let i = 1;

    if (merchant_id) {
      where.push(`r.merchant_id = $${i}`); params.push(parseInt(merchant_id)); i++;
    }
    if (q) {
      where.push(`(r.order_number ILIKE $${i} OR r.tracking_number ILIKE $${i} OR r.customer_name ILIKE $${i} OR EXISTS (SELECT 1 FROM return_line_items li WHERE li.return_id = r.id AND (li.sku ILIKE $${i} OR li.product_name ILIKE $${i})))`);
      params.push(`%${q}%`);
      i++;
    }
    if (condition) { where.push(`r.condition = $${i}`); params.push(condition); i++; }
    if (worker_id) { where.push(`r.worker_id = $${i}`); params.push(worker_id); i++; }
    if (date_from) { where.push(`r.received_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`r.received_at <= $${i}`); params.push(date_to); i++; }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const result = await pool.query(
      `SELECT r.*, w.initials as worker_initials, w.full_name as worker_name,
              json_agg(json_build_object('sku', li.sku, 'product_name', li.product_name, 'quantity', li.quantity)) as line_items
       FROM returns r
       LEFT JOIN workers w ON r.worker_id = w.id
       LEFT JOIN return_line_items li ON li.return_id = r.id
       WHERE ${where.join(' AND ')}
       GROUP BY r.id, w.initials, w.full_name
       ORDER BY r.received_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    res.json({ success: true, count: result.rows.length, returns: result.rows });
  } catch (err) {
    console.error('[Search Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PRODUCTIVITY SUMMARY: Worker leaderboard ─────────────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/reports/productivity-summary', async (req, res) => {
  const { date_from, date_to, merchant_id } = req.query;
  if(!date_from) return res.status(400).json({ error: 'date_from required' });
  try {
    const where = ['r.received_at >= $1'];
    const params = [date_from];
    let i = 2;
    if(date_to){ where.push(`r.received_at <= $${i}`); params.push(date_to); i++; }
    if(merchant_id){ where.push(`r.merchant_id = $${i}`); params.push(parseInt(merchant_id)); i++; }
    const result = await pool.query(
      `SELECT
        w.id as worker_id,
        w.initials,
        w.full_name,
        COUNT(*) as total_returns,
        SUM(CASE WHEN r.billing_rate > 0 THEN ROUND(r.billed_amount / r.billing_rate) ELSE 0 END) as total_units,
        SUM(r.billed_amount) as total_revenue,
        COUNT(CASE WHEN r.condition = 'Good' THEN 1 END) as good_count,
        COUNT(CASE WHEN r.condition = 'Damaged' THEN 1 END) as damaged_count,
        COUNT(CASE WHEN r.condition = 'Not Returned' THEN 1 END) as not_returned_count,
        MIN(r.received_at) as first_scan,
        MAX(r.received_at) as last_scan,
        EXTRACT(EPOCH FROM (MAX(r.received_at) - MIN(r.received_at)))/3600 as hours_active
       FROM returns r
       JOIN workers w ON r.worker_id = w.id
       WHERE ${where.join(' AND ')}
       GROUP BY w.id, w.initials, w.full_name
       ORDER BY total_units DESC`,
      params
    );
    res.json({ success: true, workers: result.rows });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

// ── PRODUCTIVITY: Worker hourly stats ────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/reports/productivity', async (req, res) => {
  const { worker_id, date_from, date_to, merchant_id } = req.query;
  try {
    let where = ['1=1'];
    let params = [];
    let i = 1;
    if (merchant_id) { where.push(`r.merchant_id = $${i}`); params.push(parseInt(merchant_id)); i++; }
    if (worker_id) { where.push(`r.worker_id = $${i}`); params.push(worker_id); i++; }
    if (date_from) { where.push(`r.received_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`r.received_at <= $${i}`); params.push(date_to); i++; }

    const result = await pool.query(
      `SELECT 
        w.initials, w.full_name,
        DATE_TRUNC('hour', r.received_at) as hour,
        COUNT(*) as returns_processed,
        SUM(CASE WHEN r.billing_rate > 0 THEN ROUND(r.billed_amount / r.billing_rate) ELSE 0 END) as units_processed,
        SUM(r.billed_amount) as revenue_generated,
        COUNT(CASE WHEN r.condition = 'Good' THEN 1 END) as good_count,
        COUNT(CASE WHEN r.condition = 'Damaged' THEN 1 END) as damaged_count,
        COUNT(CASE WHEN r.condition = 'Not Returned' THEN 1 END) as not_returned_count
       FROM returns r
       JOIN workers w ON r.worker_id = w.id
       WHERE ${where.join(' AND ')}
       GROUP BY w.id, w.initials, w.full_name, DATE_TRUNC('hour', r.received_at)
       ORDER BY hour DESC, w.initials`,
      params
    );
    res.json({ success: true, rows: result.rows });
  } catch (err) {
    console.error('[Productivity Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── BILLING: Summary for period ───────────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/reports/billing', async (req, res) => {
  const { date_from, date_to, merchant_id } = req.query;
  try {
    const where = ['received_at >= $1'];
    const params = [date_from];
    let i = 2;
    if(date_to){ where.push(`received_at <= $${i}`); params.push(date_to); i++; }
    if(merchant_id){ where.push(`merchant_id = $${i}`); params.push(parseInt(merchant_id)); i++; }
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_returns,
        COUNT(CASE WHEN condition = 'Good' THEN 1 END) as total_good,
        COUNT(CASE WHEN condition = 'Damaged' THEN 1 END) as total_damaged,
        COUNT(CASE WHEN condition = 'Not Returned' THEN 1 END) as total_not_returned,
        SUM(CASE WHEN condition = 'Good' THEN billed_amount ELSE 0 END) as good_revenue,
        SUM(CASE WHEN condition = 'Damaged' THEN billed_amount ELSE 0 END) as damaged_revenue,
        SUM(billed_amount) as total_revenue,
        SUM(CASE WHEN billing_rate > 0 THEN ROUND(billed_amount / billing_rate) ELSE 0 END) as total_units,
        SUM(CASE WHEN condition = 'Good' AND billing_rate > 0 THEN ROUND(billed_amount / billing_rate) ELSE 0 END) as good_units,
        SUM(CASE WHEN condition = 'Damaged' AND billing_rate > 0 THEN ROUND(billed_amount / billing_rate) ELSE 0 END) as damaged_units
       FROM returns
       WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ success: true, billing: result.rows[0] });
  } catch (err) {
    console.error('[Billing Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SYNC: Incremental RR sync into rr_cache ───────────
// Pulls only records newer than MAX(rr_created_at) in DB
// Cutoff: Jan 1 2026 — never pulls older than that
// ?merchant_id=X syncs a specific merchant using their API key
// Uses the adapter pattern — calls syncReturnRabbit or syncLoop based on merchant.platform
app.post('/api/db/sync', async (req, res) => {
  const merchantId = req.body.merchant_id || req.query.merchant_id;
  const resolvedMerchantId = merchantId ? parseInt(merchantId) : 1;

  try {
    // Load merchant record
    const merchantRes = await pool.query(
      'SELECT id, name, api_key, api_url, platform, good_rate FROM merchants WHERE id = $1 AND active = true',
      [resolvedMerchantId]
    );
    if (merchantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant not found or inactive' });
    }
    const merchant = merchantRes.rows[0];

    // Use the shared adapter router
    const result = await syncMerchant(merchant);

    res.json({
      success: true,
      merchant_id: resolvedMerchantId,
      platform: merchant.platform,
      pages_fetched: result.pages_fetched,
      records_added: result.records_added,
    });
  } catch (err) {
    console.error(`[Sync Error] merchant ${resolvedMerchantId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RETURN LINE FLAGS: Save flags ───────────────────────────────────
app.post('/api/db/flags', async (req, res) => {
  const { return_id, flags } = req.body;
  if (!return_id || !flags || !flags.length) {
    return res.status(400).json({ error: 'return_id and flags required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const flag of flags) {
      await client.query(
        `INSERT INTO return_line_flags (
          return_id, order_number, rma_name, customer_name, reason,
          sku, product_name, expected_qty, received_qty, condition,
          damage_checks, damage_notes, disposition, wrong_notes,
          worker_id, session_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          return_id,
          flag.order_number || null, flag.rma_name      || null,
          flag.customer_name|| null, flag.reason        || null,
          flag.sku          || null, flag.product_name  || null,
          flag.expected_qty || 1,   flag.received_qty   || 0,
          flag.condition    || 'Good',
          flag.damage_checks|| null, flag.damage_notes  || null,
          flag.disposition  || null, flag.wrong_notes   || null,
          flag.worker_id    || null, flag.session_id    || null
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, saved: flags.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Flags Save Error]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── RETURN LINE FLAGS: Edit a flag (change condition) ────────────────
app.put('/api/db/flags/:id', async (req, res) => {
  const { id } = req.params;
  const { condition, damage_checks, damage_notes, disposition, wrong_notes, received_qty, billing_rate, worker_id } = req.body;
  const valid = ['Good','Damaged','Partial','Not Returned','Wrong Product'];
  if(!condition || !valid.includes(condition)){
    return res.status(400).json({ error: 'Invalid condition' });
  }
  try {
    const result = await pool.query(
      `UPDATE return_line_flags SET
        condition     = $1,
        damage_checks = $2,
        damage_notes  = $3,
        disposition   = $4,
        wrong_notes   = $5,
        received_qty  = COALESCE($7, received_qty)
       WHERE id = $6
       RETURNING id, condition`,
      [condition, damage_checks||null, damage_notes||null, disposition||null, wrong_notes||null, id, received_qty!==undefined?received_qty:null]
    );
    if(result.rows.length === 0) return res.status(404).json({ error: 'Flag not found' });
    // Also update parent return condition if needed
    const flag = await pool.query('SELECT return_id FROM return_line_flags WHERE id=$1',[id]);
    if(flag.rows.length > 0){
      const returnId = flag.rows[0].return_id;
      // Recalculate overall condition from all flags for this return
      const allFlags = await pool.query('SELECT condition FROM return_line_flags WHERE return_id=$1',[returnId]);
      const conditions = allFlags.rows.map(r=>r.condition);
      let overallCondition = 'Good';
      if(conditions.some(c=>c==='Not Returned'||c==='Partial')) overallCondition = 'Not Returned';
      else if(conditions.some(c=>c==='Damaged')) overallCondition = 'Damaged';
      // Recalculate billed_amount from all flags for this return
      const allFlagsDetail = await pool.query(
        'SELECT condition, expected_qty, received_qty FROM return_line_flags WHERE return_id=$1',
        [returnId]
      );
      // Get billing_rate from the parent return
      // Use rate from request (current CLIENT_RATES) or fall back to stored rate
      const returnData = await pool.query(
        'SELECT billing_rate FROM returns WHERE id=$1', [returnId]
      );
      const storedRate = parseFloat(returnData.rows[0]?.billing_rate || 0);
      const rate = billing_rate ? parseFloat(billing_rate) : (storedRate > 0 ? storedRate : 5.00);
      // Calculate billable units: Good + Damaged items use full qty, others = 0
      let billableUnits = 0;
      allFlagsDetail.rows.forEach(f => {
        if(f.condition === 'Good' || f.condition === 'Damaged'){
          billableUnits += parseInt(f.expected_qty || 1);
        } else if(f.condition === 'Partial'){
          billableUnits += parseInt(f.received_qty || 0);
        }
      });
      const newBilledAmount = billableUnits * rate;
      await pool.query(
        'UPDATE returns SET condition=$1, billed_amount=$2, billing_rate=CASE WHEN billing_rate=0 THEN $4 ELSE billing_rate END WHERE id=$3',
        [overallCondition, newBilledAmount, returnId, rate]
      );
    }
    res.json({ success: true, id: result.rows[0].id, condition: result.rows[0].condition });
  } catch(err){
    console.error('[Flag Edit Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RETURN LINE FLAGS: Get flags for Returns Report ───────────────────
// ?merchant_id=X filters to a specific merchant via returns join
app.get('/api/db/flags', async (req, res) => {
  const { condition, date_from, date_to, merchant_id, q, limit = 500, offset = 0 } = req.query;
  try {
    let where = ['1=1'];
    let params = [];
    let i = 1;
    const needsReturnJoin = !!merchant_id || !!q;
    if (merchant_id) {
      where.push(`r.merchant_id = $${i}`); params.push(parseInt(merchant_id)); i++;
    }
    if (condition && condition !== 'all') {
      where.push(`f.condition = $${i}`); params.push(condition); i++;
    }
    if (date_from) { where.push(`f.created_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`f.created_at <= $${i}`); params.push(date_to);   i++; }
    if (q) {
      where.push(`(f.order_number ILIKE $${i} OR f.rma_name ILIKE $${i} OR f.customer_name ILIKE $${i} OR f.sku ILIKE $${i} OR f.product_name ILIKE $${i} OR r.tracking_number ILIKE $${i})`);
      params.push(`%${q.replace(/^@/, '')}%`);
      i++;
    }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    const result = await pool.query(
      `SELECT
        f.id, f.order_number, f.rma_name, f.customer_name, f.reason,
        f.sku, f.product_name, f.expected_qty, f.received_qty, f.condition,
        f.damage_checks, f.damage_notes, f.disposition, f.wrong_notes,
        f.created_at,
        w.initials as worker_initials, w.full_name as worker_name
       FROM return_line_flags f
       ${needsReturnJoin ? 'LEFT JOIN returns r ON f.return_id = r.id' : ''}
       LEFT JOIN workers w ON f.worker_id = w.id
       WHERE ${where.join(' AND ')}
       ORDER BY f.created_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    res.json({ success: true, count: result.rows.length, flags: result.rows });
  } catch (err) {
    console.error('[Flags Get Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MANUAL RETURN REFERENCE ──────────────────────────────────────────
app.post('/api/db/manual-ref', async (req, res) => {
  const { tracking_number, customer_name, order_number, reason, line_items, merchant_id } = req.body;
  const resolvedMerchantId = merchant_id || 1;
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as cnt FROM returns WHERE is_manual = true AND merchant_id = $1",
      [resolvedMerchantId]
    );
    const num = parseInt(result.rows[0].cnt) + 1;
    const ref = 'MAN-' + String(num).padStart(3, '0');
    const orderNum = order_number || ref;
    const skuFp = (line_items||[]).map(i=>i.sku).filter(Boolean).sort().join('|');

    // Save to rr_cache so all workstations can see it
    await pool.query(
      `INSERT INTO rr_cache (order_number, rr_name, rr_id, tracking_number, customer_name,
        line_items, sku_fingerprint, carrier, rr_created_at, synced_at, is_manual, merchant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'USPS',NOW(),NOW(),true,$8)
       ON CONFLICT (order_number) DO UPDATE SET
         tracking_number=EXCLUDED.tracking_number,
         customer_name=EXCLUDED.customer_name,
         line_items=EXCLUDED.line_items,
         merchant_id=EXCLUDED.merchant_id,
         synced_at=NOW()`,
      [orderNum, ref, ref, tracking_number||'', customer_name||'',
       JSON.stringify(line_items||[]), skuFp, resolvedMerchantId]
    );

    res.json({ success: true, ref, order_number: orderNum });
  } catch(err){
    console.error('[Manual Ref Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RR STATS API ─────────────────────────────────────────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/rr-stats', async (req, res) => {
  const { merchant_id } = req.query;
  try {
    let cacheWhere = '';
    let returnsWhere = '';
    let todayWhere = 'received_at >= CURRENT_DATE';
    const params = [];

    if (merchant_id) {
      params.push(parseInt(merchant_id));
      cacheWhere = `AND c.merchant_id = $1`;
      returnsWhere = `AND merchant_id = $1`;
      todayWhere += ` AND merchant_id = $1`;
    }

    // Count by status from line_items JSONB
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN line_items->0->>'status' IN (
          'Awaiting Refund Approval','Awaiting Exchange Approval',
          'Awaiting Qualification Approval','Added to processing queue',
          'Payment pending for this request'
        ) THEN 1 END) as open_rmas,
        COUNT(CASE WHEN line_items->0->>'status' = 'Added to processing queue' THEN 1 END) as in_transit,
        COUNT(CASE WHEN line_items->0->>'status' IN ('Refund Success','Exchange Success') THEN 1 END) as completed
      FROM rr_cache c
      WHERE order_number NOT IN (SELECT DISTINCT order_number FROM returns WHERE 1=1 ${returnsWhere})
      ${cacheWhere}
    `, params);
    // Arrived today = processed today
    const todayRes = await pool.query(`
      SELECT COUNT(*) as arrived_today
      FROM returns
      WHERE ${todayWhere}
    `, merchant_id ? [parseInt(merchant_id)] : []);
    res.json({
      success: true,
      open_rmas:     parseInt(result.rows[0].open_rmas||0),
      in_transit:    parseInt(result.rows[0].in_transit||0),
      arrived_today: parseInt(todayRes.rows[0].arrived_today||0),
      completed:     parseInt(result.rows[0].completed||0)
    });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

// ── DAYS HELD API ─────────────────────────────────────────────────────
// ?merchant_id=X filters to a specific merchant
app.get('/api/db/days-held', async (req, res) => {
  const { merchant_id } = req.query;
  try {
    let cacheWhere = '';
    let returnsWhere = '';
    const params = [];

    if (merchant_id) {
      params.push(parseInt(merchant_id));
      cacheWhere = `AND c.merchant_id = $1`;
      returnsWhere = `AND merchant_id = $1`;
    }

    const result = await pool.query(`
      SELECT
        c.order_number,
        c.customer_name,
        c.rr_created_at,
        c.line_items,
        c.carrier,
        c.merchant_id,
        EXTRACT(DAY FROM NOW() - c.rr_created_at)::int as days_held,
        CASE
          WHEN EXTRACT(DAY FROM NOW() - c.rr_created_at) <= 30 THEN 'green'
          WHEN EXTRACT(DAY FROM NOW() - c.rr_created_at) <= 60 THEN 'amber'
          ELSE 'red'
        END as status
      FROM rr_cache c
      WHERE c.order_number NOT IN (SELECT DISTINCT order_number FROM returns WHERE 1=1 ${returnsWhere})
      ${cacheWhere}
      ORDER BY days_held DESC
      LIMIT 500
    `, params);
    // Summary stats
    const rows = result.rows;
    const summary = {
      total: rows.length,
      green: rows.filter(r=>r.status==='green').length,
      amber: rows.filter(r=>r.status==='amber').length,
      red:   rows.filter(r=>r.status==='red').length,
      avg_days: rows.length ? Math.round(rows.reduce((s,r)=>s+parseInt(r.days_held||0),0)/rows.length) : 0
    };
    res.json({ success: true, summary, rows });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

// ── CLIENT RATES API ─────────────────────────────────────────────────
// ?merchant_id=X reads from merchants table; without it, legacy client_rates
app.get('/api/db/rates', async (req, res) => {
  const { merchant_id } = req.query;
  try {
    if (merchant_id) {
      const result = await pool.query(
        'SELECT good_rate, damaged_rate, updated_at FROM merchants WHERE id = $1',
        [parseInt(merchant_id)]
      );
      if (result.rows.length === 0) {
        return res.json({ success: true, good_rate: 4.00, damaged_rate: 4.00 });
      }
      return res.json({ success: true, merchant_id: parseInt(merchant_id), ...result.rows[0] });
    }
    // Legacy fallback
    const result = await pool.query(
      "SELECT good_rate, damaged_rate, updated_at FROM client_rates WHERE client='paragonfitwear' ORDER BY id DESC LIMIT 1"
    );
    if(result.rows.length === 0){
      return res.json({ success: true, good_rate: 4.00, damaged_rate: 4.00 });
    }
    res.json({ success: true, ...result.rows[0] });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

app.put('/api/db/rates', async (req, res) => {
  const { good_rate, damaged_rate, worker_id, merchant_id } = req.body;
  if(!good_rate || isNaN(good_rate)){
    return res.status(400).json({ error: 'good_rate required' });
  }
  const parsedGood = parseFloat(good_rate);
  const parsedDamaged = parseFloat(damaged_rate || good_rate);
  try {
    if (merchant_id) {
      // Write to merchants table
      await pool.query(
        'UPDATE merchants SET good_rate = $1, damaged_rate = $2, updated_at = NOW() WHERE id = $3',
        [parsedGood, parsedDamaged, parseInt(merchant_id)]
      );
      // Also sync to client_rates for backward compatibility
      await pool.query(
        `UPDATE client_rates SET good_rate = $1, damaged_rate = $2, updated_by = $3, updated_at = NOW()
         WHERE merchant_id = $4`,
        [parsedGood, parsedDamaged, worker_id || null, parseInt(merchant_id)]
      );
    } else {
      // Legacy path
      await pool.query(
        "UPDATE client_rates SET good_rate=$1, damaged_rate=$2, updated_by=$3, updated_at=NOW() WHERE client='paragonfitwear'",
        [parsedGood, parsedDamaged, worker_id||null]
      );
    }
    res.json({ success: true, good_rate: parsedGood, damaged_rate: parsedDamaged });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

// ── WORKERS API ───────────────────────────────────────────────────────
app.get('/api/db/workers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, initials, role, last_login_at, created_at
       FROM workers ORDER BY full_name ASC`
    );
    res.json({ success: true, workers: result.rows });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

app.post('/api/db/workers', async (req, res) => {
  const { full_name, initials, pin, role, billing } = req.body;
  if(!full_name || !initials || !pin)
    return res.status(400).json({ error: 'full_name, initials, pin required' });
  if(!/^\d{4}$/.test(pin))
    return res.status(400).json({ error: 'PIN must be 4 digits' });
  try {
    const result = await pool.query(
      `INSERT INTO workers (full_name, initials, pin_hash, role, billing)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [full_name, initials.toUpperCase(), pin, role||'Worker', billing||false]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch(err){
    if(err.code === '23505') return res.status(400).json({ error: 'Initials already exist' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/db/workers/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, initials, pin, role, billing } = req.body;
  if(!full_name || !initials)
    return res.status(400).json({ error: 'full_name and initials required' });
  if(pin && !/^\d{4}$/.test(pin))
    return res.status(400).json({ error: 'PIN must be 4 digits' });
  try {
    let query, params;
    if(pin){
      query = `UPDATE workers SET full_name=$1, initials=$2, pin_hash=$3, role=$4 WHERE id=$5 RETURNING id`;
      params = [full_name, initials.toUpperCase(), pin, role||'Worker', id];
    } else {
      query = `UPDATE workers SET full_name=$1, initials=$2, role=$3 WHERE id=$4 RETURNING id`;
      params = [full_name, initials.toUpperCase(), role||'Worker', id];
    }
    const result = await pool.query(query, params);
    if(result.rows.length === 0) return res.status(404).json({ error: 'Worker not found' });
    res.json({ success: true });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

// ── HEALTH CHECK update — include DB status ───────────
app.get('/api/db/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as worker_count FROM workers');
    const syncRes = await pool.query(
      "SELECT last_sync_run_at, records_added, status FROM sync_checkpoints ORDER BY id DESC LIMIT 1"
    );
    res.json({
      status: 'ok',
      db: 'connected',
      workers: result.rows[0].worker_count,
      last_sync: syncRes.rows[0] || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════
// RETURNHUB — QZ TRAY PRINT SYSTEM ADDITIONS
// Insert these routes into server.js BEFORE the catch-all GET * route
// Also add: const crypto = require('crypto'); at the top with other requires
// ══════════════════════════════════════════════════════════════════════

// ── ZPL LABEL ENGINE ──────────────────────────────────────────────────

const STOCK_PROFILES = {
  // 300 DPI profiles
  '2x1-300': {
    stock: '2x1', dpi: 300, pw: 600, ll: 300,
    desc: null, // no room for description on 2x1
    barcode: { x: 75, y: 20, module: 2, ratio: 3, height: 120 },
    sku: { x: 30, y: 160, w: 540, maxLines: 1, fontSizes: [36, 30, 24] }
  },
  '3x2-300': {
    stock: '3x2', dpi: 300, pw: 900, ll: 600,
    barcode: { x: 165, y: 30, module: 3, ratio: 3, height: 150 },
    sku: { x: 60, y: 200, w: 780, maxLines: 1, lineGap: 0, fontSizes: [42, 36, 30] },
    desc: { x: 60, y: 280, w: 780, maxLines: 3, lineGap: 6, fontSizes: [36, 30, 26, 22, 18] }
  },
  '4x2-300': {
    stock: '4x2', dpi: 300, pw: 1200, ll: 600,
    barcode: { x: 315, y: 30, module: 3, ratio: 3, height: 150 },
    sku: { x: 60, y: 200, w: 1080, maxLines: 1, lineGap: 0, fontSizes: [42, 36, 30] },
    desc: { x: 60, y: 280, w: 1080, maxLines: 3, lineGap: 6, fontSizes: [36, 30, 26, 22] }
  },
  '4x3-300': {
    stock: '4x3', dpi: 300, pw: 1200, ll: 900,
    barcode: { x: 265, y: 40, module: 3, ratio: 3, height: 200 },
    sku: { x: 60, y: 270, w: 1080, maxLines: 1, lineGap: 0, fontSizes: [48, 42, 36] },
    desc: { x: 60, y: 380, w: 1080, maxLines: 4, lineGap: 6, fontSizes: [42, 36, 30, 26] }
  },
  '4x6-300': {
    stock: '4x6', dpi: 300, pw: 1200, ll: 1800,
    barcode: { x: 215, y: 60, module: 4, ratio: 3, height: 280 },
    sku: { x: 60, y: 380, w: 1080, maxLines: 1, lineGap: 0, fontSizes: [52, 46, 40] },
    desc: { x: 60, y: 500, w: 1080, maxLines: 4, lineGap: 8, fontSizes: [42, 36, 30, 26] }
  },
  // 203 DPI profiles
  '2x1-203': {
    stock: '2x1', dpi: 203, pw: 406, ll: 203,
    desc: null,
    barcode: { x: 50, y: 14, module: 2, ratio: 3, height: 80 },
    sku: { x: 20, y: 108, w: 366, maxLines: 1, fontSizes: [24, 20, 18] }
  },
  '3x2-203': {
    stock: '3x2', dpi: 203, pw: 610, ll: 406,
    barcode: { x: 110, y: 20, module: 2, ratio: 3, height: 100 },
    sku: { x: 40, y: 135, w: 530, maxLines: 1, lineGap: 0, fontSizes: [28, 24, 20] },
    desc: { x: 40, y: 190, w: 530, maxLines: 3, lineGap: 4, fontSizes: [24, 20, 18, 16] }
  },
  '4x2-203': {
    stock: '4x2', dpi: 203, pw: 812, ll: 406,
    barcode: { x: 210, y: 20, module: 2, ratio: 3, height: 100 },
    sku: { x: 40, y: 135, w: 732, maxLines: 1, lineGap: 0, fontSizes: [28, 24, 20] },
    desc: { x: 40, y: 190, w: 732, maxLines: 3, lineGap: 4, fontSizes: [24, 20, 18, 16] }
  },
  '4x3-203': {
    stock: '4x3', dpi: 203, pw: 812, ll: 609,
    barcode: { x: 180, y: 28, module: 2, ratio: 3, height: 140 },
    sku: { x: 40, y: 184, w: 732, maxLines: 1, lineGap: 0, fontSizes: [32, 28, 24] },
    desc: { x: 40, y: 256, w: 732, maxLines: 4, lineGap: 4, fontSizes: [26, 22, 20, 18] }
  },
  '4x6-203': {
    stock: '4x6', dpi: 203, pw: 812, ll: 1218,
    barcode: { x: 146, y: 40, module: 3, ratio: 3, height: 190 },
    sku: { x: 40, y: 260, w: 732, maxLines: 1, lineGap: 0, fontSizes: [34, 30, 26] },
    desc: { x: 40, y: 340, w: 732, maxLines: 4, lineGap: 6, fontSizes: [28, 24, 20, 18] }
  },
};

function resolveStockProfile(stock, dpi) {
  const key = `${stock}-${dpi}`;
  return STOCK_PROFILES[key] || STOCK_PROFILES['3x2-300'];
}

function estimateTextWidth(text, fontSize) {
  // ZPL A0 font: approximate character width ≈ fontSize * 0.6
  return text.length * fontSize * 0.6;
}

function fitText(text, maxWidth, fontSizes) {
  const clean = (text || '').replace(/[<>&"]/g, ' ').trim();
  for (const size of fontSizes) {
    if (estimateTextWidth(clean, size) <= maxWidth) {
      return { text: clean, fontSize: size };
    }
  }
  // Truncate with ellipsis at smallest font
  const smallest = fontSizes[fontSizes.length - 1];
  const maxChars = Math.floor(maxWidth / (smallest * 0.6)) - 3;
  return { text: clean.substring(0, maxChars) + '...', fontSize: smallest };
}

function generateZPL(sku, description, stock, dpi, copies) {
  const profile = resolveStockProfile(stock, dpi);
  const cleanSku = (sku || '').replace(/[^A-Z0-9\-\/\.]/gi, '').substring(0, 40);
  const lines = [];

  lines.push('^XA');
  lines.push('^CI28');
  lines.push(`^PW${profile.pw}`);
  lines.push(`^LL${profile.ll}`);
  lines.push('^LH0,0');

  // 1. Barcode zone (Code 128) — TOP, auto-sized and centered
  if (cleanSku) {
    const bc = profile.barcode;
    // Code 128 width ≈ (11 * (chars + 3) + 2) * module
    // Auto-select module width to fit within label width with margins
    const availWidth = profile.pw - 40; // 20px margin each side
    let module = bc.module;
    for (let m = bc.module; m >= 1; m--) {
      const barcodeWidth = (11 * (cleanSku.length + 3) + 2) * m;
      if (barcodeWidth <= availWidth) { module = m; break; }
      module = m;
    }
    const barcodeWidth = (11 * (cleanSku.length + 3) + 2) * module;
    const centerX = Math.max(20, Math.round((profile.pw - barcodeWidth) / 2));
    // Scale height proportionally if module shrunk
    const height = bc.height;

    lines.push(`^BY${module},${bc.ratio},${height}`);
    lines.push(`^FO${centerX},${bc.y}`);
    lines.push(`^BCN,${height},N,N,N`);
    lines.push(`^FD${cleanSku}^FS`);
  }

  // 2. Human-readable SKU — BELOW BARCODE, centered
  if (cleanSku && profile.sku) {
    const s = profile.sku;
    const fitted = fitText(cleanSku, s.w, s.fontSizes);
    lines.push(`^FO${s.x},${s.y}`);
    lines.push(`^A0N,${fitted.fontSize},${fitted.fontSize}`);
    lines.push(`^FB${s.w},${s.maxLines},${s.lineGap || 0},C,0`);
    lines.push(`^FD${fitted.text}^FS`);
  }

  // 3. Description — BOTTOM (full text, wraps with ^FB, font ladder scales down to fit)
  if (profile.desc && description) {
    const d = profile.desc;
    const cleanDesc = (description || '').replace(/[<>&"]/g, ' ').trim();
    let chosenSize = d.fontSizes[d.fontSizes.length - 1];
    for (const size of d.fontSizes) {
      const charsPerLine = Math.floor(d.w / (size * 0.6));
      const linesNeeded = Math.ceil(cleanDesc.length / charsPerLine);
      if (linesNeeded <= d.maxLines) {
        chosenSize = size;
        break;
      }
    }
    lines.push(`^FO${d.x},${d.y}`);
    lines.push(`^A0N,${chosenSize},${chosenSize}`);
    lines.push(`^FB${d.w},${d.maxLines},${d.lineGap || 0},C,0`);
    lines.push(`^FD${cleanDesc}^FS`);
  }

  // Copies
  if (copies && copies > 1) {
    lines.push(`^PQ${copies},0,1,Y`);
  }

  lines.push('^XZ');
  return lines.join('\n');
}

// ── PRINT CONFIG ──────────────────────────────────────────────────────

app.get('/api/print/config', (req, res) => {
  res.json({
    success: true,
    printMode: process.env.PRINT_MODE || 'hybrid',
    qzEnabled: process.env.QZ_ENABLED !== 'false',
    barTenderFallbackEnabled: (process.env.BARTENDER_FALLBACK_ENABLED || 'true') === 'true',
    defaultStock: process.env.DEFAULT_LABEL_STOCK || '3x2',
    defaultDpi: parseInt(process.env.DEFAULT_LABEL_DPI) || 300,
    defaultPrintMethod: process.env.DEFAULT_PRINT_METHOD || 'direct_thermal',
    qzDownloads: {
      windows: process.env.QZ_DOWNLOAD_WINDOWS || 'https://github.com/qzind/tray/releases/download/v2.2.6/qz-tray-2.2.6.exe',
      mac: process.env.QZ_DOWNLOAD_MAC || 'https://github.com/qzind/tray/releases/download/v2.2.6/qz-tray-2.2.6.pkg',
      linux: process.env.QZ_DOWNLOAD_LINUX || 'https://github.com/qzind/tray/releases/download/v2.2.6/qz-tray-2.2.6.run',
    },
    stockProfiles: Object.keys(STOCK_PROFILES),
  });
});

// ── QZ TRAY SECURITY ──────────────────────────────────────────────────

app.get('/api/qz/certificate', (req, res) => {
  let cert = process.env.QZ_PUBLIC_CERT_PEM || '';
  if (!cert) { try { cert = require('fs').readFileSync(require('path').join(__dirname, 'qz-certificate.pem'), 'utf8'); } catch(e){} }
  if (!cert) {
    return res.status(500).send('QZ_PUBLIC_CERT_PEM not configured');
  }
  res.type('text/plain').send(cert);
});

app.post('/api/qz/sign', (req, res) => {
  const { toSign } = req.body;
  if (!toSign) {
    return res.status(400).json({ error: 'toSign is required' });
  }
  let privateKey = process.env.QZ_PRIVATE_KEY_PEM;
  if (!privateKey) { try { privateKey = require('fs').readFileSync(require('path').join(__dirname, 'qz-private-key.pem'), 'utf8'); } catch(e){} }
  if (!privateKey) {
    return res.status(500).json({ error: 'QZ_PRIVATE_KEY_PEM not configured' });
  }
  try {
    const signer = crypto.createSign('SHA512');
    signer.update(toSign);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');
    res.json({ signature });
  } catch (err) {
    console.error('[QZ Sign Error]', err.message);
    res.status(500).json({ error: 'Signing failed: ' + err.message });
  }
});

// ── PRINTER PREFERENCES ───────────────────────────────────────────────

app.get('/api/db/printer-preferences', async (req, res) => {
  const { workstation_key, station } = req.query;
  if (!workstation_key || !station) {
    return res.status(400).json({ error: 'workstation_key and station required' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM workstation_printer_preferences WHERE workstation_key = $1 AND station = $2 AND is_active = true',
      [workstation_key, station]
    );
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        preference: null,
        defaults: {
          use_default_printer: true,
          dpi: parseInt(process.env.DEFAULT_LABEL_DPI) || 300,
          stock: process.env.DEFAULT_LABEL_STOCK || '3x2',
          print_method: process.env.DEFAULT_PRINT_METHOD || 'direct_thermal',
        }
      });
    }
    res.json({ success: true, preference: result.rows[0] });
  } catch (err) {
    console.error('[Printer Prefs Get Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/db/printer-preferences', async (req, res) => {
  const { workstation_key, station, use_default_printer, printer_name, dpi, stock, print_method } = req.body;
  if (!workstation_key || !station) {
    return res.status(400).json({ error: 'workstation_key and station required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO workstation_printer_preferences
        (workstation_key, station, use_default_printer, printer_name, dpi, stock, print_method, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (workstation_key, station) DO UPDATE SET
        use_default_printer = EXCLUDED.use_default_printer,
        printer_name = EXCLUDED.printer_name,
        dpi = EXCLUDED.dpi,
        stock = EXCLUDED.stock,
        print_method = EXCLUDED.print_method,
        updated_at = NOW()
       RETURNING *`,
      [
        workstation_key, station,
        use_default_printer !== false,
        printer_name || null,
        dpi || 300,
        stock || '3x2',
        print_method || 'direct_thermal'
      ]
    );
    res.json({ success: true, preference: result.rows[0] });
  } catch (err) {
    console.error('[Printer Prefs Save Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PRINT JOB: Create + generate ZPL ─────────────────────────────────

app.post('/api/labels/print-job', async (req, res) => {
  const {
    return_id, session_id, worker_id, workstation_key,
    station, sku, description, copies, stock, dpi, print_method
  } = req.body;

  if (!sku) {
    return res.status(400).json({ error: 'sku is required' });
  }

  const resolvedStock = stock || process.env.DEFAULT_LABEL_STOCK || '3x2';
  const resolvedDpi = parseInt(dpi) || parseInt(process.env.DEFAULT_LABEL_DPI) || 300;
  const resolvedMethod = print_method || process.env.DEFAULT_PRINT_METHOD || 'direct_thermal';
  const resolvedCopies = parseInt(copies) || 1;
  const printMode = process.env.PRINT_MODE || 'hybrid';

  // Generate ZPL
  const zpl = generateZPL(sku, description, resolvedStock, resolvedDpi, resolvedCopies);

  try {
    // Insert print job record
    const result = await pool.query(
      `INSERT INTO print_jobs
        (return_id, session_id, worker_id, workstation_key, station,
         print_mode, copies, sku, description, zpl, status,
         printer_dpi, stock, print_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued', $11, $12, $13)
       RETURNING id`,
      [
        return_id || null, session_id || null, worker_id || null,
        workstation_key || null, station || null,
        printMode, resolvedCopies, sku, description || null, zpl,
        resolvedDpi, resolvedStock, resolvedMethod
      ]
    );

    res.json({
      success: true,
      jobId: result.rows[0].id,
      printMode,
      resolved: {
        station: station || null,
        stock: resolvedStock,
        dpi: resolvedDpi,
        print_method: resolvedMethod,
        copies: resolvedCopies,
      },
      zpl,
    });
  } catch (err) {
    console.error('[Print Job Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PRINT JOB: Update status ──────────────────────────────────────────

app.put('/api/db/print-jobs/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, printer_name, transport, response_json, error_text } = req.body;

  const validStatuses = ['queued', 'printing', 'success', 'failed', 'fallback'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: ' + validStatuses.join(', ') });
  }

  try {
    const result = await pool.query(
      `UPDATE print_jobs SET
        status = $1,
        printer_name = COALESCE($2, printer_name),
        transport = COALESCE($3, transport),
        response_json = COALESCE($4, response_json),
        error_text = $5,
        completed_at = CASE WHEN $1 IN ('success', 'failed') THEN NOW() ELSE completed_at END
       WHERE id = $6
       RETURNING id, return_id, status`,
      [status, printer_name || null, transport || null,
       response_json ? JSON.stringify(response_json) : null,
       error_text || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Print job not found' });
    }

    // On success, update returns.label_printed
    const job = result.rows[0];
    if (status === 'success' && job.return_id) {
      await pool.query(
        'UPDATE returns SET label_printed = TRUE, label_printed_at = NOW() WHERE id = $1',
        [job.return_id]
      );
    }

    res.json({ success: true, id: job.id, status: job.status });
  } catch (err) {
    console.error('[Print Job Status Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LABEL PREVIEW ─────────────────────────────────────────────────────

app.post('/api/labels/preview', (req, res) => {
  const { sku, description, stock, dpi } = req.body;
  if (!sku) {
    return res.status(400).json({ error: 'sku is required' });
  }
  const zpl = generateZPL(sku, description, stock || '3x2', dpi || 300, 1);
  // Return ZPL as text — frontend renders preview via CSS or Labelary
  res.json({
    success: true,
    zpl,
    profile: resolveStockProfile(stock || '3x2', dpi || 300),
  });
});


// ══════════════════════════════════════════════════════════════════════
// RETURNHUB — MERCHANT MANAGEMENT ROUTES
// Insert into server.js BEFORE the catch-all GET * route
// ══════════════════════════════════════════════════════════════════════

// ── MERCHANTS: List all ───────────────────────────────────────────────
app.get('/api/db/merchants', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, platform, api_url, shopify_domain,
              contact_email, billing_email, good_rate, damaged_rate,
              label_template, sync_enabled, sync_interval_hours,
              active, settings, created_at, updated_at
       FROM merchants
       ORDER BY name ASC`
    );
    res.json({ success: true, merchants: result.rows });
  } catch (err) {
    console.error('[Merchants List Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Get single ─────────────────────────────────────────────
app.get('/api/db/merchants/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, platform, api_url, shopify_domain,
              contact_email, billing_email, good_rate, damaged_rate,
              label_template, sync_enabled, sync_interval_hours,
              active, settings, created_at, updated_at
       FROM merchants WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ success: true, merchant: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Create ─────────────────────────────────────────────────
app.post('/api/db/merchants', async (req, res) => {
  const {
    name, slug, platform, api_key, api_url, shopify_domain,
    contact_email, billing_email, good_rate, damaged_rate,
    label_template, sync_enabled, sync_interval_hours, settings
  } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens/underscores only' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO merchants (
        name, slug, platform, api_key, api_url, shopify_domain,
        contact_email, billing_email, good_rate, damaged_rate,
        label_template, sync_enabled, sync_interval_hours, settings
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id`,
      [
        name, slug.toLowerCase(),
        platform || 'return_rabbit',
        api_key || null,
        api_url || null,
        shopify_domain || null,
        contact_email || null,
        billing_email || null,
        parseFloat(good_rate) || 4.00,
        parseFloat(damaged_rate) || 4.00,
        label_template || 'standard',
        sync_enabled !== false,
        parseInt(sync_interval_hours) || 24,
        settings ? JSON.stringify(settings) : '{}'
      ]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already exists' });
    console.error('[Merchant Create Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Update ─────────────────────────────────────────────────
app.put('/api/db/merchants/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, slug, platform, api_key, api_url, shopify_domain,
    contact_email, billing_email, good_rate, damaged_rate,
    label_template, sync_enabled, sync_interval_hours, active, settings
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const result = await pool.query(
      `UPDATE merchants SET
        name = $1, slug = COALESCE($2, slug), platform = COALESCE($3, platform),
        api_key = COALESCE($4, api_key), api_url = COALESCE($5, api_url),
        shopify_domain = COALESCE($6, shopify_domain),
        contact_email = COALESCE($7, contact_email),
        billing_email = COALESCE($8, billing_email),
        good_rate = COALESCE($9, good_rate),
        damaged_rate = COALESCE($10, damaged_rate),
        label_template = COALESCE($11, label_template),
        sync_enabled = COALESCE($12, sync_enabled),
        sync_interval_hours = COALESCE($13, sync_interval_hours),
        active = COALESCE($14, active),
        settings = COALESCE($15, settings),
        updated_at = NOW()
       WHERE id = $16
       RETURNING id`,
      [
        name,
        slug ? slug.toLowerCase() : null,
        platform || null,
        api_key !== undefined ? api_key : null,
        api_url || null,
        shopify_domain || null,
        contact_email || null,
        billing_email || null,
        good_rate ? parseFloat(good_rate) : null,
        damaged_rate ? parseFloat(damaged_rate) : null,
        label_template || null,
        sync_enabled !== undefined ? sync_enabled : null,
        sync_interval_hours ? parseInt(sync_interval_hours) : null,
        active !== undefined ? active : null,
        settings ? JSON.stringify(settings) : null,
        id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already exists' });
    console.error('[Merchant Update Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Get rates for a merchant ───────────────────────────────
app.get('/api/db/merchants/:id/rates', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT good_rate, damaged_rate, updated_at FROM merchants WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Update rates for a merchant ────────────────────────────
app.put('/api/db/merchants/:id/rates', async (req, res) => {
  const { good_rate, damaged_rate, worker_id } = req.body;
  if (!good_rate || isNaN(good_rate)) {
    return res.status(400).json({ error: 'good_rate required' });
  }
  try {
    await pool.query(
      'UPDATE merchants SET good_rate = $1, damaged_rate = $2, updated_at = NOW() WHERE id = $3',
      [parseFloat(good_rate), parseFloat(damaged_rate || good_rate), req.params.id]
    );
    // Also update client_rates for backward compatibility
    await pool.query(
      `UPDATE client_rates SET good_rate = $1, damaged_rate = $2, updated_by = $3, updated_at = NOW()
       WHERE merchant_id = $4`,
      [parseFloat(good_rate), parseFloat(damaged_rate || good_rate), worker_id || null, req.params.id]
    );
    res.json({ success: true, good_rate: parseFloat(good_rate), damaged_rate: parseFloat(damaged_rate || good_rate) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Billing report for a merchant ──────────────────────────
app.get('/api/db/merchants/:id/billing', async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from) return res.status(400).json({ error: 'date_from required' });
  try {
    const where = ['merchant_id = $1', 'received_at >= $2'];
    const params = [req.params.id, date_from];
    if (date_to) { where.push('received_at <= $3'); params.push(date_to); }
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_returns,
        COUNT(CASE WHEN condition = 'Good' THEN 1 END) as total_good,
        COUNT(CASE WHEN condition = 'Damaged' THEN 1 END) as total_damaged,
        COUNT(CASE WHEN condition = 'Not Returned' THEN 1 END) as total_not_returned,
        SUM(CASE WHEN condition = 'Good' THEN billed_amount ELSE 0 END) as good_revenue,
        SUM(CASE WHEN condition = 'Damaged' THEN billed_amount ELSE 0 END) as damaged_revenue,
        SUM(billed_amount) as total_revenue,
        SUM(CASE WHEN billing_rate > 0 THEN ROUND(billed_amount / billing_rate) ELSE 0 END) as total_units
       FROM returns
       WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ success: true, billing: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Returns search for a merchant ──────────────────────────
app.get('/api/db/merchants/:id/returns', async (req, res) => {
  const { q, condition, worker_id, date_from, date_to, limit = 100, offset = 0 } = req.query;
  try {
    let where = ['r.merchant_id = $1'];
    let params = [req.params.id];
    let i = 2;
    if (q) {
      where.push(`(r.order_number ILIKE $${i} OR r.tracking_number ILIKE $${i} OR r.customer_name ILIKE $${i})`);
      params.push(`%${q}%`); i++;
    }
    if (condition) { where.push(`r.condition = $${i}`); params.push(condition); i++; }
    if (worker_id) { where.push(`r.worker_id = $${i}`); params.push(worker_id); i++; }
    if (date_from) { where.push(`r.received_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`r.received_at <= $${i}`); params.push(date_to); i++; }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    const result = await pool.query(
      `SELECT r.*, w.initials as worker_initials, w.full_name as worker_name
       FROM returns r
       LEFT JOIN workers w ON r.worker_id = w.id
       WHERE ${where.join(' AND ')}
       ORDER BY r.received_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    res.json({ success: true, count: result.rows.length, returns: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Flags for a merchant ───────────────────────────────────
app.get('/api/db/merchants/:id/flags', async (req, res) => {
  const { condition, date_from, date_to, limit = 500, offset = 0 } = req.query;
  try {
    let where = ['r.merchant_id = $1'];
    let params = [req.params.id];
    let i = 2;
    if (condition && condition !== 'all') { where.push(`f.condition = $${i}`); params.push(condition); i++; }
    if (date_from) { where.push(`f.created_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`f.created_at <= $${i}`); params.push(date_to); i++; }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    const result = await pool.query(
      `SELECT f.*, w.initials as worker_initials, w.full_name as worker_name
       FROM return_line_flags f
       JOIN returns r ON f.return_id = r.id
       LEFT JOIN workers w ON f.worker_id = w.id
       WHERE ${where.join(' AND ')}
       ORDER BY f.created_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    res.json({ success: true, count: result.rows.length, flags: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCHANTS: Productivity for a merchant ────────────────────────────
app.get('/api/db/merchants/:id/productivity', async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from) return res.status(400).json({ error: 'date_from required' });
  try {
    const where = ['r.merchant_id = $1', 'r.received_at >= $2'];
    const params = [req.params.id, date_from];
    if (date_to) { where.push('r.received_at <= $3'); params.push(date_to); }
    const result = await pool.query(
      `SELECT
        w.id as worker_id, w.initials, w.full_name,
        COUNT(*) as total_returns,
        SUM(CASE WHEN r.billing_rate > 0 THEN ROUND(r.billed_amount / r.billing_rate) ELSE 0 END) as total_units,
        SUM(r.billed_amount) as total_revenue,
        COUNT(CASE WHEN r.condition = 'Good' THEN 1 END) as good_count,
        COUNT(CASE WHEN r.condition = 'Damaged' THEN 1 END) as damaged_count
       FROM returns r
       JOIN workers w ON r.worker_id = w.id
       WHERE ${where.join(' AND ')}
       GROUP BY w.id, w.initials, w.full_name
       ORDER BY total_units DESC`,
      params
    );
    res.json({ success: true, workers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SYNC TRIGGER: Manual sync for a specific merchant (POST) ─────────
// Kept for backward compatibility — the GET version below also works
app.post('/api/db/sync/:merchantId/trigger', async (req, res) => {
  const mid = parseInt(req.params.merchantId);
  if (!mid) return res.status(400).json({ error: 'Invalid merchant ID' });
  try {
    const mRes = await pool.query(
      'SELECT id, name, platform, api_key, api_url, good_rate FROM merchants WHERE id = $1 AND active = true',
      [mid]
    );
    if (mRes.rows.length === 0) return res.status(404).json({ error: 'Merchant not found or inactive' });
    const merchant = mRes.rows[0];
    if (!merchant.api_key && !process.env.RR_TOKEN) {
      return res.status(400).json({ error: `No API key for ${merchant.name}` });
    }
    res.json({ success: true, message: `Sync triggered for ${merchant.name}` });
    syncMerchant(merchant).catch(err => {
      console.error(`[Manual Sync POST] merchant ${mid} failed:`, err.message);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AFTERSHIP RETURNS WEBHOOK ────────────────────────────────────────
// AfterShip pushes return events here instead of us pulling.
// Saves to BOTH rr_cache (reference) AND returns + return_line_items (permanent billing record).
// Endpoint URL: https://returnhub-production.up.railway.app/api/webhooks/aftership/:merchantId
app.post('/api/webhooks/aftership/:merchantId', async (req, res) => {
  const merchantId = parseInt(req.params.merchantId);
  if (!merchantId) return res.status(400).json({ error: 'Invalid merchant ID' });

  try {
    // Verify merchant exists
    const mRes = await pool.query(
      'SELECT id, name, platform, settings, good_rate, damaged_rate FROM merchants WHERE id = $1 AND active = true',
      [merchantId]
    );
    if (mRes.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    const merchant = mRes.rows[0];

    // Optional: verify webhook signature
    const webhookSecret = merchant.settings?.webhook_secret;
    if (webhookSecret) {
      const signature = req.headers['aftership-hmac-sha256'] || req.headers['x-aftership-hmac-sha256'] || '';
      if (signature) {
        const expected = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('base64');
        if (signature !== expected) {
          console.error(`[AfterShip Webhook] Invalid signature for merchant ${merchantId}`);
          return res.status(401).json({ error: 'Invalid webhook signature' });
        }
      }
    }

    const payload = req.body;
    const eventType = payload.event || payload.topic || 'unknown';
    console.log(`[AfterShip Webhook] merchant ${merchantId}: event=${eventType}`);

    // The return data may be at different nesting levels
    const ret = payload.return || payload.data?.return || payload.data || payload;

    if (!ret || (!ret.order_name && !ret.order_number && !ret.id)) {
      console.log(`[AfterShip Webhook] merchant ${merchantId}: no return data in event '${eventType}', acknowledging`);
      return res.json({ success: true, message: 'Event acknowledged, no return data to process' });
    }

    // Map line items
    const lineItems = (ret.items || ret.line_items || ret.return_line_items || []).map(li => ({
      sku:          li.sku || li.variant_sku || null,
      product_name: li.title || li.product_title || li.product_name || li.name || null,
      variant:      li.variant_title || li.variant || null,
      quantity:     parseInt(li.quantity || 1),
      reason:       li.return_reason || li.reason || null,
      image_url:    li.image_url || li.product_image || null,
      status:       li.status || li.state || null,
    }));

    const skus = lineItems.map(li => li.sku).filter(Boolean).sort();
    const skuFingerprint = skus.join('|');

    // Tracking
    const rawTracking = ret.tracking_number
      || ret.shipment?.tracking_number
      || ret.label?.tracking_number
      || ret.prepaid_label?.tracking_number
      || '';
    const tracking = extractTracking(rawTracking);
    const zipMatch = rawTracking.match(/^420(\d{5})/);
    const customerZip = zipMatch ? zipMatch[1] : (ret.shipping_address?.zip || ret.shipping_address?.postal_code || null);
    const carrier = detectCarrier(tracking);

    // Customer name
    const customerName = ret.customer_name
      || ret.customer?.name
      || ret.customer?.full_name
      || [ret.customer?.first_name, ret.customer?.last_name].filter(Boolean).join(' ')
      || ret.shipping_address?.name
      || '';

    // Order reference
    const orderNumber = ret.order_name || ret.order_number || ret.shopify_order_name || `AS-${ret.id}`;
    const rmaName = ret.rma_number || ret.return_number || (ret.id ? `AS-${ret.id}` : null);
    const rmaId = String(ret.id || ret.return_id || '');
    const createdAt = ret.created_at || ret.created || new Date().toISOString();

    // Save to rr_cache (worker processes into returns table later)
    await upsertCacheRecord({
      order_number:    orderNumber,
      rr_name:         ret.rma_number || ret.return_number || (ret.id ? `AS-${ret.id}` : null),
      rr_id:           String(ret.id || ret.return_id || ''),
      tracking_number: tracking,
      customer_name:   customerName,
      customer_zip:    customerZip,
      line_items:      lineItems,
      sku_fingerprint: skuFingerprint,
      carrier:         carrier,
      created_at:      ret.created_at || ret.created || new Date().toISOString(),
    }, merchantId);

    console.log(`[AfterShip Webhook] merchant ${merchantId}: saved ${orderNumber} to rr_cache (${eventType})`);
    res.json({ success: true, order_number: orderNumber, event: eventType });

  } catch (err) {
    console.error(`[AfterShip Webhook Error] merchant ${merchantId}:`, err.message);
    // Return 200 to prevent AfterShip from retrying endlessly
    res.json({ success: false, error: err.message });
  }
});

// ── CATCH-ALL — serve dashboard for any unknown route ─
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────
// ── SYNC ADAPTERS — Platform-specific sync logic ─────────────────────
// Each adapter fetches returns from a platform API and upserts into rr_cache.
// Adding a new platform = adding one new function + one case in syncMerchant().

// Shared: parse tracking number from raw value
function extractTracking(rawTracking) {
  const trackingMatch = rawTracking.match(/((?:9[0-9]{3}|82)[0-9]{17,19})/);
  return trackingMatch ? trackingMatch[1] : rawTracking;
}

// Shared: detect carrier from tracking number
function detectCarrier(tracking) {
  if (tracking.startsWith('1Z')) return 'UPS';
  if (/^[0-9]{12,22}$/.test(tracking) && !tracking.startsWith('9')) return 'FedEx';
  return 'USPS';
}

// Shared: upsert a normalized record into rr_cache
async function upsertCacheRecord(rec, merchantId) {
  await pool.query(
    `INSERT INTO rr_cache (order_number, rr_name, rr_id, tracking_number, customer_name, customer_zip, line_items, sku_fingerprint, carrier, rr_created_at, synced_at, merchant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
     ON CONFLICT (order_number) DO UPDATE SET
       rr_name=EXCLUDED.rr_name, rr_id=EXCLUDED.rr_id,
       tracking_number=EXCLUDED.tracking_number, customer_name=EXCLUDED.customer_name,
       customer_zip=EXCLUDED.customer_zip, line_items=EXCLUDED.line_items,
       sku_fingerprint=EXCLUDED.sku_fingerprint, carrier=EXCLUDED.carrier,
       rr_created_at=EXCLUDED.rr_created_at, merchant_id=EXCLUDED.merchant_id, synced_at=NOW()`,
    [rec.order_number, rec.rr_name, rec.rr_id, rec.tracking_number,
     rec.customer_name, rec.customer_zip, JSON.stringify(rec.line_items),
     rec.sku_fingerprint, rec.carrier, rec.created_at, merchantId]
  );
}

// ── ADAPTER: Return Rabbit ──────────────────────────────────────────
// Auth: Authorization: Token <api_key>
// Endpoint: /api/v1/service-requests/?page=N&page_size=50&ordering=-created
async function syncReturnRabbit(merchant) {
  const CUTOFF = '2026-01-01T00:00:00Z';
  const MAX_PAGES = 400;
  const apiToken = merchant.api_key || process.env.RR_TOKEN;
  const apiBaseUrl = merchant.api_url || process.env.RR_BASE_URL || 'https://api.returnrabbit.app';

  if (!apiToken) {
    throw new Error(`No API token for merchant ${merchant.id} (${merchant.name})`);
  }

  const checkpointRes = await pool.query(
    `SELECT last_synced_at FROM sync_checkpoints
     WHERE source = 'return_rabbit' AND merchant_id = $1
     ORDER BY id DESC LIMIT 1`,
    [merchant.id]
  );
  const lastSyncedAt = checkpointRes.rows.length > 0
    ? new Date(checkpointRes.rows[0].last_synced_at)
    : new Date(CUTOFF);

  let page = 1, recordsAdded = 0, pagesFetched = 0, done = false;
  let newestCreatedAt = lastSyncedAt;

  while (!done && page <= MAX_PAGES) {
    const url = `${apiBaseUrl}/api/v1/service-requests/?page=${page}&page_size=50&ordering=-created`;
    const rrRes = await fetch(url, {
      headers: { 'Authorization': `Token ${apiToken}`, 'Accept': 'application/json', 'Cache-Control': 'no-store' }
    });
    if (!rrRes.ok) throw new Error(`RR API error: ${rrRes.status}`);
    const data = await rrRes.json();
    pagesFetched++;
    const results = data.results || [];
    if (results.length === 0) break;

    for (const item of results) {
      const rrCreatedAt = new Date(item.created);
      if (rrCreatedAt <= lastSyncedAt) { done = true; break; }
      if (rrCreatedAt < new Date(CUTOFF)) { done = true; break; }
      if (rrCreatedAt > newestCreatedAt) newestCreatedAt = rrCreatedAt;

      const lineItems = item.line_items || [];
      const skus = lineItems.map(li => li.sku).filter(Boolean).sort();
      const rawTracking = item.fulfillment_details?.tracking_number || '';
      const tracking = extractTracking(rawTracking);
      const zipMatch = rawTracking.match(/^420(\d{5})/);

      try {
        await upsertCacheRecord({
          order_number:    item.order || String(item.id),
          rr_name:         item.name || null,
          rr_id:           String(item.id),
          tracking_number: tracking,
          customer_name:   item.shipping_information?.name || '',
          customer_zip:    zipMatch ? zipMatch[1] : null,
          line_items:      lineItems,
          sku_fingerprint: skus.join('|'),
          carrier:         detectCarrier(tracking),
          created_at:      item.created,
        }, merchant.id);
        recordsAdded++;
      } catch(e) { console.error(`[RR Sync Insert] merchant ${merchant.id}:`, e.message); }
    }
    if (!data.next) break;
    page++;
  }

  await pool.query(
    `INSERT INTO sync_checkpoints (source, last_synced_at, last_sync_run_at, pages_fetched, records_added, status, merchant_id)
     VALUES ('return_rabbit', $1, NOW(), $2, $3, 'success', $4)`,
    [newestCreatedAt.toISOString(), pagesFetched, recordsAdded, merchant.id]
  );
  return { pages_fetched: pagesFetched, records_added: recordsAdded };
}

// ── ADAPTER: Loop Returns ───────────────────────────────────────────
// Auth: X-Authorization: <api_key>  (API key auth, NOT OAuth — OAuth only needed for Labels/Webhooks)
// Endpoint: /api/v1/warehouse/returns  (Detailed Returns List — requires 'returns' scope)
// Docs: https://docs.loopreturns.com
async function syncLoop(merchant) {
  const CUTOFF = '2026-01-01T00:00:00Z';
  const MAX_PAGES = 200;
  const apiKey = merchant.api_key;
  const apiBaseUrl = merchant.api_url || 'https://api.loopreturns.com';

  if (!apiKey) {
    throw new Error(`No API key for Loop merchant ${merchant.id} (${merchant.name})`);
  }

  const checkpointRes = await pool.query(
    `SELECT last_synced_at FROM sync_checkpoints
     WHERE source = 'loop' AND merchant_id = $1
     ORDER BY id DESC LIMIT 1`,
    [merchant.id]
  );
  const lastSyncedAt = checkpointRes.rows.length > 0
    ? new Date(checkpointRes.rows[0].last_synced_at)
    : new Date(CUTOFF);

  let page = 1, recordsAdded = 0, pagesFetched = 0, done = false;
  let newestCreatedAt = lastSyncedAt;
  let cursor = null;

  while (!done && page <= MAX_PAGES) {
    // Loop API uses cursor-based pagination
    let url = `${apiBaseUrl}/api/v1/warehouse/returns?limit=50`;
    if (cursor) url += `&cursor=${cursor}`;

    const loopRes = await fetch(url, {
      headers: {
        'X-Authorization': apiKey,
        'Accept': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
    if (!loopRes.ok) throw new Error(`Loop API error: ${loopRes.status}`);
    const data = await loopRes.json();
    pagesFetched++;

    const returns = data.returns || data.data || [];
    if (returns.length === 0) break;

    for (const ret of returns) {
      // Loop return created_at
      const createdAt = new Date(ret.created_at || ret.created);
      if (createdAt <= lastSyncedAt) { done = true; break; }
      if (createdAt < new Date(CUTOFF)) { done = true; break; }
      if (createdAt > newestCreatedAt) newestCreatedAt = createdAt;

      // Map Loop line items to our normalized format
      const loopItems = ret.line_items || ret.return_line_items || [];
      const lineItems = loopItems.map(li => ({
        sku:          li.sku || li.variant_sku || null,
        product_name: li.title || li.product_title || li.name || null,
        variant:      li.variant_title || null,
        quantity:     parseInt(li.quantity || 1),
        reason:       li.return_reason || li.reason || null,
        image_url:    li.image_url || li.product_image || null,
        status:       li.state || li.status || null,
      }));

      const skus = lineItems.map(li => li.sku).filter(Boolean).sort();

      // Loop tracking: may be in label, shipment, or return-level fields
      const rawTracking = ret.label?.tracking_number
        || ret.shipment?.tracking_number
        || ret.tracking_number
        || '';
      const tracking = extractTracking(rawTracking);
      const zipMatch = rawTracking.match(/^420(\d{5})/);

      // Customer name: Loop may nest under customer or shipping_address
      const customerName = ret.customer?.name
        || ret.customer?.full_name
        || [ret.customer?.first_name, ret.customer?.last_name].filter(Boolean).join(' ')
        || ret.shipping_address?.name
        || '';

      // Order reference: Loop uses order_name (#1234) or order_id
      const orderNumber = ret.order_name || ret.order_number || `LOOP-${ret.id}`;

      try {
        await upsertCacheRecord({
          order_number:    orderNumber,
          rr_name:         ret.id ? `LOOP-${ret.id}` : null,
          rr_id:           String(ret.id),
          tracking_number: tracking,
          customer_name:   customerName,
          customer_zip:    zipMatch ? zipMatch[1] : (ret.shipping_address?.zip || null),
          line_items:      lineItems,
          sku_fingerprint: skus.join('|'),
          carrier:         detectCarrier(tracking),
          created_at:      ret.created_at || ret.created,
        }, merchant.id);
        recordsAdded++;
      } catch(e) { console.error(`[Loop Sync Insert] merchant ${merchant.id}:`, e.message); }
    }

    // Loop pagination: cursor or next URL
    cursor = data.cursor || data.next_cursor || null;
    if (!cursor && !data.next) break;
    page++;
  }

  await pool.query(
    `INSERT INTO sync_checkpoints (source, last_synced_at, last_sync_run_at, pages_fetched, records_added, status, merchant_id)
     VALUES ('loop', $1, NOW(), $2, $3, 'success', $4)`,
    [newestCreatedAt.toISOString(), pagesFetched, recordsAdded, merchant.id]
  );
  return { pages_fetched: pagesFetched, records_added: recordsAdded };
}

// ── SYNC ROUTER — calls the right adapter based on merchant.platform ─
async function syncMerchant(merchant) {
  console.log(`[Sync] Starting sync for merchant ${merchant.id} (${merchant.name}) [${merchant.platform}]...`);

  let result;
  switch (merchant.platform) {
    case 'return_rabbit':
      result = await syncReturnRabbit(merchant);
      break;
    case 'loop':
      result = await syncLoop(merchant);
      break;
    case 'aftership':
      console.log(`[Sync] merchant ${merchant.id} (${merchant.name}) uses AfterShip webhooks — no pull sync needed`);
      result = { pages_fetched: 0, records_added: 0, message: 'AfterShip uses webhooks — data pushed automatically' };
      break;
    default:
      throw new Error(`Unknown platform '${merchant.platform}' for merchant ${merchant.id}`);
  }

  console.log(`[Sync] merchant ${merchant.id} (${merchant.name}) complete. Pages: ${result.pages_fetched}, Records: ${result.records_added}`);
  return result;
}

function scheduleDailySync() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(6, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntilNext = next.getTime() - now.getTime();
  const hoursUntil = (msUntilNext / 1000 / 60 / 60).toFixed(1);
  console.log(`[Sync Scheduler] Next sync in ${hoursUntil} hours at ${next.toUTCString()}`);
  setTimeout(async () => {
    console.log('[Sync Scheduler] Running daily sync for all merchants...');
    try {
      // Get all active merchants with sync enabled
      const merchantsRes = await pool.query(
        'SELECT id, name, api_key, api_url, platform, good_rate FROM merchants WHERE active = true AND sync_enabled = true ORDER BY id'
      );
      const merchants = merchantsRes.rows;
      if (merchants.length === 0) {
        console.log('[Sync Scheduler] No active merchants with sync enabled.');
      }
      for (const merchant of merchants) {
        try {
          await syncMerchant(merchant);
        } catch (e) {
          // Error isolation: log and continue to next merchant
          console.error(`[Sync Scheduler] merchant ${merchant.id} (${merchant.name}) failed:`, e.message);
          await pool.query(
            `INSERT INTO sync_checkpoints (source, last_sync_run_at, status, error_message, merchant_id)
             VALUES ('return_rabbit', NOW(), 'failed', $1, $2)`,
            [e.message, merchant.id]
          ).catch(() => {});
        }
      }
      console.log(`[Sync Scheduler] All merchants processed.`);
    } catch(e) {
      console.error('[Sync Scheduler] Fatal error:', e.message);
    }
    scheduleDailySync(); // schedule next day
  }, msUntilNext);
}

app.listen(PORT, () => {
  console.log(`\n┌────────────────────────────────────────┐`);
  console.log(`│  ReturnHub running on port ${PORT}         │`);
  console.log(`│  Dashboard:  http://localhost:${PORT}      │`);
  console.log(`│  Health:     http://localhost:${PORT}/api/health │`);
  console.log(`│  RR Token:   ${process.env.RR_TOKEN ? '✓ Configured' : '✗ NOT SET — add to .env'} │`);
  console.log(`└────────────────────────────────────────┘\n`);
  scheduleDailySync();
});
