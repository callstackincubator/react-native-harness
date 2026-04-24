import type { XCTestAgentCapability } from './xctest-agent.js';

const ENABLE_PERMISSION_PROMPT_AUTO_ACCEPT =
  'HARNESS_XCTEST_AGENT_AUTO_ACCEPT_PERMISSIONS';

export const createPermissionPromptAutoAcceptCapability =
  (): XCTestAgentCapability => {
    return {
      getLaunchEnvironment: () => ({
        [ENABLE_PERMISSION_PROMPT_AUTO_ACCEPT]: '1',
      }),
      updateConfiguration: (configuration) => ({
        ...configuration,
        permissions: {
          ...configuration.permissions,
          autoAcceptPermissions: true,
        },
      }),
    };
  };
