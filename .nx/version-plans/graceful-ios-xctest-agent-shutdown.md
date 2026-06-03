---
__default__: patch
---

Harness now asks the iOS XCTest permission agent to stop gracefully when a test run ends, letting its session finish on its own before Harness falls back to terminating xcodebuild. This avoids cutting off an otherwise-passing agent session during teardown and leaves fewer stray simulator and xcodebuild processes behind after tests complete.
