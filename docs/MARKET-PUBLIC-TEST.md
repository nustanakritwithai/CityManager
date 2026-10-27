# CityManager market public-test build

This is an opt-in test build. The normal game build keeps market integration disabled.

From this checkout, with dependencies installed by the existing CI workflow:

```powershell
$env:VITE_MARKET_URL = '/citymanager-api'
$env:VITE_BASE_PATH = '/citymanager/'
npm run build -- --outDir .test-output/citymanager-public-test-dist
```

The resulting static site is intended for `https://157-85-96-139.sslip.io/citymanager/` only after the infrastructure owner has reviewed and installed the matching same-origin Caddy route. The app calls `/citymanager-api`; it must not be changed to a loopback URL in this artifact.

The corresponding market process must use the isolated `citymanager_public_test` PostgreSQL schema, `MARKET_SECURE_COOKIES=true`, and the exact game origin in `MARKET_ALLOWED_ORIGINS`. `MARKET_ALLOW_DEPOSITS=false`, `SANDBOX_FIXTURE_MODE=false`, and no admin token are required for the public test. No seeded fixture rows, real saves, deposits, withdrawals, or production credits are exposed.

This checkout has not published this artifact and has not changed or reloaded Caddy. The current Caddy configuration has an owner-side validation/access blocker.
