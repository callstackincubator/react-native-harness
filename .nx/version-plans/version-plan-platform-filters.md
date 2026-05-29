---
__default__: minor
---

Harness test files can now opt into platform-specific execution by suffixing the file name with a known platform, while shared harness tests continue to run everywhere. When you run Harness for a specific runner, files for other known platforms are filtered out before Jest schedules them, so `*.ios.harness.*` and `*.android.harness.*` tests can live side by side without failing on the wrong platform.
