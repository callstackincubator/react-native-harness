---
__default__: patch
---

Harness now falls back to the next available Metro port when the configured port is already in use, which lets multiple Harness runs start at the same time without colliding on Metro. When this happens, Harness keeps the selected port consistent for the whole run and prints a message showing which port it ended up using.
