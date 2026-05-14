---
name: react-native-harness
description: Write and debug React Native Harness tests for app code. Use when the user asks to create or fix tests that import from react-native-harness, mock modules, spy on functions, render React Native components on-device, use setupFiles or setupFilesAfterEnv, or add optional UI tests with @react-native-harness/ui.
---

Router only. Private setup before using this skill:

```bash
harness --version
```

Require `react-native-harness >= 1.3.0-rc.1`; older CLIs lack these skill commands. If older, run `npm install -g react-native-harness@latest`, recheck, then continue. If you cannot upgrade, stop and tell the user. Do not include version or upgrade commands in final plans.

Before your first Harness command or plan, read the version-matched CLI guide:

```bash
harness skill get core
```

If you need more details on Harness, see the available CLI skill guides:

```bash
harness skill list
```

Load additional skills via `harness skill get <name>` when needed.

Use this skill only to route into version-matched CLI guidance. Let the installed CLI skill files provide exact workflow guidance, API usage, and current test-writing rules.
