# ReturnHub — Deployment Guide
**Returns logistics dashboard for Paragonfitwear**

---

## What's in this package

```
returnhub/
├── server.js          ← Express server (API proxy + label printing)
├── package.json       ← Node.js dependencies
├── .env.example       ← Copy this to .env and add your token
├── .gitignore         ← Keeps .env out of Git
└── public/
    └── index.html     ← The complete ReturnHub dashboard
```

---

## STEP 1 — Install Node.js (if you don't have it)

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the green button)
3. Run the installer — click Next through everything
4. Open **Terminal** (Mac) or **Command Prompt** (Windows)
5. Type `node --version` — you should see something like `v20.11.0`

---

## STEP 2 — Set up the project

1. **Unzip** this folder somewhere on your computer
   - Example: `C:\Users\YourName\returnhub` on Windows
   - Example: `/Users/YourName/returnhub` on Mac

2. Open **Terminal / Command Prompt**

3. Navigate into the folder:
   ```
   cd C:\Users\YourName\returnhub       (Windows)
   cd /Users/YourName/returnhub         (Mac)
   ```

4. Install dependencies:
   ```
   npm install
   ```
   You'll see it download packages — takes about 30 seconds.

---

## STEP 3 — Add your Return Rabbit API token

1. Copy the example file:
   ```
   cp .env.example .env        (Mac/Linux)
   copy .env.example .env      (Windows)
   ```

2. Open `.env` in any text editor (Notepad is fine)

3. Replace `paste_your_return_rabbit_token_here` with your actual token:
   ```
   RR_TOKEN=your_actual_token_goes_here
   ```

4. Save the file.

> **Where to get the token:**
> Log in to Return Rabbit → Settings → API → Generate Token

---

## STEP 4 — Run it locally (test first)

```
npm start
```

You'll see:
```
┌────────────────────────────────────────┐
│  ReturnHub running on port 3000        │
│  Dashboard:  http://localhost:3000     │
│  RR Token:   ✓ Configured             │
└────────────────────────────────────────┘
```

Open **http://localhost:3000** in your browser.
Log in as Admin (PIN: 0000) → go to **RR Integration** → click **Test Connection**.

---

## STEP 5 — Deploy to Railway (permanent URL, free tier)

Railway gives you a permanent URL like `https://returnhub-production.up.railway.app`
so anyone in the warehouse can access it on any device.

### 5a — Create a GitHub repository

1. Go to **https://github.com** and create a free account if you don't have one
2. Click **New repository** → name it `returnhub` → click **Create**
3. Follow the instructions to push your code:
   ```
   git init
   git add .
   git commit -m "Initial ReturnHub deploy"
   git branch -M main
   git remote add origin https://github.com/YOURUSERNAME/returnhub.git
   git push -u origin main
   ```

### 5b — Deploy on Railway

1. Go to **https://railway.app** and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `returnhub` repository
4. Railway will detect it's a Node.js app and deploy automatically

### 5c — Add your environment variable on Railway

1. In Railway, click your project → **Variables** tab
2. Click **New Variable**
3. Add:
   - Name: `RR_TOKEN`
   - Value: your Return Rabbit API token
4. Click **Add** — Railway restarts automatically

### 5d — Get your live URL

1. Click **Settings** → **Domains**
2. Click **Generate Domain** — you'll get something like:
   `https://returnhub-production.up.railway.app`
3. Share this URL with your warehouse team

---

## STEP 6 — Optional: Custom domain

If you want `returns.paragonfitwear.com` or `returnhub.yourcompany.com`:

1. In Railway → Settings → Domains → **Custom Domain**
2. Add your domain
3. Railway gives you a CNAME record to add in your DNS provider
4. Takes 5–15 minutes to go live

---

## Daily use

- Workers open the URL on any computer or tablet in the warehouse
- Each worker selects their name and enters their PIN
- Scan barcodes using a USB or Bluetooth barcode scanner
- Return Rabbit data syncs automatically every 60 seconds
- Reports email to Paragon automatically every Monday at 8 AM

---

## Printer setup

For Zebra label printers:
1. Make sure the printer is on the same WiFi/network as the server
2. Find the printer's IP address (print a config label from the printer)
3. In ReturnHub → **Printer Manager** → **Add Printer** → enter the IP
4. Click **Test** to verify

---

## Troubleshooting

**"RR_TOKEN not configured"**
→ Check your `.env` file has `RR_TOKEN=...` with no spaces around the `=`
→ Restart the server: `npm start`

**"Cannot reach Return Rabbit API"**
→ Your token may be expired — generate a new one in Return Rabbit
→ Check Return Rabbit's status page

**Blank page on Railway**
→ Check Railway logs — click **Deployments** → **View Logs**
→ Usually means a missing environment variable

**Printer not responding**
→ Confirm printer IP with a config print from the printer itself
→ Printer must be on the same network as the server

---

## Support

- Return Rabbit API: support@returnrabbit.com
- ReturnHub code questions: keep this README and share with your developer
