import type { XCTestAgentCapability } from './xctest-agent.js';

const PERMISSION_PROMPT_POLICY = 'HARNESS_XCTEST_AGENT_PERMISSION_PROMPT_POLICY';

export const createPermissionPromptCapability = (
  permissionPromptPolicy: 'grant-all' | 'deny-all' | 'disabled',
): XCTestAgentCapability => {
  return {
    getLaunchEnvironment: () => ({
      [PERMISSION_PROMPT_POLICY]: permissionPromptPolicy,
    }),
    updateConfiguration: (configuration) => ({
      ...configuration,
      permissions: {
        ...configuration.permissions,
        permissionPromptPolicy,
      },
    }),
  };
};
