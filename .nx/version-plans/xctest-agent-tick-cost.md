---
__default__: patch
---

The iOS permission prompt watcher now costs less on small machines. It only checks for system prompts while the app under test is in the foreground, looks for a system alert before searching for buttons, and ticks every 2 seconds by default on constrained hosts. Set `HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS` to override the interval.
