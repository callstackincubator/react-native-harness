import { Glob } from 'glob';

export type TestFilterOptions = {
  testNamePattern?: string;
  testPathPattern?: string;
  testPathIgnorePatterns?: string[];
  testMatch?: string[];
};

/**
 * Discovers test files based on patterns and filtering options
 */
export const discoverTestFiles = async (
  projectRoot: string,
  configInclude: string | string[],
  options: TestFilterOptions = {}
): Promise<string[]> => {
  // Priority: testMatch > configInclude
  const patterns = options.testMatch || configInclude;
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];

  // Glob discovery
  const allFiles: string[] = [];
  for (const pattern of patternArray) {
    const glob = new Glob(pattern, { cwd: projectRoot, nodir: true });
    const files = await glob.walk();
    allFiles.push(...files);
  }

  // Remove duplicates
  let uniqueFiles = [...new Set(allFiles)];

  // Apply testPathPattern filtering
  if (options.testPathPattern) {
    const regex = new RegExp(options.testPathPattern);
    uniqueFiles = uniqueFiles.filter((file) => regex.test(file));
  }

  // Apply testPathIgnorePatterns filtering
  if (options.testPathIgnorePatterns?.length) {
    const ignoreRegexes = options.testPathIgnorePatterns.map(
      (p) => new RegExp(p)
    );
    uniqueFiles = uniqueFiles.filter(
      (file) => !ignoreRegexes.some((regex) => regex.test(file))
    );
  }

  return uniqueFiles;
};
