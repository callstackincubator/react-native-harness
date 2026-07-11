import { getResolvedEntryPointWithoutExtension } from './entry-point-utils.js';
import { HARNESS_REQUEST_KIND_HEADER } from './request-kind.js';
import { getBundleUrl, type BundleClientProfile } from './bundle-url.js';

type PrewarmOptions = {
  projectRoot: string;
  entryPoint: string;
  port: number;
  platform: string;
  profile: BundleClientProfile;
  signal: AbortSignal;
};

export const buildPrewarmUrl = (
  options: Omit<PrewarmOptions, 'signal'>
): string => {
  const { projectRoot, entryPoint, port, platform, profile } = options;
  const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
    projectRoot,
    entryPoint
  );

  return getBundleUrl({ port, resolvedEntryPoint, platform, profile });
};

export const prewarmMetroBundle = async (
  options: PrewarmOptions
): Promise<void> => {
  const { signal } = options;
  const url = buildPrewarmUrl(options);

  const response = await fetch(url, {
    signal,
    headers: {
      [HARNESS_REQUEST_KIND_HEADER]: 'prewarm',
    },
  });

  if (!response.ok) {
    const snippet = (await response.text()).trim();
    throw new Error(
      `Metro pre-warm failed (${response.status} ${response.statusText}). ${snippet}`
    );
  }
};
