# CityManager market integration (sandbox)

This checkout adds an opt-in game client for the separate loopback market sandbox. The city simulation remains local. The client is disabled when `VITE_MARKET_URL` is unset, so normal game builds do not create guest sessions or contact a market server.

## Runtime contract

Use `VITE_MARKET_URL=http://127.0.0.1:4317` with the market server's safe loopback topology (`http://127.0.0.1:4173` game origin). The client uses `credentials: include`, the opaque HttpOnly `cm_guest` cookie, and the readable `cm_csrf` cookie echoed in `x-csrf-token`. `localhost:5173` to `127.0.0.1:4317` is intentionally unsupported because the host mismatch can withhold SameSite cookies.

The six accepted item IDs are `crop:rice`, `crop:vegetables`, `crop:sugarcane`, `product:milled-rice`, `product:canned-food`, and `product:sugar`. Market credits are not city money. Listing and buy operations use durable UUID idempotency keys; a pending operation is retried only for the same guest and city fingerprint. Guest expiry or a city change quarantines unresolved operations instead of recreating a guest and replaying them.

Market state is stored separately under `citymanager.market.v10` with `version: 10` and `rulesVersion: chain-5`. It contains only guest-scoped operation metadata, claims, and sequence data; it never stores the guest cookie or a token. The journal validator rejects unknown versions, rules, operation kinds, or states.

Receipt claims are fail-closed. The panel claims a receipt but does not ACK it automatically: the game adapter must validate the item ID, destination firm type, capacity, and save quota, persist the typed city journal, then ACK the same claim ID. A lost response or a save quota failure is a pending recovery case, not permission to restore escrow or claim exactly-once offline delivery.

## Local run

From this checkout, install the existing lockfile dependencies and run Vite on loopback:

```powershell
$env:VITE_MARKET_URL='http://127.0.0.1:4317'
npm run dev -- --host 127.0.0.1 --port 4173
```

The market server's normal launch keeps `SANDBOX_FIXTURE_MODE=false` and `MARKET_ALLOW_DEPOSITS=false`; test-only fixture funding/deposit enablement belongs to the market repository's isolated test child process and is not enabled by the game.

## Verification boundary

The journal and guest/idempotency client tests pass with Node's built-in strip-types runner. The full CityManager typecheck/build and browser suite require the repository's npm dependencies; installation was blocked in this VPS checkout by `ENOSPC` while unpacking `npm ci`. The market repository's previously verified 26/26 PostgreSQL/API suite remains separate evidence; it is not browser proof of this game client.
