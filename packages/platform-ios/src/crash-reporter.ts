import type {
  AppCrashDetails,
  CrashArtifactWriter,
  CrashDetailsLookupOptions,
} from '@react-native-harness/platforms';
import { waitForCrashArtifact } from './crash-diagnostics.js';

const CRASH_ARTIFACT_SETTLE_DELAY_MS = 300;

export type IosCrashReporter = {
  getCrashDetails: (
    options: CrashDetailsLookupOptions
  ) => Promise<AppCrashDetails | null>;
};

export const getIosProcessNames = (
  ...names: Array<string | null | undefined>
) => [...new Set(names.filter((name): name is string => Boolean(name)))];

export const createIosCrashReporter = ({
  targetId,
  targetType,
  bundleId,
  processNames,
  minOccurredAt,
  crashArtifactWriter,
}: {
  targetId: string;
  targetType: 'simulator' | 'device';
  bundleId: string;
  processNames: string[];
  minOccurredAt: number;
  crashArtifactWriter?: CrashArtifactWriter;
}): IosCrashReporter => {
  const recordedArtifacts: AppCrashDetails[] = [];

  return {
    getCrashDetails: async (lookup: CrashDetailsLookupOptions) => {
      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS)
      );

      return await waitForCrashArtifact({
        lookup,
        options: {
          targetId,
          targetType,
          bundleId,
          processNames,
          minOccurredAt,
          crashArtifactWriter,
        },
        getFallbackArtifact: () => recordedArtifacts.at(-1) ?? null,
        recordArtifact: (artifact) => {
          recordedArtifacts.push(artifact);
        },
      });
    },
  };
};
