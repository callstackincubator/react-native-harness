import { spawn, logger } from '@react-native-harness/tools';
import { getAdbBinaryPath } from './environment.js';
import fs from 'node:fs';
import path from 'node:path';

const coverageLogger = logger.child('android-coverage');

export const pullEcFiles = async (
  adbId: string,
  bundleId: string,
  localDir: string
): Promise<string[]> => {
  fs.mkdirSync(localDir, { recursive: true });

  const adb = getAdbBinaryPath();
  const tmpDir = `/data/local/tmp/harness-coverage-${Date.now()}`;

  try {
    // List .ec files in app internal storage
    const { stdout: listing } = await spawn(adb, [
      '-s',
      adbId,
      'shell',
      'run-as',
      bundleId,
      'ls',
      'files/',
    ]);

    const ecFileNames = listing
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.ec'));

    if (ecFileNames.length === 0) {
      return [];
    }

    // Copy files to a world-readable temp dir so `adb pull` can access them.
    // `run-as` files are in the app's private directory, which `adb pull`
    // cannot read directly.
    await spawn(adb, ['-s', adbId, 'shell', 'mkdir', '-p', tmpDir]);

    for (const ecFile of ecFileNames) {
      try {
        await spawn(adb, [
          '-s',
          adbId,
          'shell',
          'run-as',
          bundleId,
          'cp',
          `files/${ecFile}`,
          `${tmpDir}/${ecFile}`,
        ]);
      } catch (e) {
        coverageLogger.debug('Failed to copy %s to tmp: %s', ecFile, e);
      }
    }

    // Pull all .ec files from the temp dir using adb pull (handles binary correctly)
    await spawn(adb, ['-s', adbId, 'pull', tmpDir + '/.', localDir]);
  } catch (e) {
    coverageLogger.debug('Failed to pull .ec files: %s', e);
  } finally {
    // Clean up the temp dir on device
    try {
      await spawn(adb, ['-s', adbId, 'shell', 'rm', '-rf', tmpDir]);
    } catch {
      // best-effort cleanup
    }
  }

  return fs
    .readdirSync(localDir)
    .filter((f) => f.endsWith('.ec'))
    .map((f) => path.join(localDir, f));
};

/**
 * Finds the harness-coverage build artifacts for a module.
 * The Gradle init script saves these to <module>/build/harness-coverage/:
 *   - original-classes-kotlin/  (uninstrumented Kotlin class files)
 *   - original-classes-java/    (uninstrumented Java class files)
 *   - jacococli.jar             (JaCoCo CLI)
 */
const findCoverageArtifacts = (
  projectRoot: string,
  modules: string[]
): {
  jacococliJar: string | null;
  classesDirs: string[];
  sourceDirs: string[];
} => {
  let jacococliJar: string | null = null;
  const classesDirs: string[] = [];
  const sourceDirs: string[] = [];

  for (const mod of modules) {
    const modDir = mod.replace(/^:/, '');
    const coverageDir = path.join(
      projectRoot,
      modDir,
      'build',
      'harness-coverage'
    );

    let foundClasses = false;
    for (const suffix of ['kotlin', 'java']) {
      const classesDir = path.join(coverageDir, `original-classes-${suffix}`);
      if (fs.existsSync(classesDir)) {
        classesDirs.push(classesDir);
        foundClasses = true;
      }
    }
    if (!foundClasses) {
      coverageLogger.warn(
        '[coverage] Original class files not found in %s — was the app built with the coverage init script?',
        coverageDir
      );
    }

    if (!jacococliJar) {
      const jar = path.join(coverageDir, 'jacococli.jar');
      if (fs.existsSync(jar)) {
        jacococliJar = jar;
      }
    }

    for (const srcPath of [
      path.join(projectRoot, modDir, 'src', 'main', 'java'),
      path.join(projectRoot, modDir, 'src', 'main', 'kotlin'),
    ]) {
      if (fs.existsSync(srcPath)) {
        sourceDirs.push(srcPath);
      }
    }
  }

  return { jacococliJar, classesDirs, sourceDirs };
};

const mergeEcFiles = async (
  jacococliJar: string,
  ecFiles: string[],
  outputPath: string
): Promise<void> => {
  await spawn('java', [
    '-jar',
    jacococliJar,
    'merge',
    ...ecFiles,
    '--destfile',
    outputPath,
  ]);
};

const generateXmlReport = async (options: {
  jacococliJar: string;
  execFile: string;
  classesDirs: string[];
  sourceDirs: string[];
  outputPath: string;
}): Promise<void> => {
  const { jacococliJar, execFile, classesDirs, sourceDirs, outputPath } =
    options;

  const args = ['-jar', jacococliJar, 'report', execFile];

  for (const dir of classesDirs) {
    args.push('--classfiles', dir);
  }
  for (const dir of sourceDirs) {
    args.push('--sourcefiles', dir);
  }
  args.push('--xml', outputPath);

  await spawn('java', args);
};

const getAttr = (tag: string, name: string): string => {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? '';
};

/**
 * Resolves a package-relative source path (e.g. "com/example/Foo.kt") to an
 * absolute path by checking which source directory contains the file.
 */
