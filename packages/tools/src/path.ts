import path from 'node:path';

export type FormatPathOptions = {
  cwd?: string;
};

export const formatPath = (
  filePath: string,
  { cwd = process.cwd() }: FormatPathOptions = {}
) =>
  path.isAbsolute(filePath) ? path.relative(cwd, filePath) || '.' : filePath;
