import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction } from 'connect';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { Reporter } from '../reporter.js';
import { getResolvedEntryPointWithoutExtension } from '../entry-point-utils.js';
import {
  HARNESS_REQUEST_KIND_HEADER,
  type HarnessBundleRequestKind,
} from '../request-kind.js';

const EXPO_VIRTUAL_ENTRY_BUNDLE = '/.expo/.virtual-metro-entry.bundle';

const getRequestKind = (req: IncomingMessage): HarnessBundleRequestKind => {
  const header = req.headers[HARNESS_REQUEST_KIND_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  return value === 'prewarm' ? 'prewarm' : 'app';
};

export const getBundleRequestObserverMiddleware = (
  projectRoot: string,
  harnessConfig: HarnessConfig,
  reporter: Reporter,
) => {
  const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
    projectRoot,
    harnessConfig.entryPoint,
  );
  const expectedPathname = `/${resolvedEntryPoint}.bundle`;

  return (req: IncomingMessage, _res: ServerResponse, next: NextFunction) => {
    if (!req.url) {
      next();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (
      pathname === expectedPathname ||
      pathname === EXPO_VIRTUAL_ENTRY_BUNDLE
    ) {
      const platform = url.searchParams.get('platform');

      if (platform) {
        reporter.emit({
          type: 'bundle_request_observed',
          platform,
          requestKind: getRequestKind(req),
          timestamp: new Date().toISOString(),
          url: req.url,
        });
      }
    }

    next();
  };
};
