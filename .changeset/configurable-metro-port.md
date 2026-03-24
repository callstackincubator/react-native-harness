---
'@react-native-harness/jest': patch
'@react-native-harness/platform-android': patch
'@react-native-harness/platform-apple': patch
---

Adds support for configuring the Metro port in Harness, including CLI overrides via `--metroPort`. Harness now also restores Android and iOS simulator Metro connection settings on cleanup so normal dev-mode launches keep working after a test run.
