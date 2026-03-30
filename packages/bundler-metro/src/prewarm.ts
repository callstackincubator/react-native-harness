import { getResolvedEntryPointWithoutExtension } from './entry-point-utils.js';
import { HARNESS_REQUEST_KIND_HEADER } from './request-kind.js';

type PrewarmOptions = {
  projectRoot: string;
  entryPoint: string;
  port: number;
  platform: string;
  dev: boolean;
  minify: boolean;
  signal: AbortSignal;
};

export const prewarmMetroBundle = async (
  options: PrewarmOptions
): Promise<void> => {
  const { projectRoot, entryPoint, port, platform, dev, minify, signal } =
    options;
  const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
    projectRoot,
    entryPoint
  );
  const searchParams = new URLSearchParams({
    platform,
    dev: String(dev),
    minify: String(minify),
  });
  const url = `http://localhost:${port}/${resolvedEntryPoint}.bundle?${searchParams.toString()}`;

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
