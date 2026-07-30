---
'@react-native-harness/tools': patch
'@react-native-harness/platform-apple': patch
---

Harness now adapts iOS permission-agent startup to the host's available memory
and CPU capacity, preserving build-first startup on constrained machines while
overlapping safe preparation work on capable hosts.
