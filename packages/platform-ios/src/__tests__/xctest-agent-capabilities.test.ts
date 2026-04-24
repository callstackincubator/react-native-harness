import { describe, expect, it } from 'vitest';
import { createPermissionPromptAutoAcceptCapability } from '../xctest-agent-capabilities.js';

describe('xctest agent capabilities', () => {
  it('enables best-effort permission prompt auto-accept through launch environment', () => {
    const capability = createPermissionPromptAutoAcceptCapability();

    expect(capability.getLaunchEnvironment?.()).toEqual({
      HARNESS_XCTEST_AGENT_AUTO_ACCEPT_PERMISSIONS: '1',
    });
  });

  it('enables permission auto-accept in the runtime configuration', () => {
    const capability = createPermissionPromptAutoAcceptCapability();

    expect(
      capability.updateConfiguration?.({
        permissions: {
          autoAcceptPermissions: false,
        },
      }),
    ).toEqual({
      permissions: {
        autoAcceptPermissions: true,
      },
    });
  });
});
