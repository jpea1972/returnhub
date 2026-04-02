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

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com", "fonts.googleapis.com", "data:"],
      imgSrc:        ["'self'", "data:", "https:", "blob:"],
      connectSrc:    ["'self'", "https:"],
    },
  },
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
    timestamp: new Date().toISOString(),
  });
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
