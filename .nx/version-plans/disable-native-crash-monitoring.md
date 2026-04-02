---
__default__: patch
---

Mobile runners now fully disable native crash monitoring when `detectNativeCrashes` is set to `false`, including iOS simulators and Android emulators and physical devices. This keeps crash-monitor setup aligned with the runtime setting while preserving the existing default behavior of enabling native crash detection when the option is omitted.
