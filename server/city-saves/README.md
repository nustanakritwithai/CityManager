# Three server save slots

CityManager lists three owner-scoped slots after Guest authentication. Slot 1 reads and writes the existing tables in place, so existing city IDs, revisions, snapshots, archives and request receipts require no copy or backfill. Slots 2 and 3 use separate relations with the same database constraints and immutable-archive triggers. Every write uses the existing account lock and revision check.

The existing URL continues to operate on slot 1. Numbered routes use `/v1/city-save/slots/{1,2,3}`. Slot discovery returns metadata only. Each slot uses the same authenticated save and archive operations as the original route. The browser does not store city bytes or authentication tokens between visits. Switching cities reloads the game after the current snapshot has been confirmed on the server.

The app server and reverse proxy are installed separately from GitHub Pages. Run `node stage-runtime.mjs <runtime> <startup.ps1> <Caddyfile> <new-output-directory>` to prepare the server, proxy and startup guard changes for review. The script reads the installed files, checks the expected integration points and saves a manifest of old and new hashes. It writes only to the new output directory.

On a disposable PostgreSQL 16 instance, initialize the legacy schema, create a legacy Guest save, run `slots.sql` in the existing application schema and verify the exact legacy bytes and request replay. Exercise owner isolation, stale revisions, retry, archived deletion and restart against all slots. The database migration creates only the new tables and their constraints. For deployment, apply it before exposing the new routes. The website can use the old route while the new discovery route returns 404.

Back up the existing runtime and Caddy files before installation and verify their hashes against the staging manifest. Keep both legacy routes and the original boot task. In a rollback, restore the runtime/proxy files and retain the new tables with any confirmed saves.
