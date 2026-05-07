# ReturnHub

Multi-merchant warehouse returns management platform for Foreign Trade Zone (FTZ) operations.

## Production

- **Live URL:** https://returnhub-production.up.railway.app
- **GitHub:** https://github.com/jpea1972/returnhub
- **Hosting:** Railway (project: gracious-charisma)
- **Database:** PostgreSQL on Railway (17 tables)
- **Branch:** `main` — auto-deploys on push (~60 seconds)

## Main Files

- `server.js` — Express backend (~2,500 lines)
- `public/index.html` — Single HTML shell
- `public/js/*.js` — 20+ frontend modules (no build step, no bundler)
- `schema.sql` — Full database DDL
- `/docs/` — All documentation

## Run Locally

```bash
npm install
DATABASE_URL=<your-postgres-url> RR_TOKEN=<your-token> node server.js
```

Open http://localhost:3000

## Required Environment Variables

See [/docs/10_ENVIRONMENT_VARIABLES.md](docs/10_ENVIRONMENT_VARIABLES.md) for full list.

Key variables: `DATABASE_URL`, `RR_TOKEN`, `PORT`, `PRINT_MODE`, `QZ_ENABLED`

## Integrations

- **Return Rabbit** — pull-based RMA sync (Paragonfitwear)
- **AfterShip Returns** — webhook push (WillDrop)
- **Loop Returns** — pull-based adapter (ready, no active client)
- **MindCloud/Datex WMS** — Good returns export via pull API with Bearer token auth
- **QZ Tray** — browser-to-local-printer ZPL label printing

## Documentation

See [/docs/00_DOCS_INDEX.md](docs/00_DOCS_INDEX.md) for the full documentation index.

## Emergency Rollback

```bash
git log --oneline -5          # find the last good commit
git revert HEAD --no-edit     # revert last commit
git push origin main          # Railway auto-deploys
```

## Support

- **Operations:** James Peacock / SKU Distribution
- **Database:** TablePlus → Railway PostgreSQL (gracious-charisma)
- **Logs:** Railway dashboard → Deployments → View Logs
