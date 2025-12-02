import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction } from 'connect';
import crypto from 'node:crypto';
import { getResolvedEntryPointWithoutExtension } from '../entry-point-utils.js';

export const getExpoMiddleware =
  (projectRoot: string, entryPoint: string) =>
  (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    if (req.url !== '/') {
      next();
      return;
    }

    const platform = req.headers['expo-platform'] as string;
    const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
      projectRoot,
      entryPoint
    );

    const manifestJson = JSON.stringify({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      runtimeVersion: 'react-native-harness',
      launchAsset: {
        key: 'bundle',
        contentType: 'application/javascript',
        url: `http://localhost:8081/${resolvedEntryPoint}.bundle?platform=${platform}&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&transform.reactCompiler=true&unstable_transformProfile=hermes-stable`,
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
          debuggerHost: 'localhost:8081',
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
