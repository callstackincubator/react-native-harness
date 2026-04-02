import { access, readFile } from 'node:fs/promises';
import type { AndroidSystemImageArch } from './environment.js';
import type { AndroidEmulator, AndroidEmulatorAVDConfig } from './config.js';

export type AvdConfig = {
  imageSysdir1?: string;
  abiType?: string;
  hwDeviceName?: string;
  diskDataPartitionSize?: string;
  vmHeapSize?: string;
};

export type AvdCompatibilityResult =
  | { compatible: true }
  | { compatible: false; reason: string };

export const getAvdDirectory = (name: string): string => {
  return `${
    process.env.ANDROID_AVD_HOME ?? `${process.env.HOME}/.android/avd`
  }/${name}.avd`;
};

export const getAvdConfigPath = (name: string): string => {
  return `${getAvdDirectory(name)}/config.ini`;
};

const normalizeAvdValue = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.trim();
};

const normalizeConfigValue = (value: string): string => {
  return value.trim().toLowerCase();
};

const parseSizeInBytes = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (/^\d+$/.test(normalizedValue)) {
    return Number(normalizedValue);
  }

  const match = normalizedValue.match(/^(\d+)([kmgt])$/i);

  if (!match) {
    return null;
  }

  const size = Number(match[1]);
  const unit = match[2]?.toLowerCase();

  const multiplier =
    unit === 'k'
      ? 1024
      : unit === 'm'
      ? 1024 ** 2
      : unit === 'g'
      ? 1024 ** 3
      : unit === 't'
      ? 1024 ** 4
      : null;

  return multiplier == null ? null : size * multiplier;
};

const getApiLevelFromImageSysdir = (
  value: string | undefined
): number | null => {
  const match = value?.match(/android-(\d+)/i);
  return match ? Number(match[1]) : null;
};

const normalizeProfile = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .toLowerCase();
};

export const parseAvdConfig = (contents: string): AvdConfig => {
  const config: AvdConfig = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    switch (key) {
      case 'image.sysdir.1':
        config.imageSysdir1 = value;
        break;
      case 'abi.type':
        config.abiType = value;
        break;
      case 'hw.device.name':
        config.hwDeviceName = value;
        break;
      case 'disk.dataPartition.size':
        config.diskDataPartitionSize = value;
        break;
      case 'vm.heapSize':
        config.vmHeapSize = value;
        break;
      default:
        break;
    }
  }

  return config;
};

export const readAvdConfig = async (
  name: string
): Promise<AvdConfig | null> => {
  const configPath = getAvdConfigPath(name);

  try {
    await access(configPath);
  } catch {
    return null;
  }

  return parseAvdConfig(await readFile(configPath, 'utf8'));
};

export const isAvdCompatible = ({
  emulator,
  avdConfig,
  hostArch,
}: {
  emulator: AndroidEmulator;
  avdConfig: AvdConfig;
  hostArch: AndroidSystemImageArch;
}): AvdCompatibilityResult => {
  const requestedAvdConfig = emulator.avd;

  if (!requestedAvdConfig) {
    return { compatible: false, reason: 'AVD config is required.' };
  }

  if (emulator.name.trim() === '') {
    return { compatible: false, reason: 'AVD name is required.' };
  }

  const apiLevel = getApiLevelFromImageSysdir(avdConfig.imageSysdir1);

  if (apiLevel !== requestedAvdConfig.apiLevel) {
    return {
      compatible: false,
      reason: `API level mismatch: expected ${
        requestedAvdConfig.apiLevel
      }, got ${apiLevel ?? 'missing'}.`,
    };
  }

  if (normalizeAvdValue(avdConfig.abiType) !== hostArch) {
    return {
      compatible: false,
      reason: `ABI mismatch: expected ${hostArch}, got ${
        normalizeAvdValue(avdConfig.abiType) ?? 'missing'
      }.`,
    };
  }

  if (
    normalizeProfile(avdConfig.hwDeviceName) !==
    normalizeProfile(requestedAvdConfig.profile)
  ) {
    return {
      compatible: false,
      reason: `Profile mismatch: expected ${requestedAvdConfig.profile}, got ${
        avdConfig.hwDeviceName ?? 'missing'
      }.`,
    };
  }

  if (
    (() => {
      const configuredDiskSizeBytes = parseSizeInBytes(
        avdConfig.diskDataPartitionSize
      );
      const requestedDiskSizeBytes = parseSizeInBytes(
        requestedAvdConfig.diskSize
      );

      if (configuredDiskSizeBytes != null && requestedDiskSizeBytes != null) {
        return configuredDiskSizeBytes < requestedDiskSizeBytes;
      }

      return (
        normalizeConfigValue(avdConfig.diskDataPartitionSize ?? '') !==
        normalizeConfigValue(requestedAvdConfig.diskSize)
      );
    })()
  ) {
    return {
      compatible: false,
      reason: `Disk size mismatch: expected ${
        requestedAvdConfig.diskSize
      }, got ${avdConfig.diskDataPartitionSize ?? 'missing'}.`,
    };
  }

  if (
    normalizeConfigValue(avdConfig.vmHeapSize ?? '') !==
    normalizeConfigValue(requestedAvdConfig.heapSize)
  ) {
    return {
      compatible: false,
      reason: `Heap size mismatch: expected ${
        requestedAvdConfig.heapSize
      }, got ${avdConfig.vmHeapSize ?? 'missing'}.`,
    };
  }

  return { compatible: true };
};

export const getNormalizedAvdCacheConfig = ({
  emulator,
  hostArch,
}: {
  emulator: AndroidEmulator;
  hostArch: AndroidSystemImageArch;
}): {
  name: string;
  apiLevel: number;
  arch: AndroidSystemImageArch;
  profile: string;
  diskSize: string;
  heapSize: string;
} | null => {
  const avd = emulator.avd;

  if (!avd) {
    return null;
  }

  return {
    name: emulator.name,
    apiLevel: avd.apiLevel,
    arch: hostArch,
    profile: avd.profile.trim().toLowerCase(),
    diskSize: avd.diskSize.trim().toLowerCase(),
    heapSize: avd.heapSize.trim().toLowerCase(),
  };
};

export const resolveAvdCachingEnabled = ({
  avd,
  isInteractive,
  env = process.env,
}: {
  avd?: AndroidEmulatorAVDConfig;
  isInteractive: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean => {
  const override = env.HARNESS_AVD_CACHING;
  const configValue = avd?.snapshot?.enabled;
  const requestedValue =
    override == null ? configValue : override.toLowerCase() === 'true';

  if (!requestedValue) {
    return false;
  }

  return !isInteractive;
};
