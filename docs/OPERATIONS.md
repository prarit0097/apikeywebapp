# KeyPool operations

## Isolation

All app-owned code, Compose configuration, environment, SQLite data, backups and ACME webroot live under **/opt/apikeywebapp**. Compose project: **apikeywebapp**. Its private network and container are dedicated. The only host port is **127.0.0.1:4186**. Nginx handles the public domain; no public Docker port, shared database or shared Redis is used.

Only `/etc/nginx/sites-available/api.praritsidana.com`, its sites-enabled link, the corresponding Let's Encrypt certificate and a dedicated renewal hook integrate with system paths. Never stop shared Nginx, run global Docker pruning, apply unrelated server upgrades or restart unrelated applications for this deployment.

## Initial deployment

1. Confirm `/opt/apikeywebapp` and port 4186 are free. Inspect the existing Nginx/certificate setup first.
2. Place the reviewed repository at that folder. Generate independent random `ENCRYPTION_KEY` (64 hex chars) and `BOOTSTRAP_TOKEN` (at least 24 chars) in `.env` with mode 0600. Set `APP_ORIGIN=https://api.praritsidana.com`. Never print environment contents to shared logs.
3. Run `bash deploy/deploy.sh`. Verify `curl -f http://127.0.0.1:4186/healthz` and `docker compose -p apikeywebapp ps`.
4. Install only this domain's HTTP Nginx configuration, run `nginx -t`, and gracefully reload with `systemctl reload nginx`.
5. Issue only the domain certificate using `certbot certonly --webroot -w /opt/apikeywebapp/acme -d api.praritsidana.com`. Follow the host's existing certificate renewal convention. Do not reissue other sites' certificates.
6. Install `deploy/nginx.conf` as this domain's configuration, validate and reload. Keep the ACME location on HTTP for renewals.
7. Verify external HTTPS, HTTP redirect, owner API denial without login, gateway denial without a key and clean bootstrap UI. Complete owner setup using the private token.

## Updates

Run checks on the reviewed revision: `npm ci`, `npm test`, `npm run build`.

In `/opt/apikeywebapp`, back up first, fetch/review the intended Git revision, then run `bash deploy/deploy.sh`. It tags the previous app image before rebuilding, leaving unrelated Compose projects alone. Verify health, login and a request using an explicitly authorized provider. All secrets and data persist outside the image.

## Backup and recovery

Use Node SQLite's online backup API to avoid an inconsistent WAL copy:

```bash
cd /opt/apikeywebapp
docker compose -p apikeywebapp exec -T gateway node --input-type=module -e \
  "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync('/app/data/keypool.sqlite'); await backup(db,'/app/data/backup.sqlite'); db.close();"
install -m 600 data/backup.sqlite "backups/keypool-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
rm data/backup.sqlite
```

Protect and back up `.env` separately with the database. It contains the encryption key required to decrypt saved upstream credentials. Do not put either in Git or a public web directory. Off-server backups require the owner's selected secure destination; none is configured automatically.

To restore, stop **only** this app with `docker compose -p apikeywebapp stop gateway`. Move the current SQLite database and its WAL/SHM files into a restricted app-owned recovery folder. Restore the selected backup as `data/keypool.sqlite`, preserving the app's encryption key and owner (UID 1000). Start this app and verify health/login. Do not restore an old database over a running SQLite connection.

## Rollback

The update script retains `apikeywebapp:previous`. After backing up current data, point this Compose service at that image (or tag it back to latest) and run `docker compose -p apikeywebapp up -d --no-build gateway`. Current schema changes are additive, but review compatibility before rolling back across future migrations. Restore this domain's own prior proxy config only if it changed, then `nginx -t` and graceful reload. Never restore or restart other apps.

## Key rotation and owner recovery

- Upstream credential: use Edit provider and replace the API key.
- Gateway credential: generate a new key, update its clients, then revoke the old one.
- Encryption key: requires decrypting and re-encrypting every provider credential atomically. Do not simply replace `ENCRYPTION_KEY`; there is intentionally no unsafe automatic rotation button.
- Lost owner password: an operator with authorized root access can generate a new `hashPassword()` value using the built server module, then atomically update `owner.password` and delete existing sessions through SQLite in this app's container. Never pass plaintext passwords in command arguments or shell history; use a private input file/stdin. This is an administrative recovery operation, not public password reset.
- Bootstrap token cannot reset an existing owner. Setup is single-use.

## Verification limits

Automated adapter tests use controlled upstream fixtures. Browser checks use an isolated local database and fake credentials; none are deployed as real providers. Until the owner adds actual provider keys, live model quality, provider entitlement, provider-specific billing behavior and a genuine LLM-backed Claude Code coding session remain unverified.
