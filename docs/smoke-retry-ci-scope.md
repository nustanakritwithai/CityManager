# Save smoke retry hardening CI scope

Route `smoke-retry` admits a test-harness-only change to `tests/server-save-browser-smoke.mjs`.

The change is in the lost-ACK phase. That phase clears the mobile viewport override and then immediately measured and clicked the save banner's retry button. While the page reflowed, the button could move between the measurement and the click, so the click missed. The phase then timed out after 90 s.

Artifacts from failing CI runs fit this: the lost key was posted only twice, with no click-driven replay, and the banner kept the original network error.

The press now waits until the button's box and the viewport are unchanged across three frames. It then requires the click to reach the button within 5 s. All save assertions are unchanged: exact replay, no duplicate receipt, and a current-state save.

Selection is fail-closed:

- Only the smoke file and the CI routing files may change.
- The smoke diff must match the reviewed SHA-256.
- No game, save client, server or `index.html` path is allowed.

The route runs:

- the server entry, entry flow, server save, save management dialog and autosave unit tests;
- the type check and production build;
- the hardened server-save browser smoke itself, which is the deploy gate.

The separate Save smoke and City save safety workflows also run the smoke.
