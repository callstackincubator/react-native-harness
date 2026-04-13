---
'@react-native-harness/bundler-metro': patch
'@react-native-harness/runtime': patch
'@react-native-harness/bridge': patch
---

Fix Expo app startup by resolving package-style entry points before hijacking Metro, recognizing Expo's virtual Metro entry bundle during readiness detection, and making the runtime bridge initialization compatible with Expo's Metro runtime and React Compiler.
