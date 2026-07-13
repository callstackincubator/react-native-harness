import { Platform } from 'react-native';
import { getDevServerUrl } from '../utils/dev-server.js';
import { BundlingFailedError } from './errors.js';

const getModuleUrl = (fileName: string): string => {
  const devServerUrl = getDevServerUrl();
  const bundleName = fileName.split('.').slice(0, -1).join('.') + '.bundle';
  const urlSearchParams = new URLSearchParams({
    modulesOnly: 'true',
    platform: Platform.OS,
  });

  return `${devServerUrl}${bundleName}?${urlSearchParams.toString()}`;
};

export const fetchModule = async (fileName: string): Promise<string> => {
  const url = getModuleUrl(fileName);
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new BundlingFailedError(fileName, text);
  }

  return text;
};

/**
 * Ask Metro to drop this entry's dependency graph. Metro caches one graph per
 * distinct `.bundle` entry (for delta updates), so fetching each test file as
 * its own entry would otherwise retain one graph per file for the whole run and
 * OOM the runner. Metro frees a graph on a DELETE to its bundle URL, so we reuse
 * the exact fetch URL to match the graph id.
 */
export const releaseModule = async (fileName: string): Promise<void> => {
  try {
    await fetch(getModuleUrl(fileName), { method: 'DELETE' });
  } catch {
    // Best-effort: a failed release only costs memory, never correctness.
  }
};
