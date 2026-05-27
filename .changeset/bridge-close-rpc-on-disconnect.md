---
'@react-native-harness/bridge': patch
---

Close the bridge RPC channel as soon as the app WebSocket disconnects so in-flight calls fail immediately instead of waiting for a timeout. This makes bridge shutdowns easier to detect and gives higher layers a faster, more accurate signal when the app session disappears.
