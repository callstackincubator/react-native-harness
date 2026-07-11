---
__default__: minor
---

Harness now starts building the Metro bundle as soon as the Metro server is up, instead of waiting for the emulator/simulator to finish booting first. On cold starts, bundling now overlaps platform boot instead of happening after it, cutting wall-clock time by up to the full first-bundle build duration. Startup stall errors are also more actionable, distinguishing device-side connectivity issues from a slow or broken bundle build. A new `eagerPrewarm` config option (default `true`) lets you opt out on constrained runners where emulator boot and bundling might contend for CPU.
