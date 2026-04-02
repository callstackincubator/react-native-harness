---
__default__: patch
---

Harness now queues concurrent runs before starting Metro when they target the same locked resource, such as the same simulator, device, or browser. Queueing is keyed by the platform resource lock rather than the configured Metro port, so runs using different ports still wait if they target the same resource.
