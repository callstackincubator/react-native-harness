---
__default__: patch
---

On CI, Harness now warns (and adds a GitHub Actions annotation) when the runner is already saturated before the run starts, naming the busiest processes. When the platform does not become ready in time, the error reports the peak load, minimum free memory and swapped-out memory observed during startup, and says when the host was starved instead of suggesting a larger timeout. On iOS simulator hosts with 3 cores or less than 8 GB of memory, the Metro prewarm now starts after the simulator has booted instead of competing with it.
