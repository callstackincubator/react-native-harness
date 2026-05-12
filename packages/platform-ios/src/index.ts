export {
  applePlatform,
  appleSimulator,
  applePhysicalDevice,
} from './factory.js';
export type { ApplePlatformConfig } from './config.js';
export { HarnessAppPathError } from './errors.js';
export { getRunTargets } from './targets.js';
export { buildXCTestAgent } from './xctest-agent.js';
export type {
  BuildXCTestAgentOptions,
  BuildXCTestAgentResult,
  XCTestAgentBuildDestination,
  XCTestAgentBuildSigning,
} from './xctest-agent.js';
