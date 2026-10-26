---
__default__: patch
---

On CI, Harness now warns (and adds a GitHub Actions annotation) when the runner is already saturated before the run starts, naming the busiest processes. When the platform does not become ready in time, the error reports the peak load, average idle CPU, minimum free memory and swapped-out memory observed during startup, and says when the host was starved instead of suggesting a larger timeout. On iOS simulator hosts with 3 cores or less than 8 GB of memory, the Metro prewarm now starts after the simulator has booted instead of competing with it. On CI hosts with 3 cores or less than 8 GB, Harness now stops the iOS simulator's background services that tests do not use (photo analysis, widgets, Siri, iCloud sync) right after boot, which cuts the time until the simulator is ready from several minutes to about two. Turn this on or off with the `slimOnCI` option of `appleSimulator()`.
