# Deployment and Rollback

## Railway Project

- **Project:** gracious-charisma
- **Service:** returnhub
- **Branch:** main
- **Trigger:** Auto-deploy on git push to main (~60 seconds)

## Deploy Process

```bash
cd /Users/jamespeacock/Desktop/returnhub
# make changes
git add <files>
git commit -m "description"
git push origin main
```

Railway detects the push, runs `npm install`, starts `node server.js`.

## Before Deploy Checklist

- [ ] `node --check server.js` passes locally (syntax OK)
- [ ] No hardcoded secrets in code
- [ ] Database migration run in TablePlus BEFORE pushing code
- [ ] Backup of current server.js: `cp server.js server.js.backup`

## After Deploy Checklist

- [ ] `curl https://returnhub-production.up.railway.app/api/health` returns OK
- [ ] `curl https://returnhub-production.up.railway.app/api/db/merchants` returns both merchants
- [ ] Hard refresh (Cmd+Shift+R) on browser to load new JS files
- [ ] Test core workflow: scan a return, verify it saves
- [ ] Check Railway logs for errors

## Database Migration Process

1. Open TablePlus → connect to Railway PostgreSQL (gracious-charisma)
2. Open new SQL query tab
3. Paste migration SQL
4. Run with Cmd+Shift+Enter
5. Verify with SELECT queries
6. THEN push code changes

Always migrate database BEFORE deploying code that depends on new tables/columns.

## Rollback

### Quick Rollback (Revert Last Commit)
```bash
git revert HEAD --no-edit
git push origin main
```

### Rollback to Specific Commit
```bash
git log --oneline -10        # find the good commit hash
git revert <bad-commit>
git push origin main
```

### Emergency: Force Previous Version
```bash
git reset --hard <good-commit>
git push origin main --force
```

**Warning:** Force push rewrites history. Only use in emergencies.

### Database Rollback
No automatic rollback. Migrations are additive (CREATE TABLE, ADD COLUMN). If a migration needs undoing, write a reverse migration and run in TablePlus.

## Viewing Logs

Railway dashboard → Project → Service → Deployments → Click deployment → View Logs

Or via CLI: `railway logs`

## Sync Scheduler Warning

Every deploy restarts the server. scheduleDailySync() resets and calculates next 6 AM UTC. A deploy at 5:55 AM UTC delays the next sync ~24 hours.
