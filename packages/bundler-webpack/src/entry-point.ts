import fs from 'node:fs';
import path from 'node:path';

const CODE_EXTENSION = /\.[cm]?[jt]sx?$/;

const stripQuery = (request: string): string => request.replace(/[?#].*$/, '');

const stripCodeExtension = (file: string): string =>
  file.replace(CODE_EXTENSION, '');

const realpathOrSelf = (file: string): string => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

/** What the module factory hands to a replacement callback. */
export type ResolveData = {
  /** The request, before it is resolved (webpack and Rspack). */
  request?: string;
  context?: string;
  /** Webpack passes `createData` empty before resolution and filled after. */
  createData?: { resource?: string };
};

/**
 * Recognizes the request for the app's entry in either of the two forms a
 * bundler hands over: a request and its context before resolution, or the
 * resolved file after it.
 */
export const createEntryPointMatcher = ({
  projectRoot,
  entryPoint,
}: {
  projectRoot: string;
  entryPoint: string;
}): ((data: ResolveData) => boolean) => {
  const expected = path.resolve(projectRoot, entryPoint);
  const accepted = new Set(
    [expected, realpathOrSelf(expected)].map(stripCodeExtension)
  );

  return (data) => {
    const resolved = data.createData?.resource;
    const file =
      resolved ??
      (data.request && data.context
        ? path.resolve(data.context, data.request)
        : undefined);

    return file !== undefined && accepted.has(stripCodeExtension(stripQuery(file)));
  };
};

/** A pattern the bundler tests before running the matcher: the entry's name. */
export const getEntryPointPattern = (entryPoint: string): RegExp => {
  const name = stripCodeExtension(path.basename(entryPoint));

  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
};

/** The configured `entry`, for a message. */
export const describeEntry = (entry: unknown): string =>
  typeof entry === 'function' ? 'a function' : JSON.stringify(entry) ?? 'none';
