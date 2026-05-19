import type {
  DevicePermissionCommand,
  DeviceStateController,
  DeviceStateMutation,
} from '@react-native-harness/platforms';
import * as adb from './adb.js';

const ANDROID_PERMISSION_ALIASES: Record<string, string[]> = {
  bluetooth: [
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
  ],
  calendar: [
    'android.permission.READ_CALENDAR',
    'android.permission.WRITE_CALENDAR',
  ],
  camera: ['android.permission.CAMERA'],
  contacts: [
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
  ],
  location: [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
  ],
  mediaLibrary: [
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
  ],
  microphone: ['android.permission.RECORD_AUDIO'],
  notifications: ['android.permission.POST_NOTIFICATIONS'],
  phone: [
    'android.permission.CALL_PHONE',
    'android.permission.ANSWER_PHONE_CALLS',
  ],
  sms: [
    'android.permission.READ_SMS',
    'android.permission.RECEIVE_SMS',
    'android.permission.SEND_SMS',
  ],
  storage: [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ],
};

type AndroidPermissionSnapshot = {
  kind: 'permission-set';
  permissions: string[];
  previousGranted: string[];
};

type AndroidPermissionMutation = DeviceStateMutation & {
  snapshot: AndroidPermissionSnapshot;
};

const normalizePermissionName = (name: string): string => {
  return name.trim();
};

const resolvePermissions = async (options: {
  adbId: string;
  bundleId: string;
  command: DevicePermissionCommand;
}): Promise<string[]> => {
  if (options.command.kind === 'permission-all') {
    return adb.getDeclaredDangerousPermissions(options.adbId, options.bundleId);
  }

  const normalized = normalizePermissionName(options.command.permission);
  const aliases = ANDROID_PERMISSION_ALIASES[normalized];

  if (aliases) {
    return aliases;
  }

  return [normalized];
};

const snapshotPermissions = async (options: {
  adbId: string;
  bundleId: string;
  permissions: readonly string[];
}): Promise<string[]> => {
  const granted = await Promise.all(
    options.permissions.map(async (permission) => {
      const isGranted = await adb.isPermissionGranted(
        options.adbId,
        options.bundleId,
        permission,
      );

      return isGranted ? permission : null;
    }),
  );

  return granted.filter((permission): permission is string => permission != null);
};

const applyPermissionSnapshot = async (options: {
  adbId: string;
  bundleId: string;
  snapshot: AndroidPermissionSnapshot;
}): Promise<void> => {
  const grantedSet = new Set(options.snapshot.previousGranted);
  const toGrant = options.snapshot.permissions.filter((permission) =>
    grantedSet.has(permission),
  );
  const toRevoke = options.snapshot.permissions.filter(
    (permission) => !grantedSet.has(permission),
  );

  if (toGrant.length > 0) {
    await adb.setPermissions(options.adbId, options.bundleId, toGrant, 'grant', {
      bestEffort: true,
    });
  }

  if (toRevoke.length > 0) {
    await adb.setPermissions(options.adbId, options.bundleId, toRevoke, 'reset', {
      bestEffort: true,
    });
  }
};

export const createAndroidDeviceState = (options: {
  adbId: string;
  bundleId: string;
}): DeviceStateController => {
  const outstandingMutations = new Map<string, AndroidPermissionMutation>();
  let mutationCounter = 0;

  const rememberMutation = (
    snapshot: AndroidPermissionSnapshot,
  ): AndroidPermissionMutation => {
    const id = `android-permissions-${++mutationCounter}`;
    const mutation: AndroidPermissionMutation = {
      id,
      snapshot,
      revert: async () => {
        await controller.permissions.revert(id);
      },
    };

    outstandingMutations.set(id, mutation);
    return mutation;
  };

  const controller: DeviceStateController = {
    permissions: {
      apply: async (command) => {
        const permissions = await resolvePermissions({
          adbId: options.adbId,
          bundleId: options.bundleId,
          command,
        });

        if (permissions.length === 0) {
          return { mutation: null };
        }

        const previousGranted = await snapshotPermissions({
          adbId: options.adbId,
          bundleId: options.bundleId,
          permissions,
        });

        await adb.setPermissions(
          options.adbId,
          options.bundleId,
          permissions,
          command.decision,
          { bestEffort: command.kind === 'permission-all' },
        );

        const mutation = rememberMutation({
          kind: 'permission-set',
          permissions,
          previousGranted,
        });

        return { mutation };
      },
      revert: async (mutationId) => {
        const mutation = outstandingMutations.get(mutationId);

        if (!mutation) {
          return;
        }

        outstandingMutations.delete(mutationId);
        await applyPermissionSnapshot({
          adbId: options.adbId,
          bundleId: options.bundleId,
          snapshot: mutation.snapshot,
        });
      },
      resetOutstanding: async () => {
        const mutations = [...outstandingMutations.values()].reverse();
        outstandingMutations.clear();

        for (const mutation of mutations) {
          await applyPermissionSnapshot({
            adbId: options.adbId,
            bundleId: options.bundleId,
            snapshot: mutation.snapshot,
          });
        }
      },
    },
  };

  return controller;
};
