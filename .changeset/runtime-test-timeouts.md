---
'@react-native-harness/bridge': patch
'@react-native-harness/config': patch
'@react-native-harness/jest': patch
'@react-native-harness/runtime': patch
---

Report stalled runtime test cases through per-test timeouts instead of letting the whole `runTests` bridge RPC fail generically. Harness now leaves `runTests` guarded by bridge heartbeat traffic, forwards the configured Harness test timeout into the runtime, marks the timed-out test as failed, skips the remaining tests in the file, restarts the app before continuing, and includes pending promise diagnostics in timeout failures.
