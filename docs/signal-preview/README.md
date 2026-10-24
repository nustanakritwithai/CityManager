# Signal panel browser evidence

Runtime code tested: `cd3cadc621c1908a1d6525021833f5ea2a9091c1`, based on published main `504f16a30199cd6fd47be0d98e1b20d26aed2c0e`. Later evidence/harness-only changes do not change that runtime code.

Installed Microsoft Edge tested the isolated local production preview. All five acceptance groups passed: default feature gate; actual aggregate/credit mapping and first missing history; later comparison windows and stale labels; mobile disclosures/Back/close without mutation; load-history reset. Zero browser errors and zero API/provider requests were recorded. See [machine-readable measurements](qa.json).

- [Desktop panel](desktop-signals.png): captured real simulation aggregates, no individual-person population invented, five metrics and explicit missing data.
- [Mobile panel](mobile-signals.png): emulated 360x740 viewport, panel bounds x6..354/y6..734, 728px reading height, no horizontal overflow, 44px refresh control.

The screenshots were visually inspected. Mobile viewport emulation is not a physical-phone test. The panel remains opt-in (`?signals=1`) and online access stays unconfigured. No merge or public deployment occurred.

Source checks: 34/34 Node tests, TypeScript/build and both asset integrity gates passed. The separate backend passed 18/18 tests and its previously approved single synthetic live request; browser QA made no further real calls.
