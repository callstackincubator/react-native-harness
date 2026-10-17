export {
  applePlatform,
  appleSimulator,
  applePhysicalDevice,
} from './factory.js';
export type { ApplePlatformConfig } from './config.js';
export { HarnessAppPathError } from './errors.js';
export { getRunTargets } from './targets.js';
export { buildXCTestAgent } from './xctest-agent-build.js';
export type {
  BuildXCTestAgentOptions,
  BuildXCTestAgentResult,
} from './xctest-agent-build.js';
export { packXCTestAgentArtifacts } from './xctest-agent-prebuilt.js';
export type {
  PackXCTestAgentArtifactsOptions,
  PackXCTestAgentArtifactsResult,
  XCTestAgentPrebuiltEntry,
} from './xctest-agent-prebuilt.js';
export type {
  XCTestAgentBuildDestination,
  XCTestAgentBuildSigning,
} from './xctest-agent-artifacts.js';
