import fs from 'node:fs';
import path from 'node:path';
import type { CustomResolutionContext, Resolution } from 'metro-resolver';
import type { HarnessResolver } from './types.js';

export type TsConfigPaths = {
  paths: Record<string, string[]>;
  baseUrl: string;
  hasBaseUrl: boolean;
};

export const loadTsConfigPaths = (
  projectRoot: string
): TsConfigPaths | null => {
  const configFiles = ['tsconfig.json', 'jsconfig.json'];

  for (const configFile of configFiles) {
    const configPath = path.join(projectRoot, configFile);

    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const jsonContent = stripJsonComments(content);
      const config = JSON.parse(jsonContent);

      const compilerOptions = config.compilerOptions || {};
      const paths = compilerOptions.paths || {};
      const baseUrl = compilerOptions.baseUrl;

      if (Object.keys(paths).length > 0 || baseUrl) {
        return {
          paths,
          baseUrl: baseUrl ? path.resolve(projectRoot, baseUrl) : projectRoot,
          hasBaseUrl: !!baseUrl,
        };
      }
    } catch (error) {
      console.warn(`Failed to parse ${configFile}:`, error);
    }
  }

  return null;
};

const stripJsonComments = (input: string): string => {
  let result = '';
  let inString = false;
  let stringChar = '';
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (!isEscaped && char === stringChar) {
        inString = false;
        stringChar = '';
      }
      isEscaped = !isEscaped && char === '\\';
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      result += char;
      isEscaped = false;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += char;
  }

  return result;
};

const matchPattern = (
  pattern: string,
  moduleName: string
): { matched: boolean; captured: string } => {
  const escapedPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '(.*)');

  const regex = new RegExp(`^${escapedPattern}$`);
  const match = moduleName.match(regex);

  return {
    matched: !!match,
    captured: match?.[1] || '',
  };
};

export const resolveWithTsConfigPaths = (
  tsConfig: TsConfigPaths,
  context: CustomResolutionContext,
  moduleName: string,
  platform: string | null
): Resolution | null => {
  const { paths, baseUrl, hasBaseUrl } = tsConfig;
  const resolveRequest = context.resolveRequest;

  if (!resolveRequest) {
    return null;
  }

  for (const [pattern, targets] of Object.entries(paths)) {
    const { matched, captured } = matchPattern(pattern, moduleName);
    if (!matched) continue;

    for (const target of targets) {
      const resolvedTarget = target.replace('*', captured);
      const absolutePath = path.resolve(baseUrl, resolvedTarget);

      try {
        return resolveRequest(context, absolutePath, platform);
      } catch {
        continue;
      }
    }
  }

  if (
    hasBaseUrl &&
    !moduleName.startsWith('.') &&
    !moduleName.startsWith('/')
  ) {
    const absolutePath = path.resolve(baseUrl, moduleName);
    try {
      return resolveRequest(context, absolutePath, platform);
    } catch {
      // Fall through to the default Metro resolution.
    }
  }

  return null;
};

export const createTsConfigResolver = (
  projectRoot: string
): HarnessResolver => {
  const tsConfig = loadTsConfigPaths(projectRoot);

  return (context, moduleName, platform) => {
    if (!tsConfig || !context.resolveRequest) {
      return null;
    }

    const resolved = resolveWithTsConfigPaths(
      tsConfig,
      context,
      moduleName,
      platform
    );

    return resolved ?? null;
  };
};
