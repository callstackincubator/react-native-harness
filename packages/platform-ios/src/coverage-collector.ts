import { spawn, logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import path from 'node:path';

export const getAppDataContainer = async (
  udid: string,
  bundleId: string
): Promise<string> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'get_app_container',
    udid,
    bundleId,
    'data',
  ]);
  return stdout.trim();
};

export const getAppBundlePath = async (
  udid: string,
  bundleId: string
): Promise<string> => {
  const { stdout } = await spawn('xcrun', [
    'simctl',
    'get_app_container',
    udid,
    bundleId,
  ]);
  return stdout.trim();
};

export const collectProfrawFiles = (dataContainer: string): string[] => {
  const documentsDir = path.join(dataContainer, 'Documents');
  if (!fs.existsSync(documentsDir)) {
    logger.debug('[coverage] Documents directory does not exist');
    return [];
  }

  return fs
    .readdirSync(documentsDir)
    .filter((f) => f.endsWith('.profraw'))
    .map((f) => path.join(documentsDir, f));
};

export const mergeProfdata = async (
  profrawFiles: string[],
  outputPath: string
): Promise<void> => {
  await spawn('xcrun', [
    'llvm-profdata',
    'merge',
    '-sparse',
    ...profrawFiles,
    '-o',
    outputPath,
  ]);
};

export const findAppExecutable = async (
  appBundlePath: string
): Promise<string> => {
  const infoPlistPath = path.join(appBundlePath, 'Info.plist');
  const { stdout } = await spawn('plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    infoPlistPath,
  ]);
  const executableName = stdout.trim();

  // Xcode 26+ may use a debug.dylib
  const debugDylibPath = path.join(
    appBundlePath,
    `${executableName}.debug.dylib`
  );
  if (fs.existsSync(debugDylibPath)) {
    return debugDylibPath;
  }

  return path.join(appBundlePath, executableName);
};

export const generateLcov = async (options: {
  profdataPath: string;
  binaryPath: string;
  outputPath: string;
  sourceFilters?: string[];
}): Promise<void> => {
  const { profdataPath, binaryPath, outputPath, sourceFilters } = options;

  const args = [
    'llvm-cov',
    'export',
    '-format=lcov',
    `-instr-profile=${profdataPath}`,
    binaryPath,
  ];

  if (sourceFilters) {
    for (const filter of sourceFilters) {
      args.push(`--sources=${filter}`);
    }
  }

  const { stdout } = await spawn('xcrun', args);
  fs.writeFileSync(outputPath, stdout);
};

export type CollectNativeCoverageOptions = {
  udid: string;
  bundleId: string;
  pods: string[];
  outputDir: string;
};

export const collectNativeCoverage = async (
  options: CollectNativeCoverageOptions
): Promise<string | null> => {
  const { udid, bundleId, pods, outputDir } = options;

  logger.debug('[coverage] Collecting native iOS coverage', { udid, bundleId, pods });

  let dataContainer: string;
  try {
    dataContainer = await getAppDataContainer(udid, bundleId);
  } catch (error) {
    logger.debug('[coverage] Failed to get app data container', error);
    return null;
  }

  const profrawFiles = collectProfrawFiles(dataContainer);
  if (profrawFiles.length === 0) {
    logger.debug('[coverage] No .profraw files found');
    return null;
  }

  logger.debug(`[coverage] Found ${profrawFiles.length} .profraw file(s)`);

  const profdataPath = path.join(outputDir, 'native-coverage.profdata');
  await mergeProfdata(profrawFiles, profdataPath);

  let appBundlePath: string;
  try {
    appBundlePath = await getAppBundlePath(udid, bundleId);
  } catch (error) {
    logger.debug('[coverage] Failed to get app bundle path', error);
    return null;
  }

  const binaryPath = await findAppExecutable(appBundlePath);
  logger.debug(`[coverage] Using binary: ${binaryPath}`);

  const lcovPath = path.join(outputDir, 'native-coverage.lcov');

  // Filter sources to only include code from the specified pods.
  // Pod source files are typically in the Pods directory under each pod name.
  const podSourceDirs = pods.map((pod) =>
    path.join(path.dirname(appBundlePath), '..', 'Pods', pod)
  );

  try {
    await generateLcov({
      profdataPath,
      binaryPath,
      outputPath: lcovPath,
      sourceFilters: podSourceDirs,
    });
  } catch (error) {
    logger.debug('[coverage] Failed to generate lcov, trying without source filters', error);
    await generateLcov({
      profdataPath,
      binaryPath,
      outputPath: lcovPath,
    });
  }

  logger.debug(`[coverage] Native coverage written to: ${lcovPath}`);
  return lcovPath;
};
