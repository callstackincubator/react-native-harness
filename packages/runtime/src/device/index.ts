import type {
  DevicePermissionCommand,
  DeviceStateMutation,
  PermissionName,
} from '@react-native-harness/platforms';
import { getHandle } from '../client/store.js';

const warnIfNeeded = (warning?: string): void => {
  if (warning) {
    console.warn(warning);
  }
};

const applyPermissionCommand = async (
  command: DevicePermissionCommand,
): Promise<DeviceStateMutation | null> => {
  const result = await getHandle().applyDevicePermission(command);
  warnIfNeeded(result.warning);

  if (!result.mutationId) {
    return null;
  }

  return {
    id: result.mutationId,
    revert: async () => {
      await getHandle().revertDevicePermission(result.mutationId as string);
    },
  };
};

export const device = {
  permissions: {
    grant: async (permission: PermissionName): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission',
        permission,
        decision: 'grant',
      });
    },
    revoke: async (permission: PermissionName): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission',
        permission,
        decision: 'deny',
      });
    },
    reset: async (permission: PermissionName): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission',
        permission,
        decision: 'reset',
      });
    },
    grantAll: async (): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission-all',
        decision: 'grant',
      });
    },
    denyAll: async (): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission-all',
        decision: 'deny',
      });
    },
    resetAll: async (): Promise<DeviceStateMutation | null> => {
      return await applyPermissionCommand({
        kind: 'permission-all',
        decision: 'reset',
      });
    },
  },
};
