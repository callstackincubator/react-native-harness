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

## Current Capability

- Best-effort permission prompt auto-accept for recognized positive actions
- Unknown prompts are ignored silently so the generic agent can coexist with future capabilities

## Operations

Validate the generated scheme and targets:

```bash
xcodebuild -project "packages/platform-ios/xctest-agent/HarnessXCTestAgent.xcodeproj" -list
```

Run the host-side validation and hardening tests from `packages/platform-ios`:

```bash
pnpm vitest run src/__tests__/xctest-agent-capabilities.test.ts src/__tests__/xctest-agent.test.ts src/__tests__/instance-xctest-agent.test.ts src/__tests__/instance.test.ts
```

Build and cache behavior:

- The project is regenerated from `xctest-agent/project.yml` during prepare
- Build artifacts are cached under `packages/platform-ios/xctest-agent/build/`
- Simulator and physical-device builds use separate derived-data roots
- Cache reuse depends on the XcodeGen inputs hash matching the stored build manifest

Manual validation checklist:

1. Build an iOS app artifact and set `HARNESS_APP_PATH` when simulator installation is needed.
2. Run Harness against an iOS simulator and confirm the first run triggers XCTest agent generation and build.
3. Run Harness a second time on the same target and confirm cached artifacts are reused.
4. Trigger a real permission prompt, such as camera access, and confirm the positive action is tapped automatically.
5. Confirm Harness teardown does not leave a stuck `xcodebuild` XCTest agent process behind.
6. Repeat the same flow on a connected physical iOS device with the required signing inputs available.

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
- `packages/platform-ios/xctest-agent/HarnessXCTestAgentTests/AgentCapability.swift`
- `packages/platform-ios/xctest-agent/HarnessXCTestAgentTests/PermissionPromptCapability.swift`

The selected Xcode version and any injected signing settings should also be part of higher-level cache keys because they affect the produced artifacts.
