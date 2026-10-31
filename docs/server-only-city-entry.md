# Server-only city entry checkpoint

This implementation is not published until the city-save routes are mounted behind the existing login and the deployed endpoint is verified.

- City saves use the existing authenticated Guest owner. A cookie session is checked with `/v1/me`; the save flow never creates a Guest account. Pages authentication reuses the existing PKCE popup, keeps the token only in memory, and passes a known legacy Guest when available. With cleared local storage it resumes the remembered first-party login through the same origin-bound handshake. Missing or expired server identity fails closed; the save flow never silently creates a new owner.
- Browser city storage is read-only migration input. There is no city write, recovery outbox, quota fallback, cleanup, or deletion. UI preferences remain separate.
- Migration covers accessible data in the current origin/browser profile only. It cannot discover other devices or browser profiles. Readable primary, backup, checkpoint, and IDB branches retain exact decoded bytes and source provenance in private server archives. The standalone market journal is archived as nonplayable data.
- The confirmed server city is authoritative. With no server city, multiple distinct old cities require explicit selection; highest tick is not assumed newest. Incomplete inventory blocks creation of a replacement fresh city. If a server city already exists, incomplete migration is reported in the save menu.
- Semantic validation happens before the entry gate is removed. Network, authentication, validation, or server failures do not enter an offline city.
- Save success requires an awaited, verified server ACK. Uncertain saves retain their exact in-memory idempotent attempt. Conflicts do not overwrite the server city: the player may explicitly archive the current session and reopen the current server city.
- Trading remains disabled. Existing embedded market data is preserved, not replayed. Synchronous market durability callbacks are not compatible with async city writes and must not be enabled without separate work.
- **Manage Save** reuses the existing menu entry. Cancel makes no writes. Explicit deletion archives the in-memory session, atomically retains server working copies, and publishes a monotonic deletion marker. The UI verifies that marker before offering a separate fresh-world action. Fresh creation uses a new city identity and empty disabled market journal, with the same Guest; it does not alter wallet balances or replay old market operations. A retained backup is not a user-browsable trash/restore feature, and there is no permanent-purge action.

Focused automated tests cover inventory preservation, semantic gate failures/retry, incomplete imports, explicit choice, conflict cancellation, existing-login-only authentication, CSRF, and owner mismatch. These headless tests do not substitute for deployed-browser verification. No VPS commands are part of this frontend checkpoint.

## Acceptance and CI transition

The required **Save smoke** check now exercises the production bundle against an isolated loopback HTTP service using an existing mock cookie and CSRF token. It verifies server ACK timing, CAS conflicts, exact retry, read-only migration, reload, quota independence, and zero browser city writes. This replaces the old offline/localStorage success assertions; they are not valid acceptance criteria for server-only saving. Historical storage-module unit tests remain for read/migration compatibility.

`node tests/server-save-browser-smoke.mjs --self-test` checks only the fixture service without browser or sockets. Its result explicitly records browser acceptance as not run. `node tests/server-save-browser-smoke.mjs` is the actual production-bundle browser test and must pass in CI. A launch or socket failure is a failed/blocked check, not success.

`tests/server-save-live-readonly.mjs` performs only GET requests to public assets and unauthenticated save endpoints. It never creates a login or changes real player data. A pass proves neither authenticated saving nor PKCE login. Actual deployed existing-login save/reload must be verified separately before publication is considered complete.

The deployed public login HTML was inspected read-only: `auto=1` performs the origin/state/opener handshake, then validates `/v1/me` before authorizing. It does not automatically create a Guest. Omitting `auto` removes that expected-Guest handshake, so save authentication preserves it. The separate New Guest button is an explicit confirmed action in the existing login UI, not an action performed by city saving.

## Manage Save lifecycle acceptance

Deletion and fresh creation bind the confirmed city identity and revision, are serialized with saves, and retain exact retry keys/payloads when acknowledgements are uncertain. Autosave and editing are paused while the native modal is open. Once deletion is acknowledged, cancellation cannot resume the retired world even if a later read observes a different city. An explicit reload path is offered when no request is uncertain. A deleted server marker suppresses legacy-browser activation on subsequent entry; only an explicit new-city action may create against that marker. Known unresolved financial obligations block deletion with a specific explanation. Existing server credentials, wallet and market ledger are not deleted.

The built-bundle fixture now covers cancellation, lost deletion acknowledgement and exact retry, fresh identity readback, same Guest/empty journal, deleted-marker reload without legacy resurrection, and stale delete conflicts. Local fixture self-tests remain distinct from actual browser CI. The backend lifecycle upgrade must be installed and verified before this frontend is deployed. No tests delete any real player's city.
