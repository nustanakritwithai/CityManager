# Isolated CityManager backend fixture for CI

Runtime files and dependency lock are copied from reviewed backend commit `9224423c96c46ce80ee93bd9948b6720969327a8`. No live configuration, credentials, player data or operational runbooks are included. `scripts/setup-ci-database.mjs` is CI-only fixture scaffolding, not part of that commit.

Create a **new disposable PostgreSQL database named `citymanager_ci`** on loopback. Set `DATABASE_URL` via CI's ephemeral service environment (never log it), and `DATABASE_SCHEMA` to a unique value matching `ci_market_<16 lowercase hex characters>`. The setup refuses an existing schema, a different database name, non-loopback hosts and URL query options. Install the locked dependencies with `npm ci`, then run `node scripts/setup-ci-database.mjs`.

Start the backend with `DATABASE_URL` and `DATABASE_SCHEMA` unchanged and these settings:

```
PORT=4317
NODE_ENV=integration
MARKET_ALLOWED_ORIGINS=https://citymanager.157-85-96-139.sslip.io
MARKET_SECURE_COOKIES=true
MARKET_PAGES_AUTH_ENABLED=true
MARKET_PAGES_TRUSTED_PROXY=true
MARKET_TRADE_REJECTIONS_ENABLED=true
MARKET_RECOVERY_ENABLED=false
MARKET_ALLOW_DEPOSITS=false
SANDBOX_FIXTURE_MODE=false
```

Leave `ADMIN_TOKEN` unset. Run `node src/server.js`; it binds only to `127.0.0.1`. The actual approved first-party and Pages origins are embedded in the runtime. Browser CI must use an isolated local TLS/proxy fixture that maps those origins to the isolated service and overwrites `X-Forwarded-For` from the trusted socket; never send test credentials, cookies or requests to the real service. A route-intercepted origin test must be labeled as such. The fixture does not include the separately review-gated live wallet-sequence trigger repair or any grant/deposit enablement. Test-only funded data must remain in the disposable CI database and must not be published as an artifact.

This is a test fixture, not deployment or evidence that the public browser flow has passed.

