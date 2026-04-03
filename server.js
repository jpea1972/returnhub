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
  const { tracking_number, order_number, customer_name, sku_fingerprint } = req.body;
  if (!tracking_number || !order_number || !customer_name || !sku_fingerprint) {
    return res.status(400).json({ error: 'All 4 fields required for duplicate check' });
  }
  try {
    const result = await pool.query(
      `SELECT r.id, r.order_number, r.tracking_number, r.customer_name, 
              r.sku_fingerprint, r.condition, r.received_at, r.is_duplicate_override,
              w.full_name as processed_by, w.initials as processed_by_initials
       FROM returns r
       LEFT JOIN workers w ON r.worker_id = w.id
       WHERE r.tracking_number = $1
         AND r.order_number = $2
         AND r.customer_name = $3
         AND r.sku_fingerprint = $4
       ORDER BY r.received_at DESC
       LIMIT 1`,
      [tracking_number, order_number, customer_name, sku_fingerprint]
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
    label_printed, rr_created_at, notes, is_duplicate_override,
    line_items
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
        notes, is_duplicate_override
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,$18)
      RETURNING id`,
      [
        order_number, shopify_order_id || null, tracking_number, carrier || 'USPS',
        customer_name, customer_zip || null, sku_fingerprint, condition,
        billing_rate, billed_amount, worker_id, session_id || null, station || null,
        label_printed || false, label_printed ? new Date() : null,
        rr_created_at || null, notes || null, is_duplicate_override || false
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
app.get('/api/db/cache', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        c.order_number, c.tracking_number, c.customer_name,
        c.customer_zip, c.line_items, c.sku_fingerprint,
        c.carrier, c.rr_created_at
       FROM rr_cache c
       WHERE c.rr_created_at >= '2026-01-01'
         AND c.order_number NOT IN (
           SELECT DISTINCT order_number FROM returns
           WHERE is_duplicate_override = false
         )
       ORDER BY c.rr_created_at DESC`
    );
    res.json({ success: true, count: result.rows.length, returns: result.rows });
  } catch (err) {
    console.error('[Cache Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SEARCH: Returns (processed) ──────────────────────
app.get('/api/db/returns/search', async (req, res) => {
  const { q, condition, worker_id, date_from, date_to, limit = 100, offset = 0 } = req.query;
  try {
    let where = ['1=1'];
    let params = [];
    let i = 1;

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

// ── PRODUCTIVITY: Worker hourly stats ────────────────
app.get('/api/db/reports/productivity', async (req, res) => {
  const { worker_id, date_from, date_to } = req.query;
  try {
    let where = ['1=1'];
    let params = [];
    let i = 1;
    if (worker_id) { where.push(`r.worker_id = $${i}`); params.push(worker_id); i++; }
    if (date_from) { where.push(`r.received_at >= $${i}`); params.push(date_from); i++; }
    if (date_to)   { where.push(`r.received_at <= $${i}`); params.push(date_to); i++; }

    const result = await pool.query(
      `SELECT 
        w.initials, w.full_name,
        DATE_TRUNC('hour', r.received_at) as hour,
        COUNT(*) as returns_processed,
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
app.get('/api/db/reports/billing', async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to required' });
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_returns,
        COUNT(CASE WHEN condition = 'Good' THEN 1 END) as total_good,
        COUNT(CASE WHEN condition = 'Damaged' THEN 1 END) as total_damaged,
        COUNT(CASE WHEN condition = 'Not Returned' THEN 1 END) as total_not_returned,
        SUM(CASE WHEN condition = 'Good' THEN billed_amount ELSE 0 END) as good_revenue,
        SUM(CASE WHEN condition = 'Damaged' THEN billed_amount ELSE 0 END) as damaged_revenue,
        SUM(billed_amount) as total_revenue
       FROM returns
       WHERE received_at >= $1 AND received_at <= $2`,
      [date_from, date_to]
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
app.post('/api/db/sync', async (req, res) => {
  if (!process.env.RR_TOKEN) {
    return res.status(400).json({ error: 'RR_TOKEN not configured' });
  }

  const CUTOFF = '2026-01-01T00:00:00Z';
  const MAX_PAGES = 400;
  const PAGE_SIZE = 50;
  const RR_BASE_URL = process.env.RR_BASE_URL || 'https://api.returnrabbit.app';

  try {
    // Get last synced timestamp
    const checkpointRes = await pool.query(
      "SELECT last_synced_at FROM sync_checkpoints WHERE source = 'return_rabbit' ORDER BY id DESC LIMIT 1"
    );
    const lastSyncedAt = checkpointRes.rows.length > 0
      ? new Date(checkpointRes.rows[0].last_synced_at)
      : new Date(CUTOFF);

    const isInitialSync = checkpointRes.rows.length === 0;
    console.log(`[Sync] Starting ${isInitialSync ? 'INITIAL' : 'incremental'} sync. Last synced: ${lastSyncedAt.toISOString()}`);

    let page = 1;
    let recordsAdded = 0;
    let pagesFetched = 0;
    let done = false;
    let newestCreatedAt = lastSyncedAt;

    while (!done && page <= MAX_PAGES) {
      const url = `${RR_BASE_URL}/api/v1/service-requests/?page=${page}&page_size=${PAGE_SIZE}&ordering=-created`;
      const rrRes = await fetch(url, {
        headers: {
          'Authorization': `Token ${process.env.RR_TOKEN}`,
          'Accept': 'application/json',
          'Cache-Control': 'no-store',
        }
      });

      if (!rrRes.ok) {
        throw new Error(`RR API error: ${rrRes.status}`);
      }

      const data = await rrRes.json();
      pagesFetched++;

      const results = data.results || [];
      if (results.length === 0) break;

      for (const item of results) {
        const rrCreatedAt = new Date(item.created);

        // Stop if we've reached records we already have
        if (rrCreatedAt <= lastSyncedAt && !isInitialSync) {
          done = true;
          break;
        }

        // Stop if older than cutoff
        if (rrCreatedAt < new Date(CUTOFF)) {
          done = true;
          break;
        }

        // Track newest record
        if (rrCreatedAt > newestCreatedAt) {
          newestCreatedAt = rrCreatedAt;
        }

        // Build SKU fingerprint
        const lineItems = item.line_items || [];
        const skus = lineItems.map(li => li.sku).filter(Boolean).sort();
        const skuFingerprint = skus.join('|');

        // Extract tracking number (strip USPS prefix)
        const rawTracking = item.fulfillment_details?.tracking_number || '';
        const trackingMatch = rawTracking.match(/((?:9[0-9]{3}|82)[0-9]{17,19})/);
        const tracking = trackingMatch ? trackingMatch[1] : rawTracking;

        // Extract ZIP from USPS prefix (420XXXXX...)
        const zipMatch = rawTracking.match(/^420(\d{5})/);
        const customerZip = zipMatch ? zipMatch[1] : null;

        // Detect carrier from tracking prefix
        let carrier = 'USPS';
        if (tracking.startsWith('1Z')) carrier = 'UPS';
        else if (/^[0-9]{12,22}$/.test(tracking) && !tracking.startsWith('9')) carrier = 'FedEx';

        // Upsert into rr_cache
        try {
          await pool.query(
            `INSERT INTO rr_cache (order_number, tracking_number, customer_name, customer_zip, line_items, sku_fingerprint, carrier, rr_created_at, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (order_number) DO UPDATE SET
               tracking_number = EXCLUDED.tracking_number,
               customer_name = EXCLUDED.customer_name,
               customer_zip = EXCLUDED.customer_zip,
               line_items = EXCLUDED.line_items,
               sku_fingerprint = EXCLUDED.sku_fingerprint,
               carrier = EXCLUDED.carrier,
               rr_created_at = EXCLUDED.rr_created_at,
               synced_at = NOW()`,
            [
              item.order?.order_number || item.order?.name || String(item.id),
              tracking,
              item.shipping_information?.name || '',
              customerZip,
              JSON.stringify(lineItems),
              skuFingerprint,
              carrier,
              item.created
            ]
          );
          recordsAdded++;
        } catch (insertErr) {
          console.error('[Sync Insert Error]', insertErr.message);
        }
      }

      // Check if there are more pages
      if (!data.next) break;
      page++;
    }

    // Update checkpoint
    await pool.query(
      `INSERT INTO sync_checkpoints (source, last_synced_at, last_sync_run_at, pages_fetched, records_added, status)
       VALUES ('return_rabbit', $1, NOW(), $2, $3, 'success')`,
      [newestCreatedAt.toISOString(), pagesFetched, recordsAdded]
    );

    console.log(`[Sync] Complete. Pages: ${pagesFetched}, Records added/updated: ${recordsAdded}`);
    res.json({ 
      success: true, 
      pages_fetched: pagesFetched, 
      records_added: recordsAdded,
      last_synced_at: newestCreatedAt.toISOString()
    });

  } catch (err) {
    // Log failed sync
    await pool.query(
      `INSERT INTO sync_checkpoints (source, last_sync_run_at, status, error_message)
       VALUES ('return_rabbit', NOW(), 'failed', $1)`,
      [err.message]
    ).catch(() => {});
    console.error('[Sync Error]', err.message);
    res.status(500).json({ error: err.message });
  }
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

// ── CATCH-ALL — serve dashboard for any unknown route ─
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n┌────────────────────────────────────────┐`);
  console.log(`│  ReturnHub running on port ${PORT}         │`);
  console.log(`│  Dashboard:  http://localhost:${PORT}      │`);
  console.log(`│  Health:     http://localhost:${PORT}/api/health │`);
  console.log(`│  RR Token:   ${process.env.RR_TOKEN ? '✓ Configured' : '✗ NOT SET — add to .env'} │`);
  console.log(`└────────────────────────────────────────┘\n`);
});
