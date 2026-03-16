---
__default__: minor
---

Startup crash detection now monitors apps during launch and reports crashes before the first test even begins, with detailed diagnostics for both iOS and Android. Physical iOS device support is included via `libimobiledevice`. Crash report selection on iOS simulators has been improved with a more reliable algorithm that tolerates timing variations.
