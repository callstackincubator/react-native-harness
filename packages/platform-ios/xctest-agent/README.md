# Harness XCTest Agent

Internal XcodeGen-backed project used by `@react-native-harness/platform-apple` to build a reusable XCTest agent.

## Generate The Project

From the repo root:

```bash
pnpm --filter @react-native-harness/platform-apple run xctest-agent:generate
```

The generated project is intentionally not committed. The source of truth is `xctest-agent/project.yml` plus the files referenced from it.

## Project Shape

- `HarnessXCTestAgentHost`: minimal iOS host app target used to package and run the agent on simulator and physical-device destinations
- `HarnessXCTestAgentTests`: UI-testing bundle where agent capabilities live
- `HarnessXCTestAgent` scheme: stable scheme name for future host-side orchestration

## Build Assumptions

- `xcodegen` is available on the host machine
- Xcode and the iOS platform SDKs are installed
- Simulator builds can use the generated project without additional signing configuration
- Physical-device builds require signing inputs, such as `DEVELOPMENT_TEAM`, to be provided by the caller at build time
- The project stays generic so additional XCTest-driven behaviors can be added without renaming targets or schemes

## Cache Inputs

When build artifact caching is added, these files should be treated as the primary cache inputs for project generation and XCTest agent builds:

- `packages/platform-ios/xctest-agent/project.yml`
- `packages/platform-ios/xctest-agent/HarnessXCTestAgentHost/AgentHostApp.swift`
- `packages/platform-ios/xctest-agent/HarnessXCTestAgentTests/HarnessXCTestAgentTests.swift`

The selected Xcode version and any injected signing settings should also be part of higher-level cache keys because they affect the produced artifacts.
