---
__default__: minor
---

Harness runs can now emit detailed diagnostics: enable them with the new `diagnostics` config option (or `RN_HARNESS_DIAGNOSTICS` env var) to get a Chrome Trace Event JSON file plus a console summary showing where time went during a run — session setup, Metro bundling, bridge/device round-trips, and per-file test execution. Load the trace directly in `chrome://tracing` or Perfetto. Diagnostics are off by default with zero overhead.
