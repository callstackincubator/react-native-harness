export type PermissionName =
  | 'all'
  | 'calendar'
  | 'contacts'
  | 'contacts-limited'
  | 'location'
  | 'location-always'
  | 'photos'
  | 'photos-add'
  | 'media-library'
  | 'mediaLibrary'
  | 'microphone'
  | 'motion'
  | 'reminders'
  | 'siri'
  | 'notifications'
  | 'camera'
  | (string & {});

export type PermissionDecision = 'grant' | 'deny' | 'reset';

export type DevicePermissionCommand =
  | {
      kind: 'permission';
      permission: PermissionName;
      decision: PermissionDecision;
    }
  | {
      kind: 'permission-all';
      decision: PermissionDecision;
    };

export type DeviceStateMutation = {
  id: string;
  revert: () => Promise<void>;
};

export type DeviceStateApplyResult = {
  mutation: DeviceStateMutation | null;
  warning?: string;
};

export type DeviceStateController = {
  permissions: {
    apply: (
      command: DevicePermissionCommand,
    ) => Promise<DeviceStateApplyResult>;
    revert: (mutationId: string) => Promise<void>;
    resetOutstanding: () => Promise<void>;
  };
};
