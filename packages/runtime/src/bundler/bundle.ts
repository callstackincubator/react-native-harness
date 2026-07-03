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
 * Ask Metro to drop the cached module graph for this entry. Metro keeps one
 * dependency graph in memory per distinct `.bundle` entry point (for delta
 * updates); because each test file is fetched as its own entry, those graphs
 * would otherwise accumulate — one full graph per file — for the whole run and
 * OOM the Metro/runner process. Metro releases a graph on an HTTP DELETE to the
 * same bundle URL, so we reuse the exact fetch URL to match its graph id.
 */
export const releaseModule = async (fileName: string): Promise<void> => {
  try {
    await fetch(getModuleUrl(fileName), { method: 'DELETE' });
  } catch {
    // Best-effort: a failed release only costs memory, never correctness.
  }
};
