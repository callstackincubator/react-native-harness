import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction } from 'connect';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import crypto from 'node:crypto';
import { getResolvedEntryPointWithoutExtension } from '../entry-point-utils.js';
import { getBundleUrl } from '../bundle-url.js';

export const getExpoMiddleware =
  (projectRoot: string, harnessConfig: HarnessConfig) =>
  (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    if (req.url !== '/') {
      next();
      return;
    }

    const platform = req.headers['expo-platform'] as string;
    const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
      projectRoot,
      harnessConfig.entryPoint
    );

    const manifestJson = JSON.stringify({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      runtimeVersion: 'react-native-harness',
      launchAsset: {
        key: 'bundle',
        contentType: 'application/javascript',
        url: getBundleUrl({
          port: harnessConfig.metroPort,
          resolvedEntryPoint,
          platform,
          profile: 'expo',
        }),
      },
      assets: [],
      metadata: {},
      extra: {
        expoClient: {
          name: 'react-native-harness',
          slug: 'react-native-harness',
          version: '1.0.0',
        },
        expoGo: {
          debuggerHost: `localhost:${harnessConfig.metroPort}`,
          developer: {
            tool: 'expo-cli',
            projectRoot,
          },
          packagerOpts: { dev: true },
          mainModuleName: resolvedEntryPoint,
        },
      },
    });

    res.statusCode = 200;
    res.setHeader('expo-protocol-version', '0');
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('cache-control', 'private, max-age=0');
    res.setHeader('content-type', 'application/expo+json');
    res.setHeader('Exponent-Server', 'lorem');
    res.setHeader('content-length', Buffer.byteLength(manifestJson, 'utf8'));

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(manifestJson);
  };
