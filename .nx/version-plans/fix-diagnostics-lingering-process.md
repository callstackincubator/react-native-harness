---
__default__: patch
---

Fixes a hang where the harness process kept running after tests finished whenever diagnostics were enabled (via the `diagnostics` config option or `RN_HARNESS_DIAGNOSTICS`). Diagnostics instrumentation replaced subprocess handles returned by adb/simctl with plain promises, so teardown could no longer kill the background `adb logcat` / app-launch processes and they kept the harness alive. Instrumented calls now return the original subprocess handles untouched, so runs with diagnostics enabled terminate cleanly.
