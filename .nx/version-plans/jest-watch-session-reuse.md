---
'@react-native-harness/jest': patch
---

Watch mode no longer hangs on "waiting in queue" for the second and later runs; the device session is now reused between runs instead of blocking on its own lock.
