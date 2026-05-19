import { describe, expect, it } from 'vitest';
import { createPermissionPromptCapability } from '../xctest-agent-capabilities.js';

describe('xctest agent capabilities', () => {
  it('sets permission prompt policy through launch environment', () => {
    const capability = createPermissionPromptCapability('deny-all');

    expect(capability.getLaunchEnvironment?.()).toEqual({
      HARNESS_XCTEST_AGENT_PERMISSION_PROMPT_POLICY: 'deny-all',
    });
  });

  it('writes permission prompt policy into the runtime configuration', () => {
    const capability = createPermissionPromptCapability('grant-all');

    expect(
      capability.updateConfiguration?.({
        permissions: {
          permissionPromptPolicy: 'disabled',
        },
      }),
    ).toEqual({
      permissions: {
        permissionPromptPolicy: 'grant-all',
      },
    });
  });
});
