---
__default__: patch
---

The iOS XCTest permission agent now starts building while the simulator boots instead of waiting for the boot to finish first, cutting startup time for simulator runs that need permission auto-acceptance—especially on a cold build cache.