const resolveSourcePath = (
  relativePath: string,
  sourceDirs: string[]
): string => {
  for (const srcDir of sourceDirs) {
    const candidate = path.join(srcDir, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return relativePath;
};

/**
 * Converts a JaCoCo XML report to lcov format.
 *
 * JaCoCo XML structure:
 *   <report>
 *     <package name="com/example">
 *       <sourcefile name="Foo.kt">
 *         <line nr="10" mi="0" ci="3" mb="0" cb="0"/>
 *       </sourcefile>
 *     </package>
 *   </report>
 */
export const convertJacocoXmlToLcov = (
  xmlPath: string,
  lcovPath: string,
  sourceDirs: string[] = []
): void => {
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const output: string[] = [];

  let currentPackage = '';
  let fileLines: Array<{ nr: number; hits: number }> = [];
  let filePath = '';

  const tagRegex = /<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let match;

  while ((match = tagRegex.exec(xml)) !== null) {
    const isClosing = match[1] === '/';
    const tagName = match[2];
    const attrs = match[3];
    const isSelfClosing = match[4] === '/';

    if (!isClosing) {
      if (tagName === 'package') {
        currentPackage = getAttr(attrs, 'name');
      } else if (tagName === 'sourcefile') {
        const fileName = getAttr(attrs, 'name');
        filePath = currentPackage
          ? `${currentPackage}/${fileName}`
          : fileName;
        fileLines = [];
      } else if (tagName === 'line' && filePath) {
        const nr = parseInt(getAttr(attrs, 'nr') || '0', 10);
        const ci = parseInt(getAttr(attrs, 'ci') || '0', 10);
        const mi = parseInt(getAttr(attrs, 'mi') || '0', 10);
        if (nr > 0 && (ci > 0 || mi > 0)) {
          fileLines.push({ nr, hits: ci });
        }
      }
    }

    if (isClosing || isSelfClosing) {
      if (tagName === 'sourcefile' && filePath && fileLines.length > 0) {
        const resolvedPath = resolveSourcePath(filePath, sourceDirs);
        output.push(`SF:${resolvedPath}`);
        for (const line of fileLines) {
          output.push(`DA:${line.nr},${line.hits}`);
        }
        output.push(`LF:${fileLines.length}`);
        const hitLines = fileLines.filter((l) => l.hits > 0).length;
        output.push(`LH:${hitLines}`);
        output.push('end_of_record');
        filePath = '';
        fileLines = [];
      } else if (tagName === 'package') {
        currentPackage = '';
      }
    }
  }

  fs.writeFileSync(lcovPath, output.join('\n') + '\n');
};

export const cleanEcFilesOnDevice = async (
  adbId: string,
  bundleId: string
): Promise<void> => {
  const adb = getAdbBinaryPath();
  try {
    await spawn(adb, [
      '-s',
      adbId,
      'shell',
      'run-as',
      bundleId,
      'sh',
      '-c',
      'rm -f files/coverage-*.ec',
    ]);
  } catch {
    coverageLogger.debug('Failed to clean .ec files from device');
  }
};

export type CollectAndroidNativeCoverageOptions = {
  adbId: string;
  bundleId: string;
  modules: string[];
  outputDir: string;
};

export const collectAndroidNativeCoverage = async (
  options: CollectAndroidNativeCoverageOptions
): Promise<string | null> => {
  const { adbId, bundleId, modules, outputDir } = options;

  coverageLogger.debug('[coverage] Collecting native Android coverage', {
    adbId,
    bundleId,
    modules,
  });

  // Pull .ec files from device
  const ecDir = path.join(outputDir, '.harness-coverage-ec');
  const ecFiles = await pullEcFiles(adbId, bundleId, ecDir);

  if (ecFiles.length === 0) {
    coverageLogger.debug('[coverage] No .ec files found on device');
    return null;
  }

  coverageLogger.debug(`[coverage] Found ${ecFiles.length} .ec file(s)`);

  // Find build artifacts (jacococli.jar + original classes) from the Android
  // project. For RN apps the Android project is typically at outputDir/android/.
  let androidProjectDir = outputDir;
  const androidSubdir = path.join(outputDir, 'android');
  if (fs.existsSync(androidSubdir)) {
    androidProjectDir = androidSubdir;
  }

  const { jacococliJar, classesDirs, sourceDirs } = findCoverageArtifacts(
    androidProjectDir,
    modules
  );

  if (!jacococliJar) {
    coverageLogger.warn(
      '[coverage] jacococli.jar not found in build output — was the app built with the coverage init script?'
    );
    fs.rmSync(ecDir, { recursive: true, force: true });
    return null;
  }

  if (classesDirs.length === 0) {
    coverageLogger.warn(
      '[coverage] No original class files found — cannot generate report'
    );
    fs.rmSync(ecDir, { recursive: true, force: true });
    return null;
  }

  // Merge .ec files
  const mergedEc = path.join(outputDir, 'native-coverage.exec');
  await mergeEcFiles(jacococliJar, ecFiles, mergedEc);

  // Generate XML report
  const xmlPath = path.join(outputDir, 'native-coverage.xml');
  await generateXmlReport({
    jacococliJar,
    execFile: mergedEc,
    classesDirs,
    sourceDirs,
    outputPath: xmlPath,
  });

  // Convert to lcov
  const lcovPath = path.join(outputDir, 'native-coverage.lcov');
  convertJacocoXmlToLcov(xmlPath, lcovPath, sourceDirs);

  // Clean up
  fs.rmSync(ecDir, { recursive: true, force: true });
  await cleanEcFilesOnDevice(adbId, bundleId);

  coverageLogger.debug(`[coverage] Native coverage written to: ${lcovPath}`);
  return lcovPath;
};
