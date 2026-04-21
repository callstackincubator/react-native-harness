# iOS XCTest Agent MVP Plan

## Goal

Implement an iOS XCTest-based agent that can run against both simulators and physical devices, and use it in the MVP to auto-accept permission prompts on a best-effort basis.

This should be a generic XCTest integration for Harness, not a permission-specific helper, so it can be reused for other iOS system-level automation later.

## MVP Scope

- iOS only
- Support both simulator and physical device targets
- Start the XCTest agent once per Harness run
- Stop the XCTest agent during Harness teardown
- Best-effort auto-accept of permission prompts
- Unknown prompts are ignored silently
- No public testing API changes
- No deny/override behavior
- No Android implementation in this phase
- No `simctl privacy` optimization in this phase

## Architecture Direction

- Add a generic run-level lifecycle hook so platform runners can prepare and dispose auxiliary tooling needed for the run.
- Implement the iOS side using a generic `XCTest agent` concept owned by `platform-ios`.
- Package the XCTest agent as a small Xcode project generated with `xcodegen`.
- Use the same XCTest agent concept for both iOS simulators and physical devices.
- Keep permission prompt handling as the first XCTest agent capability, not the only one.

## Phase 1: Lifecycle Integration

Status: Completed

Objective: create the Harness and platform lifecycle seam needed to run auxiliary tooling once per run.

Deliverables:

- Run-level prepare/dispose hooks available on platform runners
- Harness wired to invoke those hooks once per run
- Coverage for success, error, and teardown paths

Notes:

- This phase should remain generic and not mention XCTest directly in shared abstractions.
- The outcome should be reusable by any future platform-owned run helper.

Parallelization:

- Can be done independently from XCTest project creation
- Must land before full end-to-end iOS wiring is completed

## Phase 2: XCTest Agent Project

Status: Completed

Objective: create the reusable iOS XCTest agent project and prove it can be generated reproducibly.

Deliverables:

- New internal `xctest-agent` project inside `packages/platform-ios`
- Project generated from `xcodegen` spec rather than manually maintained project internals
- Minimal shared project structure suitable for both simulator and physical-device builds
- Documented build assumptions and cache inputs

Notes:

- This phase focuses on project packaging and generation, not Harness integration.
- The top-level naming should stay generic so additional XCTest-driven capabilities can be added later.

Parallelization:

- Can proceed in parallel with Phase 1
- Can also proceed in parallel with the host-side iOS orchestration design work in Phase 3

## Phase 3: iOS XCTest Agent Orchestration

Status: Completed

Objective: add host-side orchestration in `platform-ios` to build, cache, start, and stop the XCTest agent.

Deliverables:

- Internal `platform-ios` orchestration for the XCTest agent
- Support for simulator destinations
- Support for physical-device destinations
- Artifact reuse strategy for simulator and device builds
- Clear separation between agent lifecycle management and agent behaviors

Notes:

- Simulator and physical device should share the same orchestration model, even if build artifacts differ.
- The orchestration should treat the agent as a long-lived run-level helper, not something restarted per test file.

Parallelization:

- Depends on enough output from Phase 2 to know what project is being built and launched
- Can be developed in parallel with Phase 4 if the behavior contract is kept narrow

## Phase 4: Permission Prompt Capability

Status: Completed

Objective: implement the first XCTest agent capability: best-effort auto-accept of permission prompts.

Deliverables:

- Permission prompt interruption handling inside the XCTest agent
- Best-effort positive-action tapping behavior
- Silent ignore behavior for unrecognized prompts
- Capability scoped so it can later live beside other XCTest agent behaviors

Notes:

- This phase should not introduce any public Harness API.
- The implementation should be framed as one capability of the generic agent.

Parallelization:

- Can proceed in parallel with most of Phase 3 once the lifecycle between host and agent is understood
- Final validation depends on Phase 3 integration

## Phase 5: End-to-End iOS Wiring

Status: Completed

Objective: connect the generic lifecycle, iOS orchestration, and permission capability into the actual Harness run flow.

Deliverables:

- iOS simulator runs start the XCTest agent before first app launch
- iOS physical-device runs start the XCTest agent before first app launch
- Both stop the agent during teardown
- Existing app launch and restart behavior remains unchanged
- No per-file permission synchronization is introduced

Notes:

- The agent should be started lazily before the first app launch, not eagerly at Harness creation time.
- This phase is where the MVP becomes functionally available.

Parallelization:

- Depends on Phases 1 through 4
- Should be kept small by reusing the outputs of earlier phases rather than adding new concepts

## Phase 6: Validation And Hardening

Objective: verify the MVP works on real targets and stabilize the integration.

Deliverables:

- Automated coverage for host-side lifecycle and orchestration behavior
- Manual validation on at least one iOS simulator
- Manual validation on at least one physical iOS device
- Basic operational documentation for future contributors

Validation focus:

- First-run build experience
- Reuse of cached artifacts on later runs
- Permission prompt auto-accept for at least one real prompt source such as camera
- No obvious teardown leaks or stuck background processes

Parallelization:

- Automated coverage can be built alongside Phase 5
- Manual validation happens after end-to-end wiring is in place

## Suggested Parallel Workstreams

### Stream A: Shared Lifecycle

- Phase 1

### Stream B: XCTest Agent Project

- Phase 2

### Stream C: iOS Agent Runtime Orchestration

- Phase 3

### Stream D: Permission Capability

- Phase 4

### Stream E: Final Wiring And Validation

- Phase 5
- Phase 6

## Dependency Summary

- Phase 1 is required before final integration
- Phase 2 is required before full orchestration can be finalized
- Phase 3 depends on Phase 2
- Phase 4 can begin before Phase 3 is finished, but depends on the agent project shape from Phase 2
- Phase 5 depends on Phases 1 through 4
- Phase 6 depends on Phase 5

## Explicit Non-Goals For This Plan

- Public permission configuration API
- Per-test or per-file permission overrides
- Deny behavior
- Android permission automation
- Simulator fast-path optimization through `simctl privacy`
- Strict unsupported-permission detection or reporting

## Follow-Up After MVP

- Add Android best-effort pregrant support via `adb`
- Add `simctl privacy` fast path for the iOS simulator where supported
- Add more XCTest agent capabilities beyond permission prompts
- Revisit public API design once internal behavior is proven in practice
