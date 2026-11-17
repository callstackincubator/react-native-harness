import path from 'node:path';
import type webpackDevMiddleware from 'webpack-dev-middleware';

export type DevMiddleware = ReturnType<typeof webpackDevMiddleware>;

type OutputFileSystem = {
  readFile: (
    file: string,
    callback: (error: unknown, data?: Buffer | string) => void
  ) => void;
};

/**
 * The build's files live in the middleware's memory, not on disk. The text of
 * `name` under `outputPath`, or null when there is none.
 */
export const readOutputFile = (
  middleware: DevMiddleware | null,
  outputPath: string,
  name: string
): Promise<string | null> =>
  new Promise((resolve) => {
    const { outputFileSystem } = (middleware?.context ?? {}) as unknown as {
      outputFileSystem?: OutputFileSystem;
    };

    if (!outputFileSystem) {
      resolve(null);
      return;
    }

    outputFileSystem.readFile(path.join(outputPath, name), (error, data) =>
      resolve(error || data === undefined ? null : data.toString())
    );
  });
