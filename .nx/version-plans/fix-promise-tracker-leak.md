---
__default__: patch
---

Fixes an unbounded memory leak in the runtime promise tracker that could exhaust the JS heap (`JavaScript heap out of memory`) during long runs. Apps that keep producing work every frame (animations, `requestAnimationFrame` loops, polling, async data-binding) create a stream of promises that never settle; these were retained forever along with a captured stack, growing memory until the run crashed. Harness now releases a promise's tracking record as soon as the promise is garbage-collected and caps the number of retained records, so memory stays bounded regardless of how busy the app under test is.
