# City save candidate

This directory is an isolated candidate; it is not mounted in the current game or backend. It is not a deployment instruction. The three-slot feature and financial journal isolation are incomplete.

The service accepts a client-generated immutable city UUID, a slot position, raw JSON save bytes and bounded display metadata. It serializes each owner's mutations on the account row, checks expected revisions and records request results atomically. A delete retains the instance and snapshots; restore requires an empty position. Snapshot rows are append-only. Unknown save versions without an incompatible market journal remain opaque strings. A future market schema is rejected rather than rewritten.

The router requires the existing backend's `guest` and `csrf` middleware. Its host must apply a route-specific bounded JSON parser before the existing 32 KB default parser and retain the existing exact-origin CORS policy. It must not enable the route until integration, resource limits, retention, backup and recovery have been independently reviewed. A mutation uses `POST /` and `Idempotency-Key`; reads use `GET /` or `GET /:cityId`.

`migration.sql` is a review candidate only. Do not run it against production. For a rollout proposal, review the target schema and role grants, storage growth, backup/restore and rollback strategy, API body limits, lock contention and feature gating separately. Preserve old Guest IDs, original local saves, delivery state and historical snapshot bytes. Never deploy this candidate with a global market journal cloned across cities.

`npm run test:city-saves` runs the local unit tests; PostgreSQL and HTTP tests skip unless their explicit test environment variables are supplied. The PostgreSQL test checks its fixed loopback port and the exact `validation/city-save-pg` data directory before any mutation, creates a random disposable database and never connects to the deployed database. Its isolated cluster must be provisioned by the test operator; do not point it at an existing service. The HTTP test exercises the adapter with test middleware; it is not evidence of production authentication, CORS or proxy behavior.
