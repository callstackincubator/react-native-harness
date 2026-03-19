---
__default__: patch
---

Harness now restores app startup stall recovery for RN-ready launches, including restart-between-files. Apps are retried when startup stalls without a crash, while confirmed native crashes still fail immediately with crash diagnostics.
