import type {
  DeviceStateController,
  DeviceStateMutation,
} from '@react-native-harness/platforms';
import * as simctl from './xcrun/simctl.js';
import type {
  XCTestAgentClient,
  XCTestAgentPermissionsConfiguration,
} from './xctest-agent-client.js';

const IOS_SIMULATOR_PERMISSION_ALIASES: Record<string, string> = {
  mediaLibrary: 'media-library',
};

const IOS_SIMULATOR_SUPPORTED_PERMISSIONS = new Set([
  'all',
  'calendar',
  'contacts',
  'contacts-limited',
  'location',
  'location-always',
  'photos',
  'photos-add',
  'media-library',
  'microphone',
  'motion',
  'reminders',
  'siri',
]);

type IosSimulatorPermissionSnapshot = {
  kind: 'simulator';
  service: string;
  revertDecision: 'grant' | 'deny' | 'reset';
};

type IosPhysicalPermissionSnapshot = {
  kind: 'physical';
  configuration: XCTestAgentPermissionsConfiguration;
};

type IosPermissionSnapshot =
  | IosSimulatorPermissionSnapshot
  | IosPhysicalPermissionSnapshot;

type IosPermissionMutation = DeviceStateMutation & {
  snapshot: IosPermissionSnapshot;
};

type IosPhysicalDeviceStateClientProvider = () => Promise<XCTestAgentClient | null>;

const unsupportedPhysicalPermissionWarning = (
  decision: 'grant' | 'deny' | 'reset',
  permission: string,
): string => {
  const methodName =
    decision === 'grant'
      ? 'grant'
      : decision === 'deny'
        ? 'revoke'
        : 'reset';

  return `device.permissions.${methodName}("${permission}") cannot mutate permission state on physical iOS devices. Harness only supports deterministic iOS permission mutation on simulators.`;
};

const physicalBulkWarning = (decision: 'grant' | 'deny' | 'reset'): string => {
  if (decision === 'grant') {
    return 'device.permissions.grantAll() on physical iOS enables XCTest Agent prompt auto-accept. It cannot pre-grant existing permission state.';
  }

  if (decision === 'deny') {
    return 'device.permissions.denyAll() on physical iOS enables XCTest Agent prompt auto-deny. It cannot revoke existing permission state.';
  }

  return 'device.permissions.resetAll() on physical iOS disables XCTest Agent permission prompt handling and restores default prompt behavior.';
};

const getPolicyForDecision = (
  decision: 'grant' | 'deny' | 'reset',
): XCTestAgentPermissionsConfiguration['permissionPromptPolicy'] => {
  if (decision === 'grant') {
    return 'grant-all';
  }

  if (decision === 'deny') {
    return 'deny-all';
  }

  return 'disabled';
};

const getRevertDecision = (
  decision: 'grant' | 'deny' | 'reset',
): 'grant' | 'deny' | 'reset' => {
  if (decision === 'grant') {
    return 'reset';
  }

  if (decision === 'deny') {
    return 'reset';
  }

  return 'reset';
};

const normalizeSimulatorPermission = (permission: string): string => {
  const trimmed = permission.trim();
  return IOS_SIMULATOR_PERMISSION_ALIASES[trimmed] ?? trimmed;
};

