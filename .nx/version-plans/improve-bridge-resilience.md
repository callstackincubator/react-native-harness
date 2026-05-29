---
__default__: patch
---

Harness now handles app bridge reloads, reconnects, disconnects, and dropped sockets more reliably during test runs. For Harness users, this means fewer stuck runs waiting on a dead RPC channel and clearer failures when the app reloads, crashes, or loses its bridge connection mid-test.
