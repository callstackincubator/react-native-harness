---
__default__: minor
---

Harness test files can now opt into platform-specific execution by suffixing the file name with a known platform, while shared harness tests continue to run everywhere. Platform-mismatched files are skipped cleanly and still emit structured results, so summary reporting and downstream hooks stay accurate.
