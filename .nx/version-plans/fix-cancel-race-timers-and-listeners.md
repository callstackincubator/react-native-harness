---
__default__: patch
---

Harness runs on iOS no longer linger for up to ~25 seconds after tests finish
printing results. Uncancelled timers and abort listeners left over from
internal `Promise.race` calls (XCTest agent shutdown, Android/iOS/Vega app
session polling, and startup crash detection) could keep the process alive
past test completion; they are now cleaned up as soon as the other side of
the race settles.