export const createIosSimulatorDeviceState = (options: {
  udid: string;
  bundleId: string;
  onWarning?: (warning: string) => void;
}): DeviceStateController => {
  const outstandingMutations = new Map<string, IosPermissionMutation>();
  let mutationCounter = 0;

  const revertSnapshot = async (snapshot: IosSimulatorPermissionSnapshot) => {
    await simctl.setPrivacyPermission({
      udid: options.udid,
      bundleId: options.bundleId,
      service: snapshot.service,
      decision: snapshot.revertDecision,
    });
  };

  const controller: DeviceStateController = {
    permissions: {
      apply: async (command) => {
        const service =
          command.kind === 'permission-all'
            ? 'all'
            : normalizeSimulatorPermission(command.permission);

        if (!IOS_SIMULATOR_SUPPORTED_PERMISSIONS.has(service)) {
          const warning = `device.permissions.${command.decision === 'deny' ? 'revoke' : command.decision}("${service}") is not supported on iOS simulators. Harness supports only simctl privacy services in v1.`;
          options.onWarning?.(warning);
          return { mutation: null, warning };
        }

        await simctl.setPrivacyPermission({
          udid: options.udid,
          bundleId: options.bundleId,
          service,
          decision: command.decision,
        });

        const id = `ios-simulator-permissions-${++mutationCounter}`;
        const mutation: IosPermissionMutation = {
          id,
          snapshot: {
            kind: 'simulator',
            service,
            revertDecision: getRevertDecision(command.decision),
          },
          revert: async () => {
            await controller.permissions.revert(id);
          },
        };

        outstandingMutations.set(id, mutation);
        return { mutation };
      },
      revert: async (mutationId) => {
        const mutation = outstandingMutations.get(mutationId);

        if (!mutation || mutation.snapshot.kind !== 'simulator') {
          return;
        }

        outstandingMutations.delete(mutationId);
        await revertSnapshot(mutation.snapshot);
      },
      resetOutstanding: async () => {
        const mutations = [...outstandingMutations.values()].reverse();
        outstandingMutations.clear();

        for (const mutation of mutations) {
          if (mutation.snapshot.kind === 'simulator') {
            await revertSnapshot(mutation.snapshot);
          }
        }
      },
    },
  };

  return controller;
};

export const createIosPhysicalDeviceState = (options: {
  getClient?: IosPhysicalDeviceStateClientProvider;
  onWarning?: (warning: string) => void;
}): DeviceStateController => {
  const outstandingMutations = new Map<string, IosPermissionMutation>();
  let mutationCounter = 0;

  const getClient = async (): Promise<XCTestAgentClient | null> => {
    return (await options.getClient?.()) ?? null;
  };

  const configurePermissions = async (
    configuration: XCTestAgentPermissionsConfiguration,
  ): Promise<void> => {
    const client = await getClient();

    if (!client) {
      return;
    }

    await client.configurePermissions(configuration);
  };

  const getCurrentConfiguration = async (): Promise<XCTestAgentPermissionsConfiguration> => {
    const client = await getClient();

    if (!client) {
      return { permissionPromptPolicy: 'disabled' };
    }

    return client.getPermissionsConfig();
  };

  const controller: DeviceStateController = {
    permissions: {
      apply: async (command) => {
        if (command.kind === 'permission') {
          const warning = unsupportedPhysicalPermissionWarning(
            command.decision,
            command.permission,
          );
          options.onWarning?.(warning);
          return { mutation: null, warning };
        }

        const warning = physicalBulkWarning(command.decision);
        options.onWarning?.(warning);
        const previousConfiguration = await getCurrentConfiguration();
        await configurePermissions({
          permissionPromptPolicy: getPolicyForDecision(command.decision),
        });

        if (options.getClient == null) {
          return { mutation: null, warning };
        }

        const id = `ios-physical-permissions-${++mutationCounter}`;
        const mutation: IosPermissionMutation = {
          id,
          snapshot: {
            kind: 'physical',
            configuration: previousConfiguration,
          },
          revert: async () => {
            await controller.permissions.revert(id);
          },
        };

        outstandingMutations.set(id, mutation);
        return { mutation, warning };
      },
      revert: async (mutationId) => {
        const mutation = outstandingMutations.get(mutationId);

        if (!mutation || mutation.snapshot.kind !== 'physical') {
          return;
        }

        outstandingMutations.delete(mutationId);
        await configurePermissions(mutation.snapshot.configuration);
      },
      resetOutstanding: async () => {
        const mutations = [...outstandingMutations.values()].reverse();
        outstandingMutations.clear();

        for (const mutation of mutations) {
          if (mutation.snapshot.kind === 'physical') {
            await configurePermissions(mutation.snapshot.configuration);
          }
        }
      },
    },
  };

  return controller;
};
