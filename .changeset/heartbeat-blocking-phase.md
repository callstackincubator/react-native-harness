---
'@react-native-harness/bridge': patch
'@react-native-harness/runtime': patch
'@react-native-harness/config': minor
'@react-native-harness/jest': patch
---

Stop test runs from failing with `app heartbeat timed out` while the app is evaluating a large test bundle. The runtime now tells the bridge it is about to block the JS thread before the synchronous `eval()` of a bundled module, and the bridge suspends the heartbeat for that phase (bounded, so a real crash is still detected). Heartbeat timing is also configurable via the new `heartbeatInterval` and `heartbeatTimeout` options, and the timeout error now explains that a blocked JS thread — not only a crash — can cause it.
